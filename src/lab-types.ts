export interface WatchValue {
  name:string; address:number; bytes:number; elementBytes:number; kind:number;
  values:string[]; truncated:boolean; storage?:'scalar'|'array'|'vector';
}
export interface MemoryAccess {address:number; bytes:number; line:number; mode:'read'|'write'|'readwrite'; expression:string; inferred?:boolean;}
export interface TraceMoment {
  line:number; phase:'before'|'after'|'entry'|'end'; variables:WatchValue[]; output:string; accesses?:MemoryAccess[];
}
export interface LabResult { moments:TraceMoment[]; output:string; exitCode:number|null; error?:string; }
