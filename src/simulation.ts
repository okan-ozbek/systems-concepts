import type { Step } from './lessons';
export interface Snapshot {cycles:number; bytes:number; hits:number; misses:number; states:[string,string]; cells:number[]; value:string;}
export function snapshot(steps:Step[], index:number):Snapshot {
  const state:Snapshot = {cycles:0,bytes:0,hits:0,misses:0,states:['—','—'],cells:[],value:'Ready'};
  for (const step of steps.slice(0,Math.max(0,index+1))) {
    state.cycles += step.cycles ?? 0; state.bytes += step.bytes ?? 0;
    state.hits += step.hit ? 1 : 0; state.misses += step.miss ? 1 : 0;
    if(step.states) state.states=[...step.states];
    if(step.cells) state.cells=[...step.cells];
    state.value=step.value ?? step.title;
  }
  return state;
}
export class Playback {
  index=0; progress=0; playing=true; speed=1; loop=true; duration=2.8;
  reset(){this.index=0;this.progress=0;}
  seek(index:number,count:number){this.index=Math.max(0,Math.min(count-1,index));this.progress=0;}
  next(count:number){if(this.index<count-1)this.index++;else if(this.loop)this.index=0;this.progress=0;}
  tick(seconds:number,count:number):boolean {
    if(!this.playing || count<1)return false;
    this.progress += Math.max(0,seconds)*this.speed/this.duration;
    let changed=false;
    while(this.progress>=1){
      this.progress-=1;changed=true;
      if(this.index<count-1)this.index++;
      else if(this.loop)this.index=0;
      else {this.progress=1;this.playing=false;break;}
    }
    return changed;
  }
}
