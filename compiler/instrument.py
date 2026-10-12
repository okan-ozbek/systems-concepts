"""Clang AST based statement checkpoints; deliberately limited to main's block scopes."""
import json
import re

ALLOWED_HEADERS = {'iostream', 'cstdio', 'cstdlib', 'cstdint', 'cstddef', 'cmath',
                   'array', 'vector', 'string', 'algorithm', 'numeric', 'limits', 'utility'}


def validate_source(source):
    if len(source.encode('utf-8')) > 16000:
        raise ValueError('Source is limited to 16 KB.')
    # Only standard headers: no filesystem includes, user macros, or source remapping.
    # Also reject line splicing, which could conceal a directive or change AST offsets.
    if re.search(r'\\\r?\n', source) or '??' in source:
        raise ValueError('Line splicing and trigraphs are not supported in the lab.')
    # Skip comments AND literals lexically: a quoted "/*" must never hide a
    # later real directive. Preserve newlines while blanking token contents.
    tokens = r'(?:u8|u|U|L)?R"(?P<delimiter>[^()\s\\]{0,16})\(.*?\)(?P=delimiter)"|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\\n])*\'|/\*.*?\*/|//[^\n]*'
    cleaned = re.sub(tokens, lambda m: re.sub(r'[^\n]', ' ', m.group()), source, flags=re.S)
    for directive in re.findall(r'^\s*(?:#|%:)([^\n]*)', cleaned, re.M):
        match = re.fullmatch(r'include\s*<([a-z0-9_]+)>\s*', directive.strip())
        if not match or match[1] not in ALLOWED_HEADERS:
            raise ValueError('Use standard lab headers only; macros and other preprocessor directives are not supported.')
    if '__lab_' in source:
        raise ValueError('Names beginning with __lab_ are reserved for tracing.')


def main_ast(text):
    decoder = json.JSONDecoder()
    while text.strip():
        node, end = decoder.raw_decode(text.lstrip())
        text = text.lstrip()[end:]
        if node.get('kind') == 'FunctionDecl' and node.get('name') == 'main' and node.get('mangledName') == 'main':
            body = next((c for c in node.get('inner', []) if c.get('kind') == 'CompoundStmt'), None)
            if body:
                return body
    raise ValueError('Define int main() with a braced body to trace this program.')


def instrument(source, body):
    raw = source.encode('utf-8')
    edits = {}
    count = 0
    accesses = {}

    def position(node, side):
        loc = node['range'][side]
        if 'offset' not in loc:
            raise ValueError('Macro-expanded statements cannot be traced in this experiment.')
        return loc['offset'] + (loc.get('tokLen', 1) if side == 'end' else 0)

    def line(offset):
        return raw[:offset].count(b'\n') + 1

    def unwrap(node):
        while node.get('kind') in ('ParenExpr', 'ImplicitCastExpr', 'ExprWithCleanups') and node.get('inner'):
            node = node['inner'][0]
        return node

    def memory_lvalue(node):
        node = unwrap(node)
        kind = node.get('kind')
        if node.get('valueCategory') != 'lvalue':
            return None
        if kind == 'DeclRefExpr' and '&' in node.get('referencedDecl', {}).get('type', {}).get('qualType', ''):
            return node
        if kind in ('ArraySubscriptExpr', 'MemberExpr') or (kind == 'UnaryOperator' and node.get('opcode') == '*'):
            return node
        if kind == 'CXXOperatorCallExpr':
            callee = unwrap(node['inner'][0])
            if callee.get('referencedDecl', {}).get('name') == 'operator[]':
                return node
        if kind == 'CXXMemberCallExpr' and node.get('inner', [{}])[0].get('name') in ('at', 'front', 'back'):
            return node
        return None

    def record_access(node, mode):
        target = memory_lvalue(node)
        if not target:
            return
        begin, end = position(target, 'begin'), position(target, 'end')
        key = (begin, end)
        accesses[key] = mode if key not in accesses else max(mode, accesses[key])

    def walk_accesses(node):
        kind = node.get('kind')
        # Never evaluate unevaluated operands, implicit library bodies, lambdas,
        # or constexpr initializers as a side effect of source tracing.
        if kind in ('UnaryExprOrTypeTraitExpr', 'CXXNoexceptExpr', 'CXXTypeidExpr', 'LambdaExpr') or node.get('constexpr'):
            return
        children = node.get('inner', [])
        if kind == 'ImplicitCastExpr' and node.get('castKind') == 'LValueToRValue':
            record_access(children[0], 0)
        elif kind in ('BinaryOperator', 'CompoundAssignOperator') and node.get('opcode') in ('=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='):
            record_access(children[0], 1 if node['opcode'] == '=' else 2)
        elif kind == 'UnaryOperator' and node.get('opcode') in ('++', '--'):
            record_access(children[0], 2)
        for child in children:
            walk_accesses(child)

    def checkpoint(offset, line_number, variables, phase=0):
        nonlocal count
        count += 1
        captures = ''.join(f'__lab_capture("{name}",{name});' for name in variables)
        edits.setdefault(offset, []).append(f'\n__lab_begin({line_number},{phase});{captures}\n'.encode())

    def statement_end(node):
        end = position(node, 'end')
        if raw[end-1:end] == b';':
            return end
        # Comments between an expression and its semicolon are valid C++.
        trivia = re.match(rb'(?:\s|/\*.*?\*/|//[^\n]*\n)*;', raw[end:], re.S)
        if not trivia:
            raise ValueError('Could not find a statement boundary. Use simple statements and braced control-flow bodies.')
        return end + trivia.end()

    def declarations(node, variables):
        for child in node.get('inner', []):
            if child.get('kind') == 'VarDecl' and child.get('name'):
                # Compiler templates ignore non-numeric objects. Uninitialized locals
                # are never read by the tracer, even if subsequently assigned.
                name = child['name']
                variables[:] = [v for v in variables if v != name]
                if child.get('init'):
                    variables.append(name)

    def control(node, variables):
        kind = node['kind']
        children = node.get('inner', [])
        if kind not in ('ForStmt', 'WhileStmt', 'IfStmt'):
            raise ValueError(f'{kind} is not supported by statement tracing yet. Use declarations, expressions, if, for, and while in main.')
        checkpoint(position(node, 'begin'), line(position(node, 'begin')), variables)
        scoped = list(variables)
        for child in children:
            if child.get('kind') == 'DeclStmt':
                declarations(child, scoped)
        # The AST marks if's else via hasElse; loop bodies are the last child.
        bodies = children[-(2 if kind == 'IfStmt' and node.get('hasElse') else 1):]
        for child in bodies:
            if child.get('kind') == 'IfStmt':
                control(child, scoped)
            elif child.get('kind') == 'CompoundStmt':
                block(child, scoped, line(position(node, 'begin')))
            else:
                raise ValueError('Put braces around each if / else / for / while body so checkpoints preserve its scope.')

    def block(node, incoming, entry_line=None):
        variables = list(incoming)
        checkpoint(position(node, 'begin') + 1, entry_line or line(position(node, 'begin')), variables, 2)
        for child in node.get('inner', []):
            kind = child.get('kind', '')
            if kind == 'CompoundStmt':
                block(child, variables)
            elif kind in ('ForStmt', 'WhileStmt', 'IfStmt'):
                control(child, variables)
            elif kind == 'ReturnStmt':
                checkpoint(position(child, 'begin'), line(position(child, 'begin')), variables)
            elif kind in ('BreakStmt', 'ContinueStmt'):
                checkpoint(position(child, 'begin'), line(position(child, 'begin')), variables)
            elif kind == 'DeclStmt' or kind.endswith('Expr') or kind in ('ExprWithCleanups', 'BinaryOperator', 'CompoundAssignOperator', 'UnaryOperator', 'NullStmt'):
                if kind == 'DeclStmt':
                    declarations(child, variables)
                checkpoint(statement_end(child), line(position(child, 'begin')), variables, 1)
            else:
                raise ValueError(f'{kind} is not supported by statement tracing yet.')

    block(body, [])
    walk_accesses(body)
    # Wrapping the evaluated lvalue preserves its reference and evaluates the
    # index/base exactly once. Nested expressions retain the original order.
    for (begin, end), mode in sorted(accesses.items(), key=lambda item: (item[0][0], -item[0][1])):
        expression = raw[begin:end].decode('utf-8')[:128]
        edits.setdefault(begin, []).append(b'__lab_access((')
        edits.setdefault(end, []).insert(0, f'),{line(begin)},{mode},{json.dumps(expression, ensure_ascii=False)})'.encode())
    for offset in sorted(edits, reverse=True):
        raw = raw[:offset] + b''.join(edits[offset]) + raw[offset:]
    return '#include "/app/trace.hpp"\n#line 1 "main.cpp"\n' + raw.decode('utf-8'), count
