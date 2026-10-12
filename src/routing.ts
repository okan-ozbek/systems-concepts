import * as THREE from 'three';
import type { NodeId } from './lessons';

export const routeRadius=.06;
const clearance=.4;

export function componentPorts(nodes:Map<NodeId,THREE.Mesh>,route:NodeId[]):THREE.Vector3[]{
  return route.map(id=>{
    const node=nodes.get(id)!;const point=node.getWorldPosition(new THREE.Vector3());
    point.y=new THREE.Box3().setFromObject(node).max.y+.16;return point;
  });
}

// Clip the projected segment against an expanded obstacle footprint.
function crossesFootprint(a:THREE.Vector3,b:THREE.Vector3,box:THREE.Box3){
  let enter=0,exit=1;
  for(const axis of ['x','z'] as const){
    const delta=b[axis]-a[axis];const low=box.min[axis]-.16,high=box.max[axis]+.16;
    if(Math.abs(delta)<1e-8){if(a[axis]<low||a[axis]>high)return false;continue;}
    let t0=(low-a[axis])/delta,t1=(high-a[axis])/delta;
    if(t0>t1)[t0,t1]=[t1,t0];enter=Math.max(enter,t0);exit=Math.min(exit,t1);
    if(enter>exit)return false;
  }
  return true;
}

// Quadratic corners stay inside their control-point hull, avoiding spline overshoot
// into hardware at the base of a vertical rise or near a DIMM.
function roundedLeg(points:THREE.Vector3[],path:THREE.CurvePath<THREE.Vector3>){
  let from=points[0];
  for(let i=1;i<points.length-1;i++){
    const corner=points[i];const before=points[i-1],after=points[i+1];
    const radius=Math.min(.16,corner.distanceTo(before)/3,corner.distanceTo(after)/3);
    const entry=corner.clone().lerp(before,radius/corner.distanceTo(before));
    const leave=corner.clone().lerp(after,radius/corner.distanceTo(after));
    if(from.distanceTo(entry)>1e-6)path.add(new THREE.LineCurve3(from.clone(),entry));
    path.add(new THREE.QuadraticBezierCurve3(entry,corner.clone(),leave));from=leave;
  }
  if(from.distanceTo(points.at(-1)!)>1e-6)path.add(new THREE.LineCurve3(from.clone(),points.at(-1)!.clone()));
}

export function createTransferRoute(ports:THREE.Vector3[],obstacles:THREE.Box3[]):THREE.CurvePath<THREE.Vector3>{
  const path=new THREE.CurvePath<THREE.Vector3>();
  if(!ports.length)return path;
  if(ports.length===1||ports.every(point=>point.distanceTo(ports[0])<1e-6)){
    const center=ports[0].clone();const extent=new THREE.Box3().setFromCenterAndSize(center,new THREE.Vector3(.8,100,.8));
    let height=center.y+clearance;
    for(const box of obstacles)if(box.intersectsBox(extent))height=Math.max(height,box.max.y+clearance);
    const start=center.clone();start.y=height;
    const k=.55228475,r=.26;
    for(let i=0;i<4;i++){
      const angle=i*Math.PI/2,next=angle+Math.PI/2;
      const a=start.clone().add(new THREE.Vector3(Math.cos(angle)*r,0,Math.sin(angle)*r));
      const b=start.clone().add(new THREE.Vector3(Math.cos(next)*r,0,Math.sin(next)*r));
      path.add(new THREE.CubicBezierCurve3(a,a.clone().add(new THREE.Vector3(-Math.sin(angle)*r*k,0,Math.cos(angle)*r*k)),b.clone().add(new THREE.Vector3(Math.sin(next)*r*k,0,-Math.cos(next)*r*k)),b));
    }
    return path;
  }
  for(let i=1;i<ports.length;i++){
    const a=ports[i-1],b=ports[i];if(a.distanceTo(b)<1e-6)continue;
    let height=Math.max(a.y,b.y)+clearance;
    for(const box of obstacles)if(crossesFootprint(a,b,box))height=Math.max(height,box.max.y+clearance);
    const upA=a.clone();const upB=b.clone();upA.y=height;upB.y=height;
    roundedLeg([a,upA,upB,b],path);
  }
  return path;
}

export function hardwareBounds(meshes:THREE.Mesh[]):THREE.Box3[]{
  return meshes.filter(mesh=>{
    let parent:THREE.Object3D|null=mesh;
    while(parent){if(!parent.visible)return false;parent=parent.parent;}return true;
  }).flatMap(mesh=>{
    mesh.geometry.computeBoundingBox();
    const parts=(mesh.userData.obstacleBoxes as THREE.Box3[]|undefined)??[mesh.geometry.boundingBox!];
    return parts.map(box=>box.clone().applyMatrix4(mesh.matrixWorld));
  });
}
