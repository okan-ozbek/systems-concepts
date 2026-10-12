import {describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {HardwareScene} from './scene';
import {RenderQuality} from './render-quality';

// Exercise the actual render method without requiring a GPU in the test runner.
function fixture(){
  const state={
    lastTime:0,quality:new RenderQuality(),wasAnimating:false,lastProgress:NaN,
    dirty:true,hoverDirty:false,lastHover:0,reducedMotion:false,
    controls:{update:vi.fn()},renderer:{render:vi.fn(),shadowMap:{needsUpdate:false}},
    nodes:new Map(),heights:new Map(),outlines:new Map(),dramMaterials:[],particles:[],active:[],
    scene:{},camera:{},hoverTarget:null,updateRoute:vi.fn(),updateHover:vi.fn(),
    pathMaterial:{color:new THREE.Color()},glowMaterial:{color:new THREE.Color()},
  };
  const render=(time:number,progress:number,animate=false)=>HardwareScene.prototype.render.call(state as unknown as HardwareScene,time,progress,animate);
  return {state,render};
}

describe('render invalidation',()=>{
  it('stops submitting GPU frames once a paused view settles',()=>{
    const {state,render}=fixture();render(1,0);render(2,0);render(3,0);
    expect(state.renderer.render).toHaveBeenCalledTimes(1);
    expect(state.controls.update).toHaveBeenCalledTimes(3);
    render(4,.5);expect(state.renderer.render).toHaveBeenCalledTimes(2);
    state.dirty=true;render(5,.5);expect(state.renderer.render).toHaveBeenCalledTimes(3);
  });
  it('renders playback and changes to the active hardware even at identical progress',()=>{
    const {state,render}=fixture();render(1,0,true);render(2,0,true);
    expect(state.renderer.render).toHaveBeenCalledTimes(2);
    render(3,0);render(4,0);expect(state.renderer.render).toHaveBeenCalledTimes(3);
    HardwareScene.prototype.setStep.call(state as unknown as HardwareScene,{title:'New step',detail:'',route:[]});
    render(5,0);expect(state.renderer.render).toHaveBeenCalledTimes(4);
  });
  it('refreshes shadows while hardware moves but reuses them after settling',()=>{
    const {state,render}=fixture();
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());
    state.nodes.set('l3',mesh);state.heights.set('l3',1);
    state.outlines.set('l3',new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial()));
    render(1,0);render(1.1,0);
    expect(mesh.position.y).toBeGreaterThan(0);
    expect(state.renderer.shadowMap.needsUpdate).toBe(true);expect(state.updateRoute).toHaveBeenCalled();
    mesh.position.y=1;state.renderer.shadowMap.needsUpdate=false;state.hoverDirty=false;
    render(2,0);expect(state.renderer.shadowMap.needsUpdate).toBe(false);
  });
});
