import {describe,it,expect} from 'vitest';
import {RenderQuality} from './render-quality';

describe('adaptive rendering',()=>{
  const feed=(quality:RenderQuality,frames:number,delta:number)=>{for(let i=0;i<frames;i++)quality.sample(delta);};
  it('reduces quality after sustained slow rendering and recovers more cautiously',()=>{
    const quality=new RenderQuality();feed(quality,60,.05);expect(quality.tier).toBe('balanced');
    feed(quality,120,.05);expect(quality.tier).toBe('low');
    feed(quality,305,1/60);expect(quality.tier).toBe('balanced');
    feed(quality,305,1/60);expect(quality.tier).toBe('high');
  });
  it('ignores isolated stalls and resets samples after idle/hidden gaps',()=>{
    const quality=new RenderQuality();feed(quality,40,.05);quality.sample(10);
    feed(quality,20,.05);expect(quality.tier).toBe('high');
    feed(quality,300,1/60);expect(quality.tier).toBe('high');
  });
  it('respects the initial ceiling on smaller devices',()=>{
    const quality=new RenderQuality('balanced');feed(quality,600,1/120);expect(quality.tier).toBe('balanced');
  });
  it('also reduces quality at very low frame rates',()=>{
    const quality=new RenderQuality();feed(quality,12,.3);expect(quality.tier).toBe('balanced');
  });
});
