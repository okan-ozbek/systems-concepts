import { describe, expect, it } from 'vitest';
import { lessons } from './lessons';
import { Playback, snapshot } from './simulation';
describe('teaching scenarios',()=>{
  it('a warm read avoids a DRAM line fill',()=>{
    const lesson=lessons[0];const cold=lesson.steps(0,'x86');const warm=lesson.steps(1,'x86');
    expect(cold.some(s=>s.route.includes('dram'))).toBe(true);
    expect(warm.some(s=>s.route.includes('dram'))).toBe(false);
    expect(snapshot(cold,cold.length-1).cycles).toBeGreaterThan(snapshot(warm,warm.length-1).cycles);
  });
  it('separating counters eliminates ownership transfers in the example',()=>{
    const lesson=lessons.find(l=>l.id==='false-sharing')!;
    const packed=lesson.steps(0,'x86'),padded=lesson.steps(1,'x86');
    expect(snapshot(packed,3).bytes).toBe(192);
    expect(snapshot(padded,3).bytes).toBe(0);
    expect(snapshot(padded,3).states).toEqual(['M · a','M · b']);
  });
  it('scattered accesses fetch four lines instead of one',()=>{
    const lesson=lessons.find(l=>l.id==='locality')!;
    expect(snapshot(lesson.steps(0,'x86'),3).bytes).toBe(64);
    expect(snapshot(lesson.steps(1,'x86'),3).bytes).toBe(256);
  });
  it('pipelining completes the same three instructions in fewer model beats',()=>{
    const lesson=lessons.find(l=>l.id==='pipeline')!;
    const pipelined=lesson.steps(0,'x86'),serial=lesson.steps(1,'x86');
    expect(snapshot(pipelined,pipelined.length-1).cycles).toBe(6);
    expect(snapshot(serial,serial.length-1).cycles).toBe(12);
    expect(serial.at(-1)!.title).toBe('Retire C');
  });
  it('coherence invalidates the reader before supplying its current value',()=>{
    const steps=lessons.find(l=>l.id==='coherence')!.steps(0,'x86');
    expect(snapshot(steps,2).states).toEqual(['M · 11','I']);
    expect(snapshot(steps,3).states).toEqual(['S · 11','S · 11']);
  });
  it('every lesson and variant contains replayable, explained steps',()=>{
    for(const lesson of lessons)for(const arch of ['x86','arm','numa'] as const)for(const v of [0,1]){
      const steps=lesson.steps(v,arch);
      expect(steps.length).toBeGreaterThan(1);
      for(const step of steps){expect(step.route.length).toBeGreaterThan(0);expect(step.detail.length).toBeGreaterThan(15);}
    }
  });
});
describe('playback',()=>{
  it('advances, wraps, and stays paused when requested',()=>{
    const p=new Playback();p.tick(3,3);expect(p.index).toBe(1);
    p.tick(6,3);expect(p.index).toBe(0);
    p.playing=false;p.tick(50,3);expect(p.index).toBe(0);
  });
  it('ends without wrapping when repeat is off',()=>{
    const p=new Playback();p.loop=false;p.tick(20,2);
    expect(p.index).toBe(1);expect(p.playing).toBe(false);expect(p.progress).toBe(1);
  });
  it('reconstructs state when seeking backwards',()=>{
    const steps=lessons.find(l=>l.id==='coherence')!.steps(0,'x86');
    expect(snapshot(steps,0).states).toEqual(['S · 10','S · 10']);
    const p=new Playback();p.seek(100,4);expect(p.index).toBe(3);p.seek(-1,4);expect(p.index).toBe(0);
  });
});
