import { expect, it } from 'vitest';
import * as THREE from 'three';
import { buildATXBoard } from './board';
import { componentPorts, createTransferRoute, hardwareBounds, routeRadius } from './routing';
import { lessons, type Architecture } from './lessons';

it('keeps every lesson transfer outside the hardware in normal and exploded views',()=>{
  const scene=new THREE.Scene();const {nodes,remote}=buildATXBoard(scene);
  const meshes:THREE.Mesh[]=[];
  scene.traverse(part=>{if(part instanceof THREE.Mesh&&part.material instanceof THREE.MeshStandardMaterial&&part.material.opacity>0)meshes.push(part);});
  const baseY=new Map([...nodes].map(([id,node])=>[id,node.position.y]));
  for(const arch of ['x86','arm','numa'] as Architecture[])for(const exploded of [0,.5,1]){
    remote.visible=arch==='numa';
    for(const [id,node] of nodes){
      const offset=!['dram','remote','io'].includes(id)?exploded*(id==='l3'?.48:id.startsWith('l2')?.95:id.startsWith('l1')?1.45:1.95):0;
      node.position.y=baseY.get(id)!+offset;
    }
    scene.updateMatrixWorld(true);
    const bounds=hardwareBounds(meshes);const occupied=bounds.map(box=>box.clone().expandByScalar(routeRadius));
    const routes=new Map(lessons.flatMap(lesson=>[0,1].flatMap(variant=>lesson.steps(variant,arch).map(step=>[step.route.join('/'),step.route] as const))));
    for(const [name,route] of routes){
      if(!route.length)continue;
      const ports=componentPorts(nodes,route);const curve=createTransferRoute(ports,bounds);
      expect(curve.getLength(),name).toBeGreaterThan(0);
      for(const point of curve.getSpacedPoints(100)){
        expect(point.toArray().every(Number.isFinite),name).toBe(true);
        expect(occupied.some(box=>box.containsPoint(point)),`${arch}/lift ${exploded}: ${name} at ${point.toArray()}`).toBe(false);
      }
    }
  }
});
