import type { NodeId, Step } from './lessons';
import type { TraceMoment } from './lab-types';

// These routes are illustrative interpretations of source statements, not
// measured instructions, register allocation, cache hits, or physical addresses.
const memoryRead:NodeId[]=['reg0','l10','l20','l3','dram','l3','l20','l10','reg0'];

// Strip literals/comments before interpreting the statement so e.g. printing
// "new node->value" does not become a heap access. This is a teaching heuristic,
// not a C++ parser; compilation and checkpoint placement use Clang's AST.
function statementAt(source:string,line:number):string {
  const clean=source.replace(/(?:u8|u|U|L)?R"([^()\s\\]{0,16})\([\s\S]*?\)\1"|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,token=>token.replace(/[^\n]/g,' '));
  return clean.split('\n')[line-1]?.trim()??'';
}

export function explainMoment(moment:TraceMoment, source:string):Step {
  if(moment.phase==='end')return {title:'Program finished',detail:'The compiled WebAssembly program has returned. Output and exit status came from this run.',route:['reg0'],signal:'compute'};
  const code=statementAt(source,moment.line);
  if(moment.phase==='entry')return {title:`Enter scope · line ${moment.line}`,detail:'A block opens. Captured variables are those already initialized at this point. New locals appear after their declaration completes; loop-body entries include the current iteration variable.',route:['reg0'],signal:'compute'};
  const prefix=moment.phase==='before'?'Before':'After';
  const title=`${prefix} line ${moment.line}`;
  const memory=/\b\w+(?:\s*->\s*\w+|\s*\[[^\]]+\])/.test(code);
  const allocation=/\bnew\s+/.test(code);
  if(memory||allocation){
    const target='(?:\\b\\w+(?:\\s*->\\s*\\w+|\\s*\\[[^\\]]+\\])+)' ;
    const store=new RegExp(`${target}\\s*(?:[+*/%&|^-]=|=(?!=)|\\+\\+|--)|(?:\\+\\+|--)\\s*${target}`).test(code);
    const io=/(?:cout|printf|puts|cin|scanf)\b/.test(code);
    if(store&&!/\b(?:if|for|while)\s*\(/.test(code))return {title,detail:'Store illustration: update a cache line in L1. A dirty line may be written back toward DRAM later; this checkpoint does not prove a DRAM write. Cache traffic is modeled.',route:['reg0','l10'],signal:'data'};
    return {title,detail:allocation?'Heap allocation illustration: the allocator supplies storage and the constructor initializes it. The route shows a possible cache-miss request and data return, not measured allocation or DRAM traffic. Object fields and pointers are not captured yet.':'Memory read illustration: a request travels from the core toward DRAM, then data returns through the caches. This assumes a miss throughout the cache hierarchy; an actual access may hit in cache. Cache traffic is modeled.',route:io?[...memoryRead,'io']:memoryRead,signal:'data'};
  }
  if(/(?:cout|printf|puts|cin|scanf)\b/.test(code))return {title,detail:'I/O illustration: the core exchanges data with an output or input device. The console below contains actual program output.',route:['reg0','io'],signal:'data'};
  if(/\b(?:if|for|while)\s*\(/.test(code))return {title,detail:'Control-flow illustration: a comparison determines which instructions execute next. This checkpoint captures the actual path taken.',route:['reg0','alu','reg0'],signal:'compute'};
  if(/[+*\/%-]=?|\+\+|--/.test(code))return {title,detail:'Arithmetic illustration: operands feed the execution unit and the result becomes available to the core. These are conceptual registers.',route:['reg0','alu','reg0'],signal:'compute'};
  return {title,detail:'State illustration: an initialized local becomes available to the program. At -O0 the trace reads its value from WebAssembly linear memory.',route:['reg0','l10'],signal:'data'};
}
