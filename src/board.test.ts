import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildATXBoard } from './board';
import { lessons, type Architecture } from './lessons';

describe('ATX lesson compatibility',()=>{
  it('provides a finite world-space target for every transfer in every scenario',()=>{
    const scene=new THREE.Scene();const board=buildATXBoard(scene);
    scene.updateMatrixWorld(true);
    for(const arch of ['x86','arm','numa'] as Architecture[])for(const lesson of lessons)for(const variant of [0,1]){
      for(const step of lesson.steps(variant,arch))for(const id of step.route){
        const node=board.nodes.get(id);
        expect(node,`${lesson.id}/${arch}/${variant}: missing ${id}`).toBeDefined();
        expect(node!.getWorldPosition(new THREE.Vector3()).toArray().every(Number.isFinite)).toBe(true);
        expect(board.pickable).toContain(node);
      }
    }
  });
  it('aligns expansion bays and leaves physical clearance around storage and edge connectors',()=>{
    const scene=new THREE.Scene();const board=buildATXBoard(scene);scene.updateMatrixWorld(true);
    const components=board.pickable.filter(part=>part.userData.component);
    const slots=components.filter(part=>part.userData.component.section==='EXPANSION');
    expect(slots).toHaveLength(4);
    for(const slot of slots){
      const b=new THREE.Box3().setFromObject(slot);
      expect(b.min.x).toBeCloseTo(-4,5);
      const row=(b.getCenter(new THREE.Vector3()).z-.77)/1.016;
      expect(row).toBeCloseTo(Math.round(row),5);
    }
    const clearParts=[...slots,...components.filter(part=>
      /^M\.2 \d/.test(part.userData.component.name)||['CMOS battery','Chipset & heatsink','SATA ports','Front-panel connectors','USB 3 header','System fan header','Super I/O controller','Exposed CPU package'].includes(part.userData.component.name)
    )];
    for(let i=0;i<clearParts.length;i++)for(let j=i+1;j<clearParts.length;j++){
      const a=new THREE.Box3().setFromObject(clearParts[i]);const b=new THREE.Box3().setFromObject(clearParts[j]);
      const overlapX=Math.min(a.max.x,b.max.x)-Math.max(a.min.x,b.min.x);
      const overlapZ=Math.min(a.max.z,b.max.z)-Math.max(a.min.z,b.min.z);
      expect(overlapX<=0||overlapZ<=0,`${clearParts[i].userData.component.name} overlaps ${clearParts[j].userData.component.name}`).toBe(true);
      expect(Math.max(Math.abs(a.min.x),Math.abs(a.max.x))).toBeLessThan(6.1);
      expect(Math.max(Math.abs(a.min.z),Math.abs(a.max.z))).toBeLessThan(7.625);
    }
  });
});
