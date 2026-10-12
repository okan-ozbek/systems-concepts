"""Bounded compile-only API. Submitted code is never executed by this service."""
import base64
import json
import os
import resource
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from instrument import validate_source, main_ast, instrument

CLANG = '/opt/wasi-sdk/bin/clang++'
SLOTS = threading.BoundedSemaphore(1)
FLAGS = ['-std=c++20', '-O0', '-g', '-fno-exceptions', '-fno-color-diagnostics', '-Wno-unused-value']


def limits():
    resource.setrlimit(resource.RLIMIT_CPU, (12, 12))
    resource.setrlimit(resource.RLIMIT_FSIZE, (24 * 1024 * 1024, 24 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def command(args, directory, output):
    with open(directory / output, 'wb') as stdout, open(directory / 'errors.txt', 'wb') as stderr:
        result = subprocess.run([CLANG, *FLAGS, *args], cwd=directory, stdin=subprocess.DEVNULL,
                                stdout=stdout, stderr=stderr, timeout=18, preexec_fn=limits,
                                env={'PATH': '/opt/wasi-sdk/bin:/usr/bin', 'TMPDIR': str(directory)})
    errors = (directory / 'errors.txt').read_text(errors='replace')[:12000].replace(str(directory) + '/', '')
    if result.returncode:
        raise ValueError(errors or 'Compilation exceeded its resource budget.')
    return errors


def compile_source(source):
    validate_source(source)
    with tempfile.TemporaryDirectory(prefix='cpp-', dir='/tmp') as name:
        directory = Path(name)
        (directory / 'main.cpp').write_text(source, encoding='utf-8')
        warnings = command(['-fsyntax-only', '-Xclang', '-ast-dump=json', '-Xclang', '-ast-dump-filter=main', 'main.cpp'], directory, 'ast.json')
        transformed, checkpoints = instrument(source, main_ast((directory / 'ast.json').read_text()))
        (directory / 'traced.cpp').write_text(transformed, encoding='utf-8')
        warnings += command(['traced.cpp', '-Wl,--threads=1', '-Wl,--export-memory', '-Wl,--max-memory=33554432', '-o', 'program.wasm'], directory, 'compile.txt')
        binary = (directory / 'program.wasm').read_bytes()
        if len(binary) > 4 * 1024 * 1024:
            raise ValueError('Compiled program exceeds the 4 MB lab limit.')
        return {'wasm': base64.b64encode(binary).decode(), 'warnings': warnings, 'checkpoints': checkpoints,
                'compiler': 'Clang / WASI SDK 30 · C++20 · -O0 · wasm32'}


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/health':
            self.reply(200, {'ready': True})
        else:
            self.reply(404, {'error': 'Unknown endpoint.'})

    def do_POST(self):
        if self.path != '/compile':
            return self.reply(404, {'error': 'Unknown endpoint.'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            return self.reply(400, {'error': 'Invalid request size.'})
        if not 0 < length <= 24000:
            return self.reply(413, {'error': 'Source is limited to 16 KB.'})
        if not SLOTS.acquire(blocking=False):
            return self.reply(429, {'error': 'Compiler is busy. Try again in a moment.'})
        try:
            self.connection.settimeout(5)
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict) or not isinstance(payload.get('source'), str):
                raise ValueError('Provide C++ source text.')
            self.reply(200, compile_source(payload['source']))
        except subprocess.TimeoutExpired:
            self.reply(422, {'error': 'Compilation timed out (18 seconds per stage).'})
        except (ValueError, OSError) as error:
            self.reply(422, {'error': str(error)[:12000]})
        finally:
            SLOTS.release()

    def log_message(self, format, *args):
        print(format % args, flush=True)


if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', 9000), Handler).serve_forever()
