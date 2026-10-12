import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildATXBoard, type ComponentInfo } from './board';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { componentPorts, createTransferRoute, hardwareBounds } from './routing';
import type { Architecture, NodeId, Step } from './lessons';

export const nodeInfo:Record<NodeId,{name:string;detail:string}>={
  reg0:{name:'Core 0 registers',detail:'Operands currently available to core 0’s execution units. These are much smaller than a cache.'},
  reg1:{name:'Core 1 registers',detail:'Core 1 has its own register state. A scheduled thread uses these execution resources.'},
  l10:{name:'Core 0 · L1 data cache',detail:'The closest data cache in this model. A valid line can satisfy a load without accessing lower cache levels.'},
  l11:{name:'Core 1 · L1 data cache',detail:'A private copy is usable only if its coherence state permits the access. Invalid lines cannot serve a load.'},
  l20:{name:'Core 0 · L2 cache',detail:'A larger private cache between L1 and the shared last-level cache.'},
  l21:{name:'Core 1 · L2 cache',detail:'This generic design gives each core a private L2. Other real designs can share L2 between cores.'},
  l3:{name:'Shared L3 cache',detail:'A last-level cache shared by the two shown cores. Real processors can distribute it across multiple slices.'},
  dram:{name:'Main memory · DRAM',detail:'Off-chip memory organized into channels, banks, and rows. Much larger than caches, with a longer access path.'},
  remote:{name:'NUMA node 1',detail:'A collapsed second compute and memory node. Requests from node 0 cross an inter-node link to access memory placed here.'},
  alu:{name:'Arithmetic logic unit',detail:'An execution unit performs operations on register operands. A core has multiple types of execution resources.'},
  tlb:{name:'Translation lookaside buffer',detail:'Caches virtual-to-physical page translations. A TLB miss may require a page-table walk; it is not automatically a page fault.'},
  io:{name:'I/O expansion',detail:'A motherboard also connects devices through I/O interconnects. This slot is context for the model; the lessons focus on CPU and memory.'}
};
const colors={request:0xf2ac6c,data:0x8fe4be,ownership:0xc3adfa,invalidate:0xf37575,compute:0x96cafa};
const routeSamples=128;

export class HardwareScene {
  renderer:THREE.WebGLRenderer;
  scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(38,1,.1,150);
  controls:OrbitControls;nodes:Map<NodeId,THREE.Mesh>;
  active:NodeId[]=[];arch:Architecture='x86';exploded=false;top=false;
  private closeView=false;
  private remoteGroup:THREE.Group;
  private pickable:THREE.Object3D[];
  private accessibleComponents:HTMLElement;
  private baseY=new Map<THREE.Object3D,number>();
  private heights=new Map<NodeId,number>();
  private outlines=new Map<NodeId,THREE.LineSegments>();
  private dramMaterials:THREE.MeshStandardMaterial[]=[];
  private raycaster=new THREE.Raycaster();
  private pointer=new THREE.Vector2();private pointerClient=new THREE.Vector2();
  private pointerInside=false;private dragging=false;private lastHover=0;
  private tooltip:HTMLElement;private tooltipTitle:HTMLElement;private tooltipDetail:HTMLElement;private tooltipSection:HTMLElement;
  private hoverOutline:THREE.BoxHelper;private hoverTarget:THREE.Object3D|null=null;
  private glowMaterial:THREE.SpriteMaterial;
  private flow=new THREE.Group();private pathGeometry=new LineGeometry();
  private pathMaterial=new LineMaterial({linewidth:4,transparent:true,opacity:.95,depthWrite:false,toneMapped:false});
  private hardwareMeshes:THREE.Mesh[]=[];private anchors:THREE.Mesh[]=[];
  private particles:THREE.Mesh[]=[];private curve:THREE.CurvePath<THREE.Vector3>|null=null;
  private flowColor:number=colors.request;private lastTime=0;
  private reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private container:HTMLElement,private onSelect:(id:NodeId)=>void){
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x17241d,0);this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.25;
    this.renderer.domElement.setAttribute('aria-label','Interactive ATX motherboard. Left-drag to orbit, right-drag to move, scroll to zoom, hover to identify components, or click the CPU and memory units to inspect.');
    this.container.append(this.renderer.domElement);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);
    this.controls.enableDamping=true;this.controls.minDistance=6;this.controls.maxDistance=100;
    this.controls.maxPolarAngle=Math.PI/2.12;this.controls.enablePan=true;this.controls.screenSpacePanning=true;
    this.controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN};
    this.scene.add(new THREE.HemisphereLight(0xe5f5ec,0x1a2c26,2.4));
    const sun=new THREE.DirectionalLight(0xfff5de,3.2);sun.position.set(-8,18,9);sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-15;sun.shadow.camera.right=15;
    sun.shadow.camera.top=15;sun.shadow.camera.bottom=-15;sun.shadow.normalBias=.025;this.scene.add(sun);
    const rim=new THREE.DirectionalLight(0x95b7bc,2);rim.position.set(7,7,-9);this.scene.add(rim);
    const board=buildATXBoard(this.scene);this.nodes=board.nodes;this.pickable=board.pickable;this.remoteGroup=board.remote;
    this.scene.traverse(part=>{if(part instanceof THREE.Mesh&&part.material instanceof THREE.MeshStandardMaterial&&part.material.opacity>0)this.hardwareMeshes.push(part);});
    for(const [id,mesh] of this.nodes){
      this.baseY.set(mesh,mesh.position.y);this.heights.set(id,mesh.position.y);
      mesh.geometry.computeBoundingBox();const size=mesh.geometry.boundingBox!.getSize(new THREE.Vector3()).multiplyScalar(1.045);
      const outline=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x,size.y,size.z)),new THREE.LineBasicMaterial({color:colors.request,transparent:true,opacity:0}));
      mesh.add(outline);this.outlines.set(id,outline);
      if(id==='dram'||id==='io')mesh.raycast=()=>{};
    }
    this.nodes.get('dram')!.traverse(part=>{
      if(part instanceof THREE.Mesh&&part!==this.nodes.get('dram')&&part.material instanceof THREE.MeshStandardMaterial){
        part.material=part.material.clone();this.dramMaterials.push(part.material);
      }
    });
    const glowCanvas=document.createElement('canvas');glowCanvas.width=64;glowCanvas.height=64;
    const ctx=glowCanvas.getContext('2d')!;const gradient=ctx.createRadialGradient(32,32,0,32,32,32);
    gradient.addColorStop(0,'rgba(255,255,255,.9)');gradient.addColorStop(.15,'rgba(255,255,255,.4)');gradient.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);
    this.glowMaterial=new THREE.SpriteMaterial({map:new THREE.CanvasTexture(glowCanvas),transparent:true,opacity:.48,depthWrite:false,blending:THREE.AdditiveBlending});
    this.pathGeometry.setPositions(new Float32Array((routeSamples+1)*3));
    const path=new Line2(this.pathGeometry,this.pathMaterial);path.renderOrder=2;this.flow.add(path);
    const markerGeometry=new THREE.RingGeometry(.085,.13,24);
    for(let i=0;i<this.nodes.size;i++){
      const marker=new THREE.Mesh(markerGeometry,new THREE.MeshBasicMaterial({transparent:true,opacity:.95,side:THREE.DoubleSide,depthWrite:false,toneMapped:false}));
      marker.rotation.x=-Math.PI/2;marker.visible=false;this.flow.add(marker);this.anchors.push(marker);
    }
    const sphere=new THREE.SphereGeometry(.045,8,8);const arrow=new THREE.ConeGeometry(.09,.24,10);
    for(let i=0;i<24;i++){
      const particle=new THREE.Mesh(i%8===0?arrow:sphere,new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,depthWrite:false,toneMapped:false}));
      // Draw transparent markers after the path while preserving hardware depth testing.
      particle.renderOrder=4;
      if(i%8===0){const glow=new THREE.Sprite(this.glowMaterial);glow.renderOrder=3;glow.scale.set(.3,.3,.3);particle.add(glow);}
      this.flow.add(particle);this.particles.push(particle);
    }
    this.scene.add(this.flow);
    this.hoverOutline=new THREE.BoxHelper(new THREE.Object3D(),0xc7d6cd);this.hoverOutline.visible=false;
    (this.hoverOutline.material as THREE.LineBasicMaterial).transparent=true;(this.hoverOutline.material as THREE.LineBasicMaterial).opacity=.4;
    this.scene.add(this.hoverOutline);
    this.tooltip=document.createElement('div');this.tooltip.id='hardware-tooltip';this.tooltip.className='hardware-tooltip';
    this.tooltip.setAttribute('role','tooltip');this.tooltip.hidden=true;
    this.tooltipSection=document.createElement('span');this.tooltipSection.className='hardware-tooltip-section';
    this.tooltipTitle=document.createElement('strong');this.tooltipDetail=document.createElement('p');
    this.tooltip.append(this.tooltipSection,this.tooltipTitle,this.tooltipDetail);this.container.append(this.tooltip);
    const overlay=document.createElement('div');overlay.className='component-accessibility';
    (document.getElementById('component-controls')??this.container).append(overlay);this.accessibleComponents=overlay;
    for(const id of this.nodes.keys()){
      const el=document.createElement('button');el.dataset.node=id;el.textContent=nodeInfo[id].name;el.hidden=id==='remote';
      el.addEventListener('click',()=>this.onSelect(id));overlay.append(el);
    }
    const down=new THREE.Vector2();const canvas=this.renderer.domElement;
    canvas.addEventListener('pointermove',e=>{
      this.pointerInside=e.pointerType!=='touch';this.pointerClient.set(e.clientX,e.clientY);
      const r=canvas.getBoundingClientRect();this.pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);
      if(e.buttons){this.dragging=true;this.hideHover();}
    });
    canvas.addEventListener('pointerleave',()=>{this.pointerInside=false;this.hideHover();});
    canvas.addEventListener('pointerdown',e=>{down.set(e.clientX,e.clientY);this.dragging=true;this.hideHover();});
    canvas.addEventListener('pointerup',e=>{
      this.dragging=false;if(e.button!==0||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;
      const r=canvas.getBoundingClientRect();this.pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);
      const hit=this.pick();const id=hit?.object.userData.node as NodeId|undefined;if(id)this.onSelect(id);
    });
    canvas.addEventListener('pointercancel',()=>{this.dragging=false;this.pointerInside=false;this.hideHover();});
    this.controls.addEventListener('start',()=>this.hideHover());
    new ResizeObserver(()=>this.resize()).observe(container);this.resize();
  }
  private pick():{object:THREE.Object3D;info:ComponentInfo}|null {
    this.raycaster.setFromCamera(this.pointer,this.camera);
    for(const hit of this.raycaster.intersectObjects(this.pickable,true)){
      let visible=true;let current:THREE.Object3D|null=hit.object;
      while(current){if(!current.visible){visible=false;break;}current=current.parent;}
      if(!visible||hit.object instanceof THREE.Line||hit.object instanceof THREE.Sprite)continue;
      current=hit.object;
      while(current){
        const id=current.userData.node as NodeId|undefined;
        if(id){const info=id==='l3'&&this.arch==='arm'?{...nodeInfo.l3,name:'Cluster L3 cache'}:nodeInfo[id];return {object:current,info:{...info,section:['dram','remote','io'].includes(id)?'MEMORY & INTERCONNECT':'CPU CUTAWAY'}};}
        if(current.userData.component)return {object:current,info:current.userData.component as ComponentInfo};
        current=current.parent;
      }
    }
    return null;
  }
  private hideHover(){this.tooltip.hidden=true;this.hoverOutline.visible=false;this.hoverTarget=null;this.renderer.domElement.style.cursor='grab';}
  private updateHover(){
    if(!this.pointerInside||this.dragging){this.hideHover();return;}
    const hit=this.pick();if(!hit){this.hideHover();return;}
    this.tooltipSection.textContent=hit.info.section;this.tooltipTitle.textContent=hit.info.name;this.tooltipDetail.textContent=hit.info.detail;
    this.tooltip.hidden=false;this.renderer.domElement.style.cursor='pointer';
    if(this.hoverTarget!==hit.object){this.hoverTarget=hit.object;this.hoverOutline.setFromObject(hit.object);}
    this.hoverOutline.visible=hit.info.section!=='BOARD'&&hit.object.userData.node!=='dram';
    const w=this.tooltip.offsetWidth;const h=this.tooltip.offsetHeight;
    const x=Math.max(12,Math.min(this.pointerClient.x+18,innerWidth-w-12));
    const y=this.pointerClient.y+h+22>innerHeight?this.pointerClient.y-h-14:this.pointerClient.y+20;
    this.tooltip.style.transform=`translate(${x}px,${Math.max(12,y)}px)`;
  }
  resize(){
    const {width,height}=this.container.getBoundingClientRect();if(!width||!height)return;
    const oldAspect=this.camera.aspect;this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.renderer.setSize(width,height);
    this.pathMaterial.resolution.set(width,height);
    if((oldAspect<.9)!==(this.camera.aspect<.9)||oldAspect===1)this.resetCamera();
  }
  setArchitecture(arch:Architecture){
    this.arch=arch;this.remoteGroup.visible=arch==='numa';
    this.accessibleComponents.querySelector<HTMLButtonElement>('[data-node="remote"]')!.hidden=arch!=='numa';
    this.hideHover();if(!this.closeView)this.resetCamera();
  }
  setExploded(enabled:boolean){
    this.exploded=enabled;this.hideHover();
    for(const [id,mesh] of this.nodes){
      const offset=enabled&&!['dram','remote','io'].includes(id)?(id==='l3'?.48:id.startsWith('l2')?.95:id.startsWith('l1')?1.45:1.95):0;
      this.heights.set(id,this.baseY.get(mesh)!+offset);if(this.reducedMotion)mesh.position.y=this.heights.get(id)!;
    }
  }
  resetCamera(){
    this.closeView=false;this.top=false;const scale=Math.max(1,.83/this.camera.aspect);
    this.controls.target.set(this.arch==='numa'?1.8:0,.35,0);this.camera.position.set(14*scale,21*scale,22*scale);this.controls.update();this.hideHover();
  }
  focusCPU(){
    this.closeView=!this.closeView;this.top=false;
    if(!this.closeView){this.resetCamera();return;}
    const scale=Math.max(1,.95/this.camera.aspect);
    this.controls.target.set(.7,.65,-3.2);this.camera.position.set(8.8*scale,11.5*scale,8.6*scale-3.2);this.controls.update();this.hideHover();
  }
  topView(){
    this.top=!this.top;this.closeView=false;
    if(this.top){this.camera.position.set(0,28*Math.max(1,.83/this.camera.aspect),.001);this.controls.target.set(0,0,0);this.controls.update();this.hideHover();}
    else this.resetCamera();
  }
  setStep(step:Step){
    this.active=step.route;this.flowColor=colors[step.signal??'request'];
    this.pathMaterial.color.setHex(this.flowColor);this.glowMaterial.color.setHex(this.flowColor);
    for(const p of this.particles)(p.material as THREE.MeshBasicMaterial).color.setHex(this.flowColor).lerp(new THREE.Color(0xffffff),.65);
    this.updateRoute();
  }
  private updateRoute(){
    if(!this.active.length){this.flow.visible=false;this.curve=null;return;}this.flow.visible=true;
    this.scene.updateMatrixWorld(true);
    const ports=componentPorts(this.nodes,this.active);
    this.curve=createTransferRoute(ports,hardwareBounds(this.hardwareMeshes));
    const samples=this.curve.getSpacedPoints(routeSamples);
    const start=this.pathGeometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute;
    const end=this.pathGeometry.getAttribute('instanceEnd') as THREE.InterleavedBufferAttribute;
    for(let i=0;i<routeSamples;i++){start.setXYZ(i,samples[i].x,samples[i].y,samples[i].z);end.setXYZ(i,samples[i+1].x,samples[i+1].y,samples[i+1].z);}
    start.data.needsUpdate=true;this.pathGeometry.computeBoundingBox();this.pathGeometry.computeBoundingSphere();
    this.anchors.forEach((marker,i)=>{marker.visible=i<ports.length;if(ports[i]){marker.position.copy(ports[i]);(marker.material as THREE.MeshBasicMaterial).color.setHex(this.flowColor);}});
  }
  render(time:number,progress:number){
    const delta=this.lastTime?Math.min(.1,time-this.lastTime):0;this.lastTime=time;this.controls.update();let moving=false;
    for(const [id,mesh] of this.nodes){
      const target=this.heights.get(id)!;
      if(Math.abs(target-mesh.position.y)>.001){mesh.position.y=THREE.MathUtils.damp(mesh.position.y,target,9,delta);moving=true;}
      const active=this.active.includes(id);const pulse=this.reducedMotion?.3:.31+Math.sin(time*3)*.08;
      const mat=mesh.material as THREE.MeshStandardMaterial;mat.emissive.setHex(active?this.flowColor:0);mat.emissiveIntensity=active?.13:0;
      const outline=this.outlines.get(id)!;const lineMat=outline.material as THREE.LineBasicMaterial;
      lineMat.color.setHex(this.flowColor);lineMat.opacity=active&&id!=='dram'?pulse:0;
    }
    this.dramMaterials.forEach((material,i)=>{
      material.emissive.setHex(this.flowColor);
      material.emissiveIntensity=this.active.includes('dram')?(this.reducedMotion?.15:.13+Math.sin(progress*Math.PI*2+i*.2)*.07):0;
    });
    if(moving)this.updateRoute();
    for(let i=0;i<this.particles.length;i++){
      const packet=Math.floor(i/8);const tail=i%8;const t=(progress+packet/3-tail*.012+1)%1;const p=this.particles[i];
      if(this.curve){p.position.copy(this.curve.getPointAt(t));if(tail===0)p.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),this.curve.getTangentAt(t).normalize());}
      p.scale.setScalar(tail===0?1.1:1-tail*.075);
      (p.material as THREE.MeshBasicMaterial).opacity=(1-tail/9)*Math.min(1,t*12,(1-t)*12);
    }
    if(time-this.lastHover>.055){this.updateHover();this.lastHover=time;}
    if(this.hoverTarget&&moving)this.hoverOutline.setFromObject(this.hoverTarget);
    this.renderer.render(this.scene,this.camera);
  }
}
