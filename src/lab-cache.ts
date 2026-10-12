import type { NodeId, Step } from './lessons';
import type { MemoryAccess, TraceMoment, WatchValue } from './lab-types';
import { explainMoment } from './lab-model';

export type CacheLevel='L1'|'L2'|'L3'|'DRAM';
export interface CacheConfig {lineBytes:number; levels:{name:Exclude<CacheLevel,'DRAM'>; bytes:number; ways:number}[];}
export const cacheConfig:CacheConfig={lineBytes:64,levels:[{name:'L1',bytes:32*1024,ways:8},{name:'L2',bytes:256*1024,ways:8},{name:'L3',bytes:8*1024*1024,ways:16}]};
interface Line {dirty:boolean;}
export interface Writeback {lineBase:number; from:Exclude<CacheLevel,'DRAM'>; to:CacheLevel;}
export interface CacheAccess extends MemoryAccess {lineBase:number; servedBy:CacheLevel; dirty:boolean; writebacks:Writeback[];}
export interface CacheStats {l1:number; l2:number; l3:number; dram:number; fills:number; writebacks:number;}
export interface ModeledMoment {step:Step; accesses:CacheAccess[]; focus:CacheAccess|null; stats:CacheStats; resident:number[]; limited:boolean;}

// A deterministic single-core, inclusive, set-associative data-cache model.
// Addresses come from the instrumented wasm32 program, not host physical memory.
export class DataCache {
  private sets:Map<number,Map<number,Line>>[];
  readonly stats:CacheStats={l1:0,l2:0,l3:0,dram:0,fills:0,writebacks:0};
  constructor(readonly config:CacheConfig=cacheConfig){
    if(config.levels.length!==3||config.lineBytes<=0||config.levels.some(l=>l.ways<1||l.bytes<l.ways*config.lineBytes||l.bytes%(l.ways*config.lineBytes)!==0))throw new Error('Invalid cache geometry');
    this.sets=config.levels.map(()=>new Map());
  }
  private set(level:number,line:number){
    const geometry=this.config.levels[level];const index=line%(geometry.bytes/(geometry.ways*this.config.lineBytes));
    let set=this.sets[level].get(index);if(!set){set=new Map();this.sets[level].set(index,set);}return set;
  }
  private insert(level:number,line:number,dirty:boolean,writebacks:Writeback[]){
    const set=this.set(level,line);const old=set.get(line);
    if(old){old.dirty||=dirty;set.delete(line);set.set(line,old);return;}
    if(set.size===this.config.levels[level].ways){
      const [victim,state]=set.entries().next().value!;set.delete(victim);
      // Inclusive lower-level eviction also invalidates upper copies, retaining
      // modified data before forwarding it to the next level.
      for(let upper=0;upper<level;upper++){
        const upperSet=this.set(upper,victim);state.dirty||=upperSet.get(victim)?.dirty??false;upperSet.delete(victim);
      }
      if(state.dirty){
        writebacks.push({lineBase:victim*this.config.lineBytes,from:this.config.levels[level].name,to:level===2?'DRAM':this.config.levels[level+1].name});this.stats.writebacks++;
        if(level<2)this.insert(level+1,victim,true,writebacks);
      }
    }
    set.set(line,{dirty});
  }
  access(access:MemoryAccess):CacheAccess[]{
    const results:CacheAccess[]=[];
    for(let address=access.address;address<access.address+access.bytes;){
      const line=Math.floor(address/this.config.lineBytes);const lineBase=line*this.config.lineBytes;
      const bytes=Math.min(access.address+access.bytes-address,lineBase+this.config.lineBytes-address);
      let level=0;while(level<3&&!this.set(level,line).has(line))level++;
      const servedBy:CacheLevel=level===3?'DRAM':this.config.levels[level].name;
      const key=servedBy.toLowerCase() as 'l1'|'l2'|'l3'|'dram';this.stats[key]++;
      const writebacks:Writeback[]=[];
      if(level===3)this.stats.fills++;
      // A hit touches that cache's LRU; only missed upper levels get a fill.
      for(let target=Math.min(level,2);target>=0;target--)this.insert(target,line,false,writebacks);
      const state=this.set(0,line).get(line)!;if(access.mode!=='read')state.dirty=true;
      results.push({...access,address,bytes,lineBase,servedBy,dirty:state.dirty,writebacks});address+=bytes;
    }
    return results;
  }
  resident(){return this.sets.map(sets=>[...sets.values()].reduce((sum,set)=>sum+set.size,0));}
}

function inferredWrites(moment:TraceMoment,previous:TraceMoment|undefined):MemoryAccess[]{
  const events:MemoryAccess[]=[];
  for(const variable of moment.variables){
    if(variable.storage==='scalar'||(!variable.storage&&variable.bytes===variable.elementBytes)||!variable.bytes)continue;
    const old=previous?.variables.find(v=>v.name===variable.name);
    const event=(address:number,bytes:number,mode:MemoryAccess['mode'],expression:string)=>({address,bytes,line:moment.line,mode,expression,inferred:true});
    if(!old||old.address!==variable.address){
      // swap / move can transfer ownership without copying elements. Recognize
      // a buffer already belonging to another watched vector before this step.
      const transferred=variable.storage==='vector'&&previous?.variables.some(v=>v.name!==variable.name&&v.storage==='vector'&&v.address===variable.address&&v.bytes>=variable.bytes);
      if(transferred)continue;
      const preserved=old&&variable.bytes>=old.bytes&&old.values.every((value,i)=>value===variable.values[i]);
      if(old?.bytes&&variable.storage==='vector'&&preserved)events.push(event(old.address,old.bytes,'read',`${variable.name} · buffer relocation (inferred copy)`));
      events.push(event(variable.address,variable.bytes,'write',`${variable.name} · ${old?'new buffer':'initialization'} (inferred stores)`));
      continue;
    }
    for(let i=0;i<variable.values.length;i++){
      const address=variable.address+i*variable.elementBytes;
      if(variable.values[i]===old.values[i]||address>=old.address+old.bytes)continue;
      const captured=moment.accesses?.some(a=>a.mode!=='read'&&a.address<=address&&a.address+a.bytes>=address+variable.elementBytes);
      if(!captured)events.push(event(address,variable.elementBytes,'write',`${variable.name}[${i}] · changed value (inferred store)`));
    }
    if(variable.bytes>old.bytes)events.push(event(variable.address+old.bytes,variable.bytes-old.bytes,'write',`${variable.name} · appended elements (inferred stores)`));
  }
  return events;
}

const cacheNodes:Record<CacheLevel,NodeId>={L1:'l10',L2:'l20',L3:'l3',DRAM:'dram'};
export function accessRoute(access:CacheAccess):NodeId[]{
  const chain:NodeId[]=['reg0','l10','l20','l3','dram'];const end=chain.indexOf(cacheNodes[access.servedBy]);
  const request=chain.slice(0,end+1);const returned=request.slice(0,-1).reverse();
  let route:NodeId[]=access.mode==='write'?(end===1?['reg0','l10']:[...request,...returned.slice(0,-1),'reg0','l10']):[...request,...returned];
  if(access.mode==='readwrite')route.push('l10');
  for(const wb of access.writebacks)route.push(cacheNodes[wb.from],cacheNodes[wb.to]);
  return route;
}

export function modelTrace(moments:TraceMoment[],source:string,config:CacheConfig=cacheConfig):ModeledMoment[]{
  const cache=new DataCache(config);let lineBudget=50000;let limited=false;
  return moments.map((moment,index)=>{
    const accesses:CacheAccess[]=[];const events=[...(moment.accesses??[]),...inferredWrites(moment,moments[index-1])];
    for(const event of events){
      const count=Math.ceil(((event.address%config.lineBytes)+event.bytes)/config.lineBytes);
      if(count>lineBudget){limited=true;break;}lineBudget-=count;
      if(!limited)accesses.push(...cache.access(event));
    }
    let step=explainMoment(moment,source);let focus:CacheAccess|null=null;
    if(accesses.length){
      const visible=accesses.filter(a=>!a.inferred);const illustrated=visible.length?visible:accesses;
      // The animation highlights the furthest demand in this checkpoint; the
      // ordered access list preserves every modeled lookup and writeback.
      const priority:Record<CacheLevel,number>={L1:0,L2:1,L3:2,DRAM:3};
      focus=illustrated.reduce((a,b)=>priority[a.servedBy]>=priority[b.servedBy]?a:b);
      const hits=accesses.filter(a=>a.servedBy==='L1').length;const dram=accesses.filter(a=>a.servedBy==='DRAM').length;
      const operation=focus.mode==='read'?'Read':focus.mode==='write'?'Store':'Read / modify / store';
      const behavior=focus.servedBy==='DRAM'?`A miss in all caches fetches an aligned ${config.lineBytes} B line through L3 → L2 → L1.`:`${focus.servedBy} serves the resident line. Nearby elements can reuse it without a DRAM demand fetch.`;
      const stores=accesses.some(a=>a.mode!=='read')?' Stores leave dirty lines; writeback happens on eviction.':'';
      const inferred=focus.inferred?' Buffer initialization / library effects are inferred.':'';
      const route=accessRoute(focus);if(step.route.includes('io'))route.push('io');
      step={...step,title:`${moment.phase==='entry'?`Condition / scope · line ${moment.line}`:step.title} · ${focus.servedBy==='DRAM'?'line fill':`${focus.servedBy} hit`}`,route,signal:'data',hit:focus.servedBy!=='DRAM',miss:focus.servedBy==='DRAM',bytes:focus.servedBy==='DRAM'?config.lineBytes:focus.bytes,
        detail:`${operation}: ${behavior}${stores}${inferred} ${hits} L1 hits / ${dram} DRAM fills here. Animation: furthest explicit access; ordered details below.`};
    }
    if(limited)step={...step,route:[],detail:'Cache simulation stopped at its 50,000-line budget. Program values and output remain captured; no further cache behavior is predicted.'};
    return {step,accesses,focus,stats:{...cache.stats},resident:cache.resident(),limited};
  });
}

export function lineValues(access:CacheAccess,variables:WatchValue[],lineBytes=64){
  const variable=variables.find(v=>access.address>=v.address&&access.address<v.address+v.bytes);
  if(!variable)return null;
  return {name:variable.name,values:variable.values.flatMap((value,index)=>{
    const address=variable.address+index*variable.elementBytes;
    if(address<access.lineBase||address>=access.lineBase+lineBytes)return [];
    return [{index,value,address,active:address<access.address+access.bytes&&address+variable.elementBytes>access.address}];
  })};
}
