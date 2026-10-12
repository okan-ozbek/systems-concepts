import { expect, it } from 'vitest';
import { DataCache, accessRoute, lineValues, modelTrace, type CacheConfig } from './lab-cache';
import type { MemoryAccess, TraceMoment, WatchValue } from './lab-types';

const access=(address:number,mode:MemoryAccess['mode']='read',bytes=4):MemoryAccess=>({address,bytes,mode,line:3,expression:'values[i]'});
const small:CacheConfig={lineBytes:64,levels:[{name:'L1',bytes:64,ways:1},{name:'L2',bytes:256,ways:1},{name:'L3',bytes:512,ways:1}]};
const vector=(address=0x1000,values=['1','2','3','4']):WatchValue=>({name:'values',address,bytes:values.length*4,elementBytes:4,kind:1,values,truncated:false,storage:'vector'});
const moment=(variables:WatchValue[],accesses:MemoryAccess[]=[],line=3):TraceMoment=>({variables,accesses,line,phase:'after',output:''});

it('fills one 64-byte line for sixteen contiguous ints, then fetches the next line',()=>{
  const cache=new DataCache();const scan=Array.from({length:17},(_,i)=>cache.access(access(0x1000+i*4))[0]);
  expect(scan.map(a=>a.servedBy)).toEqual(['DRAM',...Array(15).fill('L1'),'DRAM']);
  expect(scan[15].lineBase).toBe(0x1000);expect(scan[16].lineBase).toBe(0x1040);
  expect(accessRoute(scan[1])).toEqual(['reg0','l10','reg0']);
});

it('uses address alignment, and splits a load spanning two lines',()=>{
  const cache=new DataCache();expect(cache.access(access(62,'read',4)).map(a=>[a.address,a.bytes,a.lineBase])).toEqual([[62,2,0],[64,2,64]]);
  expect(cache.access(access(66))[0].servedBy).toBe('L1');
});

it('models write allocation, reuse of dirty data, and deferred writeback',()=>{
  const cache=new DataCache(small);const store=cache.access(access(0,'write'))[0];
  expect(store.servedBy).toBe('DRAM');expect(store.dirty).toBe(true);expect(store.writebacks).toEqual([]);
  expect(cache.access(access(4))[0].servedBy).toBe('L1');
  const evict=cache.access(access(64))[0];expect(evict.writebacks).toEqual([{lineBase:0,from:'L1',to:'L2'}]);
  expect(cache.access(access(0))[0].servedBy).toBe('L2');
});

it('finds L3 hits after conflict eviction from L1/L2 and uses per-set LRU',()=>{
  const config:CacheConfig={lineBytes:64,levels:[{name:'L1',bytes:128,ways:2},{name:'L2',bytes:512,ways:4},{name:'L3',bytes:1024,ways:4}]};
  const cache=new DataCache(config);
  cache.access(access(0));cache.access(access(128));cache.access(access(0));cache.access(access(256));
  expect(cache.access(access(0))[0].servedBy).toBe('L1');
  expect(cache.access(access(128))[0].servedBy).toBe('L2');
  const conflicts=new DataCache({lineBytes:64,levels:[{name:'L1',bytes:64,ways:1},{name:'L2',bytes:128,ways:1},{name:'L3',bytes:1024,ways:2}]});
  conflicts.access(access(0));conflicts.access(access(128));expect(conflicts.access(access(0))[0].servedBy).toBe('L3');
});

it('preserves dirty data when the inclusive last-level cache evicts a line',()=>{
  const config:CacheConfig={lineBytes:64,levels:[{name:'L1',bytes:64,ways:1},{name:'L2',bytes:64,ways:1},{name:'L3',bytes:64,ways:1}]};
  const cache=new DataCache(config);cache.access(access(0,'write'));
  expect(cache.access(access(64))[0].writebacks).toEqual([{lineBase:0,from:'L3',to:'DRAM'}]);
  expect(cache.access(access(0))[0].servedBy).toBe('DRAM');
});

it('includes vector initialization so a small fresh vector is already warm when iterated',()=>{
  const v=vector();const trace=[moment([v]),...Array.from({length:4},(_,i)=>moment([v],[access(v.address+i*4)],4))];
  const modeled=modelTrace(trace,'int main() {}');
  expect(modeled[0].accesses[0]).toMatchObject({inferred:true,mode:'write',servedBy:'DRAM',dirty:true});
  expect(modeled.slice(1).every(m=>m.accesses[0].servedBy==='L1')).toBe(true);
  expect(modeled.at(-1)!.stats).toMatchObject({dram:1,l1:4});
  expect(modeled[2].step.route).not.toContain('dram');
  const cells=lineValues(modeled[2].accesses[0],[v])!;expect(cells.values.filter(v=>v.active).map(v=>v.index)).toEqual([1]);
});

it('detects vector buffer relocation and does not treat repeated snapshots as program loads',()=>{
  const v=vector();const moved=vector(0x2000,['1','2','3','4','5']);
  const result=modelTrace([moment([v]),moment([v]),moment([moved])],'');
  expect(result[1].accesses).toEqual([]);expect(result[1].stats).toEqual(result[0].stats);
  expect(result[2].accesses.map(a=>[a.mode,a.lineBase,a.inferred])).toEqual([['read',0x1000,true],['write',0x2000,true]]);
});

it('does not count captured stores twice, and playback seeking cannot change cache results',()=>{
  const v=vector();const changed=vector(0x1000,['1','9','3','4']);
  const trace=[moment([v]),moment([changed],[access(0x1004,'write')]),moment([changed],[access(0x1004)])];
  const result=modelTrace(trace,'');expect(result[1].accesses).toHaveLength(1);
  expect(result[2].accesses[0].servedBy).toBe('L1');expect(modelTrace(trace,'')).toEqual(result);
});

it('does not invent element copies when vector buffers change ownership via swap or move',()=>{
  const a={...vector(0x1000),name:'a'};const b={...vector(0x2000),name:'b'};
  const result=modelTrace([moment([a,b]),moment([{...b,name:'a'},{...a,name:'b'}]),moment([{...a,name:'c'}])],'');
  expect(result[1].accesses).toEqual([]);expect(result[2].accesses).toEqual([]);
});

it('stops prediction at a bounded budget instead of inventing results for very large buffers',()=>{
  const large={...vector(),bytes:64*50001,truncated:true};
  const result=modelTrace([moment([large]),moment([large],[access(large.address)])],'');
  expect(result.every(m=>m.limited&&m.step.route.length===0)).toBe(true);
});
