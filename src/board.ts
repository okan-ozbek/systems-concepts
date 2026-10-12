import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { NodeId } from './lessons';

export interface ComponentInfo { name:string; detail:string; section:string }
export interface BoardModel { nodes:Map<NodeId,THREE.Mesh>; pickable:THREE.Object3D[]; remote:THREE.Group }

// One world unit represents 20 mm: the PCB has the 244 × 305 mm ATX proportions.
// Socket and internal CPU geometry are enlarged teaching cutaways, not a chip floorplan.
export function buildATXBoard(scene:THREE.Scene):BoardModel {
  const nodes=new Map<NodeId,THREE.Mesh>();const pickable:THREE.Object3D[]=[];
  const materials=new Map<string,THREE.MeshStandardMaterial>();
  const material=(color:number,metal=.25,rough=.5)=>{
    const key=`${color}/${metal}/${rough}`;
    if(!materials.has(key))materials.set(key,new THREE.MeshStandardMaterial({color,metalness:metal,roughness:rough}));
    return materials.get(key)!;
  };
  const box=(w:number,h:number,d:number,x:number,y:number,z:number,color:number,parent:THREE.Object3D=scene,metal=.25)=>{
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material(color,metal));
    mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  const cylinder=(r:number,h:number,x:number,y:number,z:number,color:number,parent:THREE.Object3D=scene)=>{
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,24),material(color,.65,.35));
    mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  const component=(name:string,detail:string,section:string,parent:THREE.Object3D=scene)=>{
    const group=new THREE.Group();group.userData.component={name,detail,section} satisfies ComponentInfo;
    parent.add(group);pickable.push(group);return group;
  };
  const trace=(points:[number,number][],color=0x84b499,opacity=.22,y=.151)=>{
    const geometry=new THREE.BufferGeometry().setFromPoints(points.map(([x,z])=>new THREE.Vector3(x,y,z)));
    const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color,transparent:true,opacity}));scene.add(line);
  };
  const pins=(x:number,z:number,columns:number,rows:number,parent:THREE.Object3D=scene,y=.36,spacing=.13)=>{
    for(let row=0;row<rows;row++)for(let col=0;col<columns;col++)box(.045,.2,.045,x+col*spacing,y,z+row*spacing,0xc9ae72,parent,.8);
  };
  const header=(name:string,detail:string,x:number,z:number,columns:number,rows=2)=>{
    const group=component(name,detail,'INTERNAL CONNECTOR');
    box(columns*.13+.13,.17,rows*.13+.12,x+(columns-1)*.065,.23,z+(rows-1)*.065,0x1b2527,group);
    pins(x,z,columns,rows,group);return group;
  };
  const heatsink=(w:number,d:number,x:number,z:number,parent:THREE.Object3D,height=.65)=>{
    box(w,.16,d,x,.33,z,0x303c3d,parent,.7);
    const count=Math.round(w/.12);
    for(let i=0;i<count;i++)box(.055,height,d,x-w/2+.07+i*(w-.14)/(count-1),.42+height/2,z,0x657777,parent,.7);
    box(w,.045,.1,x,.43+height,z-d/2+.08,0x91a09a,parent,.7);
  };

  // PCB stack, copper edge, drilled mounting holes, and fine routing bundles.
  const pcb=component('ATX motherboard','A 244 × 305 mm board connects power, memory, storage, and expansion devices. Component placement is representative; electrical routing is schematic.','BOARD');
  box(12.2,.24,15.25,0,0,0,0x214f43,pcb);
  box(12.22,.045,15.27,0,-.11,0,0x807751,pcb);
  box(12.2,.045,15.25,0,-.15,0,0x13372e,pcb);
  trace([[-5.82,-7.32],[5.82,-7.32],[5.82,7.32],[-5.82,7.32],[-5.82,-7.32]],0xc1ceb5,.25);
  for(const x of [-5.65,0,5.65])for(const z of [-7.12,.25,7.12]){
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.13,.025,8,24),material(0xcbbb85,.8));
    ring.rotation.x=-Math.PI/2;ring.position.set(x,.151,z);pcb.add(ring);
    cylinder(.095,.025,x,.145,z,0x102921,pcb);
    for(let i=0;i<6;i++){const a=i*Math.PI/3;cylinder(.012,.012,x+Math.cos(a)*.2,.146,z+Math.sin(a)*.2,0xbbb18a,pcb);}
  }
  for(let i=0;i<28;i++){
    const offset=i*.048;
    trace([[.7,-4.8+offset],[1.3,-4.8+offset],[1.7,-4.4+offset],[2.7,-4.4+offset],[3.05,-4.05+offset]],0xa4c1a5,.18);
    trace([[-1.9+offset,-1.2],[-1.9+offset,-.7],[-2.5+offset,-.1],[-2.5+offset,.8]],0x90baa0,.21);
  }
  for(let i=0;i<18;i++){
    const offset=i*.055;
    trace([[1+offset,-1.1],[1+offset,.1],[2.35+offset,1.4],[2.35+offset,2.5]],0x84b499,.22);
    trace([[2.3+offset,3.2],[2.3+offset,3.8],[1.5+offset,4.6],[1.5+offset,6.6]],0x84b499,.18);
  }
  for(let i=0;i<14;i++)trace([[-4.8+i*.075,1.1],[-4.8+i*.075,5.7],[-4.4+i*.075,6.1],[-4.4+i*.075,7.05]],0x84b499,.14);

  // Rear I/O faces point outward along the left edge.
  const ioPanel=component('Rear I/O panel','External USB, network, display, and audio connectors attach peripherals. These ports provide board context; the lessons do not simulate device traffic.','PERIPHERALS');
  box(.12,1.24,6.1,-6.02,.76,-4.02,0x85918b,ioPanel,.8);
  for(const [z,d,type] of [[-6.45,.65,'display'],[-5.48,.85,'usb'],[-4.34,.9,'usb'],[-3.18,1,'network'],[-1.85,1.08,'audio']] as const){
    const port=component(type==='network'?'Ethernet & USB':type==='audio'?'Audio jacks':type==='display'?'Display outputs':'USB ports',type==='network'?'The Ethernet controller connects the machine to a network. USB ports connect host-controlled peripheral devices.':type==='audio'?'Analog audio input and output pass through the audio codec.':type==='display'?'Display connectors carry video from supported graphics hardware.':'The USB host controller manages transfers to attached peripherals.','REAR I/O',ioPanel);
    box(.94,.9,d,-5.55,.64,z,0xa3aaa2,port,.8);
    box(.02,.64,d-.12,-6.031,.62,z,0x142320,port);
    if(type==='usb'||type==='network')for(const y of [.47,.82])box(.025,.09,d-.23,-6.049,y,z,0x4e7984,port);
    if(type==='audio')for(let i=0;i<3;i++){
      const jack=new THREE.Mesh(new THREE.CylinderGeometry(.11,.11,.035,16),material([0x99bf99,0xbd8f91,0x87a1b4][i]));
      jack.rotation.z=Math.PI/2;jack.position.set(-6.055,.62,z-.34+i*.34);port.add(jack);
    }
  }

  // VRM stages, chokes, capacitors, and top/left finned heat spreaders.
  const vrm=component('CPU voltage regulator','VRM stages convert the power supply voltage into the lower, regulated voltages used by the CPU. Chokes, capacitors, and heatsinks surround the socket.','POWER DELIVERY');
  heatsink(4.5,.8,-1.3,-6.04,vrm,.6);heatsink(.87,4.05,-3.88,-3.65,vrm,.68);
  for(let i=0;i<9;i++){
    const x=-3.22+i*.48;box(.33,.27,.33,x,.36,-5.28,0x89958b,vrm,.65);
    box(.24,.09,.32,x,.2,-5.73,0x1a2826,vrm);cylinder(.095,.25,x,.3,-4.98,0xc1c7b0,vrm);
  }
  for(let i=0;i<7;i++){
    const z=-4.8+i*.47;box(.32,.27,.33,-3.2,.36,z,0x89958b,vrm,.65);cylinder(.095,.25,-2.91,.3,z,0xc1c7b0,vrm);
  }
  const eps=component('8-pin CPU power','The EPS connector supplies power to the CPU voltage regulator.','POWER DELIVERY');
  box(1.15,.55,.62,-4.66,.44,-6.82,0x25312c,eps);
  for(let col=0;col<4;col++)for(let row=0;row<2;row++)box(.18,.025,.18,-5.08+col*.27,.726,-6.96+row*.27,0x101b18,eps);

  // CPU socket retention frame and deliberately opened package.
  const cpu=component('Exposed CPU package','The lid is omitted to expose two representative cores, private caches, and a shared last-level cache. Internal geometry is enlarged and simplified for teaching.','CPU CUTAWAY');
  box(4.28,.2,4.27,-1.1,.27,-3.12,0x172b27,cpu);
  box(4.05,.12,4.06,-1.1,.43,-3.12,0xb9c0aa,cpu,.75);
  box(3.84,.2,3.83,-1.1,.59,-3.12,0x223b31,cpu);
  box(3.5,.09,3.52,-1.1,.735,-3.12,0x3d6755,cpu,.6);
  for(let i=0;i<24;i++){
    const x=-2.81+i*.148;
    box(.045,.04,.12,x,.66,-5.04,0xc8ac6b,cpu,.8);box(.045,.04,.12,x,.66,-1.2,0xc8ac6b,cpu,.8);
  }
  box(.06,.05,3.75,1.09,.5,-3.1,0x9daaa0,cpu,.9);
  box(.4,.09,.16,.91,.48,-1.02,0x899991,cpu,.8);
  for(const x of [-2.75,.57])for(const z of [-4.8,-1.48])cylinder(.08,.08,x,.49,z,0xc1c8b8,cpu);
  const addNode=(id:NodeId,w:number,h:number,d:number,x:number,y:number,z:number,color:number,parent:THREE.Object3D=scene)=>{
    const mesh=box(w,h,d,x,y,z,color,parent);
    // Active silicon gets its own material instead of tinting supporting hardware.
    mesh.material=material(color,.4).clone();mesh.userData.node=id;nodes.set(id,mesh);pickable.push(mesh);return mesh;
  };
  for(const [core,x] of [[0,-1.94],[1,-.34]] as const){
    box(1.43,.035,2.16,x,.808,-3.39,0x2a4b3f,cpu);
    const reg=addNode(core===0?'reg0':'reg1',.8,.15,.52,x,.93,-4.09,0xa8c591);
    for(let r=0;r<2;r++)for(let c=0;c<5;c++)box(.1,.025,.16,-.31+c*.155,.087,-.105+r*.21,0xc4d8ac,reg);
    addNode(core===0?'l10':'l11',1.25,.12,.43,x,.9,-3.43,0x75b69a);
    const l2=addNode(core===0?'l20':'l21',1.25,.1,.55,x,.87,-2.76,0x508e78);
    for(let i=0;i<8;i++)box(.115,.025,.4,-.52+i*.148,.065,0,0x639e85,l2);
  }
  const l3=addNode('l3',2.91,.11,.54,-1.14,.86,-1.94,0x39735f);
  for(let i=0;i<18;i++)box(.105,.023,.36,-1.34+i*.157,.068,0,0x5b9679,l3);
  const alu=addNode('alu',.3,.2,.53,-2.58,.96,-4.09,0xc8a66c);
  for(let i=0;i<3;i++)box(.035,.014,.38,-.09+i*.085,.11,0,0xe0bd86,alu);
  addNode('tlb',1.18,.1,.27,-1.14,.87,-4.68,0x748ba0);

  // Four DIMM sockets: two populated modules with chips on both faces.
  const dram=addNode('dram',2.85,1.5,6.35,3.42,.94,-3.28,0x539d7c);
  const dramMaterial=dram.material as THREE.MeshStandardMaterial;
  dramMaterial.transparent=true;dramMaterial.opacity=0;dramMaterial.depthWrite=false;dram.castShadow=false;dram.receiveShadow=false;
  for(let slot=0;slot<4;slot++){
    const x=2.35+slot*.71;
    const socket=component(`DIMM slot ${['A1','A2','B1','B2'][slot]}`,slot%2?'An installed memory module is connected to the CPU memory controller. Transfers are shown schematically.':'An empty memory socket. This board shows four slots with modules installed in A2 and B2.','MEMORY');
    box(.28,.22,6.13,x,.29,-3.28,slot%2?0x27362e:0x39473d,socket);
    box(.035,.02,5.83,x,.41,-3.28,0x111e19,socket);
    for(const z of [-6.45,-.11])box(.4,.28,.23,x,.4,z,0xb2b9a1,socket);
    if(slot%2){
      // Actual modules are children of the invisible DRAM hit region.
      const localX=x-dram.position.x;const localY=.97-dram.position.y;
      box(.09,1.05,5.87,localX,localY,0,0x427551,dram);
      for(const side of [-1,1])for(let i=0;i<8;i++){
        const chip=box(.115,.62,.49,localX+side*.096,localY+.04,-2.54+i*.72,0x172620,dram);
        for(let pin=0;pin<5;pin++)box(.025,.035,.016,side*.061,-.33,-.17+pin*.084,0x9caa91,chip,.8);
      }
      for(let i=0;i<38;i++)box(.105,.15,.035,localX,localY-.49,-2.75+i*.146,0xc8ac68,dram,.85);
      for(let i=0;i<8;i++)box(.12,.04,.08,localX+.069,localY+.44,-2.5+i*.69,0xa7b99a,dram);
    }
  }
  const atx=component('24-pin ATX power','The main power connector supplies the motherboard with power from the PSU. The CPU also has a separate EPS power connector.','POWER DELIVERY');
  box(.52,.67,3.17,5.47,.49,-3.38,0x26342e,atx);
  for(let row=0;row<12;row++)for(let col=0;col<2;col++)box(.16,.015,.16,5.34+col*.25,.834,-4.74+row*.245,0x101b17,atx);
  header('CPU fan header','A four-pin connector powers and controls the CPU cooler fan. The cooler is omitted to reveal the package.',1.15,-6.8,4,1);

  // Expansion area: three long slots and two short slots, with connectors and latches.
  const pcie=(z:number,long:boolean,primary=false)=>{
    const w=long?6.28:1.56;const x=long?-1.99:-4.35;
    const group=component(long?'PCIe expansion slot':'PCIe x1 slot','PCI Express connects expansion devices with serial links. Lane count, slot length, and wiring depend on the board.','EXPANSION');
    box(w,.28,.31,x,.34,z,primary?0xa6b7a8:0x29362f,group,primary?.75:.25);
    box(w-.18,.022,.045,x,.491,z,0x11221b,group);
    box(.05,.05,.22,x-w/2+.4,.49,z,0x60765e,group);
    for(let i=0;i<(long?40:10);i++)box(.035,.025,.042,x-w/2+.15+i*.148,.49,z+.055,0xc0a367,group,.8);
    if(long)box(.38,.16,.42,x+w/2+.09,.48,z,0x687f66,group);
    return group;
  };
  const mainSlot=pcie(.77,true,true);
  // A hidden hit mesh lets the existing I/O lesson reference the primary slot.
  const io=addNode('io',6.4,.32,.42,-1.99,.35,.77,0x81917a);
  const ioMaterial=io.material as THREE.MeshStandardMaterial;ioMaterial.transparent=true;ioMaterial.opacity=0;ioMaterial.depthWrite=false;io.castShadow=false;
  mainSlot.userData.node='io';
  pcie(2.2,false);pcie(3.36,true);pcie(4.67,false);pcie(5.86,true);
  for(const [x,z,populated] of [[-1.16,-.43,true],[-1.18,2.38,false],[-1.18,4.73,true]] as const){
    const drive=component(populated?'M.2 NVMe drive':'M.2 storage socket','M.2 sockets connect compact storage devices. This schematic shows two installed NVMe drives and one empty socket.','STORAGE');
    box(.22,.19,1.12,-3.7,.27,z,0x293a2e,drive);
    if(populated){
      box(4.74,.07,1.02,x,.29,z,0x2d5550,drive);
      for(let i=0;i<4;i++)box(.7,.095,.72,-2.79+i*.9,.37,z,0x1d2b27,drive);
      box(.3,.07,.7,.83,.39,z,0x89968b,drive,.7);
    }
    cylinder(.095,.1,1.27,.25,z,0xaaa886,drive);
  }
  const chipset=component('Chipset & heatsink','The chipset provides additional peripheral and storage connectivity. The main CPU-to-memory path goes through the CPU memory controller rather than this chipset.','I/O CONTROLLER');
  box(2.09,.12,2.23,3.4,.29,2.26,0x23382c,chipset);
  heatsink(1.94,2.08,3.4,2.26,chipset,.32);
  for(let i=0;i<3;i++)box(.8,.035,.09,3.42,.8,1.86+i*.21,0x748880,chipset,.65);
  const sata=component('SATA ports','These right-angle connectors attach SATA storage devices to the motherboard.','STORAGE');
  for(let row=0;row<3;row++)for(let col=0;col<2;col++){
    const z=3.85+row*.54;const y=.32+col*.31;
    box(.58,.28,.42,5.67,y,z,0x34453a,sata);box(.018,.17,.27,5.966,y,z,0x15241b,sata);
  }
  const battery=component('CMOS battery','A coin cell maintains the real-time clock and firmware settings when main power is disconnected.','FIRMWARE');
  cylinder(.49,.15,2.16,.26,5.4,0x1a2d24,battery);cylinder(.425,.09,2.16,.37,5.4,0xbbc3b4,battery);
  box(.15,.04,.35,2.17,.426,5.4,0x8e9e91,battery,.8);
  const audio=component('Audio codec','The audio codec converts between digital data and analog audio. A separation line isolates its region from some board noise.','AUDIO');
  box(.6,.13,.64,-5.1,.25,5.8,0x23342a,audio);
  for(let i=0;i<5;i++)cylinder(.105,.31,-5.38+i*.23,.3,6.39,0xc5b686,audio);
  trace([[-5.66,2.5],[-4.73,2.5],[-4.73,6.87],[-5.68,6.87]],0xd8c7a0,.37);
  const firmware=component('Firmware flash','Nonvolatile flash stores the firmware used to initialize the platform before handing control to the operating system.','FIRMWARE');
  box(.39,.12,.3,3.64,.23,5.66,0x22352a,firmware);
  for(let i=0;i<4;i++)for(const side of [-1,1])box(.06,.045,.04,3.64+side*.225,.21,5.56+i*.068,0xb3bba3,firmware,.8);
  header('Front-panel audio','Connects the case audio jacks to the motherboard audio circuitry.',-5.51,7.03,5);
  header('USB 2.0 headers','Internal USB headers connect case ports and internal peripheral devices.',-2.4,7.01,5);
  header('Front-panel connectors','Pins for the case power switch, reset switch, and status LEDs.',3.62,7.02,7);
  header('USB 3 header','An internal connector for compatible front-panel USB ports.',5.39,.91,2,5);
  header('System fan header','A connector supplies power and fan control to a case fan.',4.86,6.23,4,1);

  // Deterministic small components give the board density without random flicker.
  for(let i=0;i<48;i++){
    const column=i%8;const row=Math.floor(i/8);
    box(.14,.07,.075,2.08+column*.34,.2,.23+row*.23,0x8ba38b);
  }
  for(let i=0;i<26;i++){
    const x=-3.8+(i%13)*.45;const z=6.5+Math.floor(i/13)*.24;
    box(.17,.06,.11,x,.19,z,0x95a18d);box(.075,.04,.1,x+.15,.18,z,0x22382a);
  }
  for(let i=0;i<18;i++)cylinder(.068,.16,1.65,.22,-5.7+i*.25,0xb3c2a4);

  // A second node sits beyond the ATX board only when demonstrating NUMA.
  const remote=new THREE.Group();scene.add(remote);
  const remoteNode=addNode('remote',2.8,.18,3.3,9.05,.12,2.5,0x315047,remote);
  box(1.45,.24,1.45,0,.24,-.4,0x8a94aa,remoteNode);
  for(let i=0;i<2;i++)box(.15,.72,2.3,.95+i*.35,.41,0,0x73937b,remoteNode);
  for(let i=0;i<9;i++)box(.1,.04,.2,-1.26+i*.3,.13,1.45,0xb5a16c,remoteNode);
  remote.visible=false;

  const grid=new THREE.GridHelper(100,100,0x45484c,0x303237);grid.position.y=-.31;
  (grid.material as THREE.Material).transparent=true;(grid.material as THREE.Material).opacity=.13;scene.add(grid);
  // Batch pins, fins, and passive parts without losing component hover groups.
  // Animated lesson targets remain separate meshes.
  const batch=(parent:THREE.Object3D)=>{
    for(const child of [...parent.children])batch(child);
    const buckets=new Map<THREE.Material,THREE.Mesh[]>();
    for(const child of parent.children){
      if(!(child instanceof THREE.Mesh)||child.children.length||child.userData.node||Array.isArray(child.material))continue;
      const list=buckets.get(child.material)??[];list.push(child);buckets.set(child.material,list);
    }
    for(const [mat,meshes] of buckets){
      if(meshes.length<2)continue;
      const obstacles:THREE.Box3[]=[];
      const geometries=meshes.map(mesh=>{
        mesh.updateMatrix();mesh.geometry.computeBoundingBox();
        const parts=(mesh.userData.obstacleBoxes as THREE.Box3[]|undefined)??[mesh.geometry.boundingBox!];
        obstacles.push(...parts.map(box=>box.clone().applyMatrix4(mesh.matrix)));
        return mesh.geometry.clone().applyMatrix4(mesh.matrix);
      });
      const merged=mergeGeometries(geometries);geometries.forEach(geometry=>geometry.dispose());
      if(!merged)continue;
      const combined=new THREE.Mesh(merged,mat);combined.userData.obstacleBoxes=obstacles;
      combined.castShadow=true;combined.receiveShadow=true;parent.add(combined);
      for(const mesh of meshes){parent.remove(mesh);mesh.geometry.dispose();}
    }
  };
  batch(scene);
  return {nodes,pickable,remote};
}
