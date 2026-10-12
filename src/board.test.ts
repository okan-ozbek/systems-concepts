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
});
