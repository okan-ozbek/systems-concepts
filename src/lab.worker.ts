import type { LabResult, MemoryAccess, TraceMoment, WatchValue } from './lab-types';

// The program receives only these memory-based imports: no filesystem, network,
// eval, browser DOM, environment secrets, or host process capabilities.
self.onmessage=async(event:MessageEvent<{wasm:ArrayBuffer;stdin:string}>)=>{
  const moments:TraceMoment[]=[];let output='';let inputOffset=0;let exitCode:number|null=null;
  let instance:WebAssembly.Instance;let current:TraceMoment|null=null;
  let pending:MemoryAccess[]=[];let accessCount=0;
  const flushPending=()=>{if(current)current.accesses?.push(...pending);pending=[];};
  const decoder=new TextDecoder();const streamDecoder=new TextDecoder();const input=new TextEncoder().encode(event.data.stdin);
  const memory=()=>instance.exports.memory as WebAssembly.Memory;
  const view=()=>new DataView(memory().buffer);
  const write32=(ptr:number,value:number)=>view().setUint32(ptr,value,true);
  const text=(ptr:number,max=128)=>{
    const bytes=new Uint8Array(memory().buffer);let end=ptr;
    while(end<bytes.length&&end<ptr+max&&bytes[end])end++;
    return decoder.decode(bytes.subarray(ptr,end));
  };
  class Exit extends Error {constructor(public code:number){super('Program exited');}}
  const unsupported=()=>76; // WASI ENOTCAPABLE: no host access granted.
  const wasi:Record<string,WebAssembly.ImportValue>={
    proc_exit:(code:number)=>{throw new Exit(code);},
    args_sizes_get:(argc:number,size:number)=>{write32(argc,0);write32(size,0);return 0;}, args_get:()=>0,
    environ_sizes_get:(count:number,size:number)=>{write32(count,0);write32(size,0);return 0;}, environ_get:()=>0,
    fd_write:(fd:number,iovs:number,count:number,result:number)=>{
      if(fd!==1&&fd!==2)return 8;
      let written=0;
      for(let i=0;i<count;i++){
        const ptr=view().getUint32(iovs+i*8,true),len=view().getUint32(iovs+i*8+4,true);
        if(written+len+output.length>16000)throw new Error('Output limit reached (16 KB).');
        output+=streamDecoder.decode(new Uint8Array(memory().buffer,ptr,len),{stream:true});written+=len;
      }
      write32(result,written);return 0;
    },
    fd_read:(fd:number,iovs:number,count:number,result:number)=>{
      if(fd!==0)return 8;let read=0;
      for(let i=0;i<count;i++){
        const ptr=view().getUint32(iovs+i*8,true),len=view().getUint32(iovs+i*8+4,true);
        const chunk=input.subarray(inputOffset,inputOffset+len);
        new Uint8Array(memory().buffer,ptr,chunk.length).set(chunk);inputOffset+=chunk.length;read+=chunk.length;
      }write32(result,read);return 0;
    },
    fd_fdstat_get:(fd:number,ptr:number)=>{
      if(fd>2)return 8;new Uint8Array(memory().buffer,ptr,24).fill(0);view().setUint8(ptr,2);return 0;
    },
    fd_seek:()=>70,fd_close:()=>0,fd_sync:()=>0,fd_datasync:()=>0,
    clock_time_get:(_id:number,_precision:bigint,ptr:number)=>{view().setBigUint64(ptr,BigInt(Date.now())*1000000n,true);return 0;},
    random_get:(ptr:number,len:number)=>{const bytes=new Uint8Array(memory().buffer,ptr,len);for(let i=0;i<len;i+=65536)crypto.getRandomValues(bytes.subarray(i,i+65536));return 0;},
    sched_yield:()=>0
  };
  try{
    const module=await WebAssembly.compile(event.data.wasm);
    for(const item of WebAssembly.Module.imports(module)){
      if(item.module==='wasi_snapshot_preview1'&&!(item.name in wasi))wasi[item.name]=unsupported;
      if(!['lab','wasi_snapshot_preview1'].includes(item.module))throw new Error(`Unsupported program import: ${item.module}.${item.name}`);
    }
    instance=await WebAssembly.instantiate(module,{
      wasi_snapshot_preview1:wasi,
      lab:{
        checkpoint:(line:number,phase:number)=>{
          if(moments.length>=400)throw new Error('Trace limit reached (400 checkpoints). Use a smaller loop.');
          current={line,phase:phase===2?'entry':phase===1?'after':'before',variables:[],output,accesses:pending};pending=[];moments.push(current);
        },
        access:(address:number,bytes:number,line:number,mode:number,expression:number)=>{
          if(++accessCount>50000)throw new Error('Memory access limit reached (50,000 accesses). Use a smaller program.');
          pending.push({address:address>>>0,bytes,line,mode:mode===2?'readwrite':mode===1?'write':'read',expression:text(expression)});
        },
        watch:(namePtr:number,ptr:number,bytes:number,elementBytes:number,kind:number,storage:number)=>{
          if(!current||current.variables.length>=32)return;
          const count=Math.min(32,Math.floor(bytes/elementBytes));const values:string[]=[];
          for(let i=0;i<count;i++){
            const offset=ptr+i*elementBytes;const data=view();let value:number|bigint;
            if(kind===2)value=elementBytes===8?data.getFloat64(offset,true):data.getFloat32(offset,true);
            else if(elementBytes===8)value=kind===1?data.getBigInt64(offset,true):data.getBigUint64(offset,true);
            else if(elementBytes===4)value=kind===1?data.getInt32(offset,true):data.getUint32(offset,true);
            else if(elementBytes===2)value=kind===1?data.getInt16(offset,true):data.getUint16(offset,true);
            else value=kind===1?data.getInt8(offset):data.getUint8(offset);
            values.push(String(value));
          }
          const value:WatchValue={name:text(namePtr),address:ptr>>>0,bytes,elementBytes,kind,values,truncated:bytes/elementBytes>count,storage:storage===2?'vector':storage===1?'array':'scalar'};
          current.variables.push(value);
        }
      }
    });
    (instance.exports._start as ()=>void)();exitCode=0;
  }catch(error){
    if(error instanceof Exit)exitCode=error.code;
    else{
      flushPending();
      const result:LabResult={moments,output,exitCode,error:error instanceof Error?error.message:String(error)};
      self.postMessage(result);return;
    }
  }
  output+=streamDecoder.decode();
  // Return expressions execute after their before checkpoint; retain their
  // accesses on that checkpoint, before the scope disappears at program end.
  flushPending();
  moments.push({line:0,phase:'end',variables:[],output});
  const result:LabResult={moments,output,exitCode};self.postMessage(result);
};
