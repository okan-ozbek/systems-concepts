export interface WatchValue {
  name:string; address:number; bytes:number; elementBytes:number; kind:number;
  values:string[]; truncated:boolean;
}
export interface TraceMoment {
  line:number; phase:'before'|'after'|'entry'|'end'; variables:WatchValue[]; output:string;
}
export interface LabResult { moments:TraceMoment[]; output:string; exitCode:number|null; error?:string; }
