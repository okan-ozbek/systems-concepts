// End-to-end: real Clang API -> built browser worker -> captured state assertions.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Worker} from 'node:worker_threads';
import {spawn} from 'node:child_process';
const base=process.env.CPP_LAB_URL??'http://localhost:8080';
const workerFile=(await readdir('dist/assets')).find(name=>name.startsWith('lab.worker-')&&name.endsWith('.js'));
assert.ok(workerFile,'Run npm run build first.');
const workerCode=await readFile(`dist/assets/${workerFile}`,'utf8');
async function compile(source){
  if(process.env.CPP_LAB_DIRECT==='1'){
    // Test the same API on its private container interface, avoiding NGINX's
    // deliberate interactive compile rate limit during a batch of test cases.
    const client=`import sys,json,urllib.request,urllib.error
data=sys.stdin.buffer.read()
try:
 r=urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:9000/compile',data=data,headers={'Content-Type':'application/json'}),timeout=45)
except urllib.error.HTTPError as e:
 r=e
print(json.dumps({'status':r.code,'payload':json.loads(r.read())}))`;
    return new Promise((resolve,reject)=>{
      const child=spawn('docker',['compose','exec','-T','cpp-compiler','python3','-c',client]);let stdout='',stderr='';
      child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
      child.once('error',reject);child.once('exit',code=>{if(code)reject(new Error(stderr));else{try{resolve(JSON.parse(stdout));}catch(error){reject(error);}}});
      child.stdin.end(JSON.stringify({source}));
    });
  }
  const response=await fetch(`${base}/api/cpp/compile`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source})});
  return {status:response.status,payload:await response.json()};
}
async function execute(source,stdin=''){
  const {status,payload}=await compile(source);assert.equal(status,200,payload.error);
  return new Promise((resolve,reject)=>{
    const worker=new Worker(`const {parentPort}=require('node:worker_threads');global.self={postMessage:value=>parentPort.postMessage(value)};${workerCode};parentPort.on('message',data=>self.onmessage({data}));`,{eval:true});
    const timer=setTimeout(()=>{worker.terminate();reject(new Error('Worker deadline exceeded'));},3000);
    worker.once('error',error=>{clearTimeout(timer);worker.terminate();reject(error);});
    worker.once('message',result=>{clearTimeout(timer);worker.terminate();resolve(result);});
    worker.postMessage({wasm:Uint8Array.from(Buffer.from(payload.wasm,'base64')).buffer,stdin});
  });
}
const values=(result,name)=>result.moments.flatMap(m=>m.variables.filter(v=>v.name===name).map(v=>v.values));
let count=0;
async function test(name,fn){await fn();count++;console.log(`PASS ${name}`);}
await test('arithmetic, source line, stdout and exit status',async()=>{
  const result=await execute('#include <iostream>\nint main() {\n int a=7;\n int b=5;\n int sum=a+b;\n sum*=2;\n std::cout << sum << "\\n";\n return 0;\n}');
  assert.equal(result.error,undefined);assert.equal(result.exitCode,0);assert.equal(result.output,'24\n');
  assert.equal(result.moments[0].phase,'entry');
  assert.ok(result.moments.some(m=>m.line===5&&m.phase==='after'&&m.variables.find(v=>v.name==='sum')?.values[0]==='12'));
  assert.ok(values(result,'sum').some(v=>v[0]==='24'));
});
await test('array and repeated loop checkpoints preserve real iteration values',async()=>{
  const result=await execute('#include <cstdio>\nint main(){ int a[4]={2,5,3,8}; int sum=0; for(int i=0;i<4;++i){sum+=a[i];} printf("%d",sum); return 0; }');
  assert.equal(result.error,undefined);assert.equal(result.output,'18');
  assert.deepEqual([...new Set(values(result,'i').map(v=>v[0]))],['0','1','2','3']);
  assert.deepEqual(values(result,'a')[0],['2','5','3','8']);assert.ok(values(result,'sum').some(v=>v[0]==='18'));
});
await test('branch skips the path that did not execute',async()=>{
  const result=await execute('int main(){int x=4;int y=0;if(x<3){y=10;}else{y=20;}return y;}');
  assert.equal(result.exitCode,20);assert.ok(values(result,'y').some(v=>v[0]==='20'));assert.ok(!values(result,'y').some(v=>v[0]==='10'));
});
await test('memory read/write example captures the updated element and output',async()=>{
  const result=await execute('#include <iostream>\nint main() {\nint values[4] = {10,20,30,40};\nint loaded = values[2];\nvalues[1] = loaded + 5;\nint result = values[1];\nstd::cout << result << "\\n";\nreturn 0;\n}');
  assert.equal(result.error,undefined);assert.equal(result.output,'35\n');
  assert.ok(values(result,'values').some(v=>JSON.stringify(v)==='["10","35","30","40"]'));
  assert.ok(values(result,'loaded').some(v=>v[0]==='30'));
});
await test('linked-list pointer reads execute while object fields remain outside snapshots',async()=>{
  const result=await execute('#include <iostream>\nclass Node { public: Node* next; int value; Node(int v, Node* n=nullptr) { value=v; next=n; } };\nint main() {\nauto node3=new Node(30,nullptr);\nauto node2=new Node(20,node3);\nauto node=new Node(10,node2);\nauto curr=node;\nwhile(curr->next != nullptr) {\nstd::cout << curr->value << std::endl;\ncurr=curr->next;\n}\ndelete node;\ndelete node2;\ndelete node3;\nreturn 0;\n}');
  assert.equal(result.error,undefined);assert.equal(result.output,'10\n20\n');
  assert.ok(result.moments.some(m=>m.line===10&&m.phase==='after'));
  assert.equal(values(result,'curr').length,0);
});
await test('numeric vector and std::array expose real buffer values',async()=>{
  const result=await execute('#include <vector>\n#include <array>\nint main(){std::vector<int> v{1,2,3};std::array<double,2> a{2.5,4.0};v[1]=9;v.push_back(7);return v[1];}');
  assert.equal(result.error,undefined);assert.equal(result.exitCode,9);
  assert.ok(values(result,'v').some(v=>JSON.stringify(v)==='["1","9","3","7"]'));
  assert.deepEqual(values(result,'a')[0],['2.5','4']);
});
await test('stdin and float values',async()=>{
  const result=await execute('#include <iostream>\nint main(){double x=0;std::cin>>x;x*=2;std::cout<<x;return 0;}','2.75');
  assert.equal(result.error,undefined);assert.equal(result.output,'5.5');assert.ok(values(result,'x').some(v=>v[0]==='5.5'));
});
await test('shadowing, scope and uninitialized locals',async()=>{
  const result=await execute('int main(){int x=7;{int x; x=8;}x+=1;return x;}');
  assert.equal(result.error,undefined);assert.equal(result.exitCode,8);assert.ok(values(result,'x').every(v=>v[0]==='7'||v[0]==='8'));
  assert.equal(result.moments[3].variables.length,0,'Do not read the shadowing uninitialized x.');
});
await test('break, continue and helper calls',async()=>{
  const result=await execute('int twice(int x){return x*2;} int main(){int sum=0;for(int i=0;i<5;++i){if(i==1){continue;}if(i==3){break;}sum+=twice(i);}return sum;}');
  assert.equal(result.error,undefined);assert.equal(result.exitCode,4);assert.ok(values(result,'sum').some(v=>v[0]==='4'));
});
await test('a namespace helper named main does not steal program checkpoints',async()=>{
  const result=await execute('namespace helper {int main(){int wrong=99;return wrong;}}\nint main(){int correct=7;return correct;}');
  assert.equal(result.exitCode,7);assert.equal(values(result,'wrong').length,0);assert.ok(values(result,'correct').some(v=>v[0]==='7'));
});
await test('syntax errors, unsupported bodies and filesystem includes fail clearly',async()=>{
  for(const source of ['int main(){int x=;}', 'int main(){for(int i=0;i<2;++i){} if(true)return 0;}','#include "/etc/passwd"\nint main(){}', '#define X 1\nint main(){return X;}']){
    const result=await compile(source);assert.equal(result.status,422);assert.ok(result.payload.error);
  }
});
await test('literal comment markers cannot conceal filesystem includes',async()=>{
  const result=await compile('const char* s="/*";\n#include "/etc/passwd"\n// */\nint main(){}');
  assert.equal(result.status,422);assert.match(result.payload.error,/standard lab headers/);
});
await test('large source rejected before compilation',async()=>{const response=await compile(' '.repeat(17000));assert.equal(response.status,422);});
await test('checkpoint budget stops an infinite instrumented loop',async()=>{
  const result=await execute('int main(){int x=0;while(true){++x;}return 0;}');assert.match(result.error,/Trace limit/);assert.equal(result.moments.length,400);
});
await test('output budget is bounded',async()=>{
  const result=await execute('#include <cstdio>\nint main(){printf("%20000d",1);return 0;}');assert.match(result.error,/Output limit/);assert.ok(result.output.length<=16000);
});
console.log(`${count} C++ integration checks passed.`);
