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
  const plate=(points:[number,number][],height:number,y:number,color:number,parent:THREE.Object3D,metal=.6)=>{
    const shape=new THREE.Shape();shape.moveTo(points[0][0],-points[0][1]);
    for(const [x,z] of points.slice(1))shape.lineTo(x,-z);shape.closePath();
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false});geometry.rotateX(-Math.PI/2);
    const mesh=new THREE.Mesh(geometry,material(color,metal,.4));mesh.position.y=y;mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  const component=(name:string,detail:string,section:string,parent:THREE.Object3D=scene)=>{
    const group=new THREE.Group();group.userData.component={name,detail,section} satisfies ComponentInfo;
    parent.add(group);pickable.push(group);return group;
  };
  const trace=(points:[number,number][],color=0x899099,opacity=.22,y=.151)=>{
    const geometry=new THREE.BufferGeometry().setFromPoints(points.map(([x,z])=>new THREE.Vector3(x,y,z)));
    const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color,transparent:true,opacity}));scene.add(line);
  };
  const pins=(x:number,z:number,columns:number,rows:number,parent:THREE.Object3D=scene,y=.36,spacing=.13,missingPin?:number)=>{
    for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
      if(row*columns+col!==missingPin)box(.045,.2,.045,x+col*spacing,y,z+row*spacing,0xc9ae72,parent,.8);
    }
  };
  const header=(name:string,detail:string,x:number,z:number,columns:number,rows=2,missingPin?:number)=>{
    const group=component(name,detail,'INTERNAL CONNECTOR');
    box(columns*.13+.13,.17,rows*.13+.12,x+(columns-1)*.065,.23,z+(rows-1)*.065,0x16191f,group);
    pins(x,z,columns,rows,group,.36,.13,missingPin);return group;
  };
  const heatsink=(w:number,d:number,x:number,z:number,parent:THREE.Object3D,height=.65)=>{
    box(w,.16,d,x,.33,z,0x25282d,parent,.7);
    const count=Math.round(w/.12);
    for(let i=0;i<count;i++)box(.055,height,d,x-w/2+.07+i*(w-.14)/(count-1),.42+height/2,z,0x434850,parent,.7);
    box(w,.045,.1,x,.43+height,z-d/2+.08,0x787e88,parent,.7);
  };

  // PCB stack, copper edge, drilled mounting holes, and fine routing bundles.
  const pcb=component('ATX motherboard','A 244 × 305 mm board connects power, memory, storage, and expansion devices. Component placement is representative; electrical routing is schematic.','BOARD');
  box(12.2,.24,15.25,0,0,0,0x1c1e23,pcb);
  box(12.22,.045,15.27,0,-.11,0,0x565258,pcb);
  box(12.2,.045,15.25,0,-.15,0,0x111318,pcb);
  trace([[-5.82,-7.32],[5.82,-7.32],[5.82,7.32],[-5.82,7.32],[-5.82,-7.32]],0xa0a5ae,.18);
  for(const [x,z] of [[-4.5,-7.05],[2.25,-7.05],[5.65,-7.05],[-5.65,.1],[2.25,.1],[5.65,.1],[-5.65,6.66],[2.25,6.66],[5.65,6.66]]){
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.13,.025,8,24),material(0xb7bec8,.8));
    ring.rotation.x=-Math.PI/2;ring.position.set(x,.151,z);pcb.add(ring);
    cylinder(.095,.025,x,.145,z,0x090b0e,pcb);
    for(let i=0;i<6;i++){const a=i*Math.PI/3;cylinder(.012,.012,x+Math.cos(a)*.2,.146,z+Math.sin(a)*.2,0x969ea9,pcb);}
  }

  // A chamfered rear-I/O shroud and brushed ribs echo modern ATX boards.
  // The socket, DIMM chip faces, and NVMe packages remain open teaching cutaways.
  const shroud=component('Rear I/O shroud','A protective cover over the rear connectors. The board uses a dark PCB, machined metal surfaces, and restrained red accents.','BOARD');
  plate([[-6,-7.4],[-5.45,-7.4],[-4.5,-6.55],[-4.5,-.78],[-4.92,-.36],[-6,-.36]],.89,.48,0x24262c,shroud);
  for(let i=0;i<9;i++)box(.055,.025,6.1,-5.86+i*.142,1.384,-3.81,i%3===0?0x41454d:0x17191e,shroud,.7);
  box(.055,.035,5.62,-5.94,1.395,-3.61,0x9ca2ab,shroud,.8);
  box(.05,.035,1.06,-4.55,1.395,-1.5,0xad444f,shroud,.55);
  for(let i=0;i<3;i++){
    const mark=box(.11,.022,.73,-5.25+i*.19,1.407,-2.15+i*.13,0x7f858e,shroud,.75);mark.rotation.y=-.48;
  }
  for(let i=0;i<28;i++){
    const offset=i*.048;
    trace([[.7,-4.8+offset],[1.3,-4.8+offset],[1.7,-4.4+offset],[2.7,-4.4+offset],[3.05,-4.05+offset]],0x9098a3,.18);
    trace([[-1.9+offset,-1.2],[-1.9+offset,-.7],[-2.5+offset,-.1],[-2.5+offset,.8]],0x858d97,.21);
  }
  for(let i=0;i<18;i++){
    const offset=i*.055;
    trace([[1+offset,-1.1],[1+offset,.1],[2.35+offset,1.4],[2.35+offset,2.5]],0x899099,.22);
    trace([[2.3+offset,3.2],[2.3+offset,3.8],[1.5+offset,4.6],[1.5+offset,6.6]],0x899099,.18);
  }
  for(let i=0;i<14;i++)trace([[-4.8+i*.075,1.1],[-4.8+i*.075,5.7],[-4.4+i*.075,6.1],[-4.4+i*.075,7.05]],0x899099,.14);

  // Rear I/O faces point outward along the left edge.
  const ioPanel=component('Rear I/O panel','External USB, network, display, and audio connectors attach peripherals. These ports provide board context; the lessons do not simulate device traffic.','PERIPHERALS');
  box(.12,1.24,6.1,-6.02,.76,-4.02,0x686f7a,ioPanel,.8);
  for(const [z,d,type] of [[-6.45,.65,'display'],[-5.48,.85,'usb'],[-4.34,.9,'usb'],[-3.18,1,'network'],[-1.85,1.08,'audio']] as const){
    const port=component(type==='network'?'Ethernet & USB':type==='audio'?'Audio jacks':type==='display'?'Display outputs':'USB ports',type==='network'?'The Ethernet controller connects the machine to a network. USB ports connect host-controlled peripheral devices.':type==='audio'?'Analog audio input and output pass through the audio codec.':type==='display'?'Display connectors carry video from supported graphics hardware.':'The USB host controller manages transfers to attached peripherals.','REAR I/O',ioPanel);
    box(.94,.9,d,-5.55,.64,z,0x848c98,port,.8);
    box(.02,.64,d-.12,-6.031,.62,z,0x0c0f14,port);
    if(type==='usb'||type==='network')for(const y of [.47,.82])box(.025,.09,d-.23,-6.049,y,z,0x525e79,port);
    if(type==='audio')for(let i=0;i<3;i++){
      const jack=new THREE.Mesh(new THREE.CylinderGeometry(.11,.11,.035,16),material([0x99bf99,0xbd8f91,0x87a1b4][i]));
      jack.rotation.z=Math.PI/2;jack.position.set(-6.055,.62,z-.34+i*.34);port.add(jack);
    }
  }

  // VRM stages, chokes, capacitors, and top/left finned heat spreaders.
  const vrm=component('CPU voltage regulator','VRM stages convert the power supply voltage into the lower, regulated voltages used by the CPU. Chokes, capacitors, and heatsinks surround the socket.','POWER DELIVERY');
  heatsink(4.5,.8,-1.3,-6.04,vrm,.6);heatsink(.87,4.05,-3.88,-3.65,vrm,.68);
  plate([[-3.59,-6.52],[.78,-6.52],[1.09,-6.25],[1.09,-5.74],[-3.59,-5.74]],.1,1.04,0x34383f,vrm);
  box(3.98,.018,.035,-1.39,1.157,-6.38,0x9299a4,vrm,.8);
  box(.65,.018,.055,.69,1.158,-5.82,0xa74854,vrm,.55);
  box(.07,.024,3.76,-3.62,1.138,-3.7,0x727b88,vrm,.75);
  for(let i=0;i<9;i++){
    const x=-3.22+i*.48;box(.33,.27,.33,x,.36,-5.28,0x707782,vrm,.65);
    box(.24,.09,.32,x,.2,-5.73,0x171a20,vrm);cylinder(.095,.25,x,.3,-4.98,0x8f97a4,vrm);
  }
  for(let i=0;i<7;i++){
    const z=-4.8+i*.47;box(.32,.27,.33,-3.2,.36,z,0x707782,vrm,.65);cylinder(.095,.25,-2.91,.3,z,0x8f97a4,vrm);
  }
  const eps=component('8-pin CPU power','The EPS connector supplies power to the CPU voltage regulator.','POWER DELIVERY');
  box(1.15,.55,.62,-3.55,.44,-7.02,0x202329,eps);
  for(let col=0;col<4;col++)for(let row=0;row<2;row++)box(.18,.025,.18,-3.97+col*.27,.726,-7.16+row*.27,0x080b10,eps);

  // CPU socket retention frame and deliberately opened package.
  const cpu=component('Exposed CPU package','The lid is omitted to expose two representative cores, private caches, and a shared last-level cache. Internal geometry is enlarged and simplified for teaching.','CPU CUTAWAY');
  box(4.28,.2,4.27,-1.1,.27,-3.12,0x11151b,cpu);
  box(4.05,.12,4.06,-1.1,.43,-3.12,0x939aa5,cpu,.75);
  box(3.84,.2,3.83,-1.1,.59,-3.12,0x242831,cpu);
  box(3.5,.09,3.52,-1.1,.735,-3.12,0x343b45,cpu,.6);
  for(let i=0;i<24;i++){
    const x=-2.81+i*.148;
    box(.045,.04,.12,x,.66,-5.04,0xc8ac6b,cpu,.8);box(.045,.04,.12,x,.66,-1.2,0xc8ac6b,cpu,.8);
  }
  box(.06,.05,3.75,1.09,.5,-3.1,0x858d99,cpu,.9);
  box(.4,.09,.16,.91,.48,-1.02,0x737d8d,cpu,.8);
  for(const x of [-2.75,.57])for(const z of [-4.8,-1.48])cylinder(.08,.08,x,.49,z,0xb1b7c1,cpu);
  for(const x of [-3.15,.95])box(.15,.09,4.06,x,.71,-3.12,0xb0b7c2,cpu,.88);
  for(const z of [-5.15,-1.09])box(4.25,.09,.15,-1.1,.71,z,0xb0b7c2,cpu,.88);
  box(.035,.05,3.48,1.14,.76,-3.11,0xc1c6cf,cpu,.9);
  for(const x of [-3.15,.95])for(const z of [-5.15,-1.09]){
    cylinder(.085,.04,x,.779,z,0x777f8b,cpu);box(.088,.009,.013,x,.805,z,0x2a303b,cpu);
  }
  box(.032,.018,3.2,-2.83,.795,-3.1,0x934853,cpu,.55);
  const addNode=(id:NodeId,w:number,h:number,d:number,x:number,y:number,z:number,color:number,parent:THREE.Object3D=scene)=>{
    const mesh=box(w,h,d,x,y,z,color,parent);
    // Active silicon gets its own material instead of tinting supporting hardware.
    mesh.material=material(color,.4).clone();mesh.userData.node=id;nodes.set(id,mesh);pickable.push(mesh);return mesh;
  };
  for(const [core,x] of [[0,-1.94],[1,-.34]] as const){
    box(1.43,.035,2.16,x,.808,-3.39,0x282e39,cpu);
    const reg=addNode(core===0?'reg0':'reg1',.8,.15,.52,x,.93,-4.09,0x9aabbc);
    for(let r=0;r<2;r++)for(let c=0;c<5;c++)box(.1,.025,.16,-.31+c*.155,.087,-.105+r*.21,0xc2c9d2,reg);
    addNode(core===0?'l10':'l11',1.25,.12,.43,x,.9,-3.43,0x9c6b75);
    const l2=addNode(core===0?'l20':'l21',1.25,.1,.55,x,.87,-2.76,0x536a7c);
    for(let i=0;i<8;i++)box(.115,.025,.4,-.52+i*.148,.065,0,0x8090a2,l2);
  }
  const l3=addNode('l3',2.91,.11,.54,-1.14,.86,-1.94,0x384a5c);
  for(let i=0;i<18;i++)box(.105,.023,.36,-1.34+i*.157,.068,0,0x72889e,l3);
  const alu=addNode('alu',.3,.2,.53,-2.58,.96,-4.09,0xb35761);
  for(let i=0;i<3;i++)box(.035,.014,.38,-.09+i*.085,.11,0,0xd9959d,alu);
  addNode('tlb',1.18,.1,.27,-1.14,.87,-4.68,0x8894a9);

  // Four DIMM sockets: two populated modules with chips on both faces.
  const dram=addNode('dram',2.85,1.5,6.35,3.42,.94,-3.28,0x616977);
  const dramMaterial=dram.material as THREE.MeshStandardMaterial;
  dramMaterial.transparent=true;dramMaterial.opacity=0;dramMaterial.depthWrite=false;dram.castShadow=false;dram.receiveShadow=false;
  for(let slot=0;slot<4;slot++){
    const x=2.35+slot*.71;
    const socket=component(`DIMM slot ${['A1','A2','B1','B2'][slot]}`,slot%2?'An installed memory module is connected to the CPU memory controller. Transfers are shown schematically.':'An empty memory socket. This board shows four slots with modules installed in A2 and B2.','MEMORY');
    box(.28,.22,6.13,x,.29,-3.28,slot%2?0x1b1f27:0x3e434b,socket);
    box(.035,.02,5.83,x,.41,-3.28,0x0a0e15,socket);
    for(const z of [-6.45,-.11])box(.4,.28,.23,x,.4,z,0x969fac,socket);
    if(slot%2){
      // Actual modules are children of the invisible DRAM hit region.
      const localX=x-dram.position.x;const localY=.97-dram.position.y;
      box(.09,1.05,5.87,localX,localY,0,0x292e39,dram);
      box(.13,.035,5.72,localX,localY+.54,0,0x7a8494,dram,.65);
      for(const z of [-2.7,2.7])box(.135,.045,.23,localX,localY+.542,z,0xa54451,dram,.55);
      for(const side of [-1,1])for(let i=0;i<8;i++){
        const chip=box(.115,.62,.49,localX+side*.096,localY+.04,-2.54+i*.72,0x11151b,dram);
        for(let pin=0;pin<5;pin++)box(.025,.035,.016,side*.061,-.33,-.17+pin*.084,0x929ba7,chip,.8);
      }
      for(let i=0;i<38;i++)box(.105,.15,.035,localX,localY-.49,-2.75+i*.146,0xc8ac68,dram,.85);
      for(let i=0;i<8;i++)box(.12,.04,.08,localX+.069,localY+.44,-2.5+i*.69,0xa0a8b4,dram);
    }
  }
  const atx=component('24-pin ATX power','The main power connector supplies the motherboard with power from the PSU. The CPU also has a separate EPS power connector.','POWER DELIVERY');
  box(.52,.67,3.17,5.47,.49,-3.38,0x21252c,atx);
  for(let row=0;row<12;row++)for(let col=0;col<2;col++)box(.16,.015,.16,5.34+col*.25,.834,-4.74+row*.245,0x090b11,atx);
  header('CPU fan header','A four-pin connector powers and controls the CPU cooler fan. The cooler is omitted to reveal the package.',1.15,-6.8,4,1);

  // Two x16-length and two x1 connectors share a card-edge datum. Expansion
  // rows follow the 20.32 mm chassis pitch (1.016 world units), including gaps
  // for a multi-slot GPU. Slot bodies are approximately 89 mm / 25 mm long.
  const pcie=(z:number,long:boolean,primary=false)=>{
    const w=long?4.45:1.25;const x=-4+w/2;
    const group=component(long?`PCIe x16 slot · ${primary?'primary':'secondary'}`:`PCIe x1 slot · ${z<4?'upper':'lower'}`,'PCI Express connects expansion devices with serial links. The connectors align with the case expansion bays; physical length and electrical lane count can differ.','EXPANSION');
    box(w,.28,.31,x,.34,z,primary?0xb1b8c3:0x252a32,group,primary?.75:.25);
    box(w-.18,.022,.045,x,.491,z,0x090c12,group);
    box(.05,.05,.22,x-w/2+.4,.49,z,0x777f8d,group);
    for(let i=0;i<(long?36:9);i++)box(.028,.025,.042,x-w/2+.14+i*.116,.49,z+.055,0xc0a367,group,.8);
    if(long)box(.38,.16,.42,x+w/2+.09,.48,z,0x666e7b,group);
    return group;
  };
  const mainSlot=pcie(.77,true,true);
  // A hidden hit mesh lets the existing I/O lesson reference the primary slot.
  const io=addNode('io',4.45,.32,.42,-1.775,.35,.77,0x8793a5);
  const ioMaterial=io.material as THREE.MeshStandardMaterial;ioMaterial.transparent=true;ioMaterial.opacity=0;ioMaterial.depthWrite=false;io.castShadow=false;
  mainSlot.userData.node='io';
  pcie(.77+2*1.016,false);pcie(.77+3*1.016,true);pcie(.77+6*1.016,false);
  // One 2280 drive between socket and GPU; two opposed M.2 positions below
  // the secondary x16 slot. Each 22 × 80 mm card runs from a keyed connector
  // to its own retention screw, rather than crossing an expansion connector.
  for(const [index,socketX,z,direction,populated] of [[1,1.18,-.28,-1,true],[2,.35,5.27,-1,true],[3,1.02,5.27,1,false]] as const){
    const drive=component(`M.2 ${index} · ${populated?'NVMe drive':'empty socket'}`,'An M-key socket accepts a 22 × 80 mm NVMe module. The connector holds one end; a standoff and screw retain the other. This board shows two exposed drives and one empty position.','STORAGE');
    const x=socketX+direction*2;
    box(.24,.19,1.16,socketX,.27,z,0x242831,drive);
    box(.026,.045,.94,socketX+direction*.126,.305,z,0x0a0e14,drive);
    if(populated){
      box(4,.07,1.1,x,.29,z,0x303641,drive);
      for(let pin=0;pin<16;pin++)box(.17,.014,.027,socketX+direction*.18,.335,z-.47+pin*.061,0xc6ad72,drive,.85);
      const nand=component('NVMe drive · NAND flash','The exposed flash packages store data without power. Storage data passes through the SSD controller and PCIe connection; NAND flash is distinct from DRAM.','STORAGE',drive);
      for(let i=0;i<3;i++){
        const chipX=socketX+direction*(1.45+i*.82);
        box(.66,.14,.72,chipX,.395,z,0x141820,nand);
        for(let p=0;p<4;p++)for(const side of [-1,1])box(.07,.013,.028,chipX-.25+p*.17,.327,z+side*.39,0xadb4be,nand,.8);
      }
      const controller=component('NVMe drive · storage controller','The SSD controller manages flash access and exchanges data with the host through PCIe. Its package is exposed in this teaching model.','STORAGE',drive);
      box(.5,.09,.62,socketX+direction*.75,.38,z,0x7d8795,controller,.7);
      // Slim edge rails suggest a thermal frame without hiding controller/NAND chips.
      for(const side of [-1,1])box(3.7,.1,.055,x,.31,z+side*.59,0x626c7a,drive,.75);
      box(.45,.022,.055,socketX+direction*3.3,.373,z+.59,0xad454f,drive,.6);
    }else{
      // Pads and alternate 2242 / 2260 mounting points make the empty position
      // legible without filling it with a fictitious third drive.
      trace([[socketX+.3,z-.55],[socketX+4,z-.55],[socketX+4,z+.55],[socketX+.3,z+.55]],0x899099,.3);
      for(const length of [2.1,3])cylinder(.075,.03,socketX+length,.165,z,0x687382,drive);
    }
    const screwX=socketX+direction*3.9;
    cylinder(.075,.16,screwX,.23,z,0x969fac,drive);
    cylinder(.105,.027,screwX,.343,z,0xb1b9c6,drive);
    box(.11,.006,.018,screwX,.36,z,0x29313c,drive);
  }
  const chipset=component('Chipset & heatsink','The chipset provides additional peripheral and storage connectivity. The main CPU-to-memory path goes through the CPU memory controller rather than this chipset.','I/O CONTROLLER');
  box(2.09,.12,2.23,3.4,.29,2.26,0x242a33,chipset);
  heatsink(1.94,2.08,3.4,2.26,chipset,.27);
  plate([[2.31,1.14],[4.32,1.14],[4.62,1.44],[4.62,3.29],[2.61,3.29],[2.31,2.99]],.12,.78,0x292d35,chipset);
  for(let i=0;i<4;i++){
    const inlay=box(.13,.016,1.02,3.07+i*.28,.911,2.2,0x8892a2,chipset,.8);inlay.rotation.y=-.53;
  }
  box(1.38,.02,.06,3.57,.912,3.09,0xa23e4e,chipset,.65);
  const sata=component('SATA ports','Four right-angle ports face the bottom board edge, allowing storage cables to leave the expansion area.','STORAGE');
  for(const x of [3.65,4.82])for(const y of [.32,.63]){
    box(.9,.28,.58,x,y,7.1,0x272c35,sata);box(.66,.17,.018,x,y,7.398,0x0c1017,sata);
    box(.52,.035,.02,x-.055,y-.04,7.41,0x626d7e,sata,.7);
  }
  const battery=component('CMOS battery','A 20 mm coin cell powers the real-time clock when main power is disconnected. Its holder occupies a clear area between expansion rows.','FIRMWARE');
  cylinder(.56,.13,-1.48,.225,2.56,0x151b25,battery);cylinder(.5,.08,-1.48,.33,2.56,0xb5bdc9,battery);
  box(.15,.045,.22,-1.48,.389,3.015,0x7e8a9d,battery,.8);
  box(.05,.009,.21,-1.48,.375,2.56,0x737e90,battery,.75);box(.21,.009,.05,-1.48,.375,2.56,0x737e90,battery,.75);
  const audio=component('Audio codec','The audio codec converts between digital data and analog audio. A separation line isolates its region from some board noise.','AUDIO');
  box(.6,.13,.64,-5.28,.25,4.78,0x1e242e,audio);
  for(let i=0;i<5;i++)cylinder(.105,.31,-5.75+i*.23,.3,5.7,0xc5b686,audio);
  trace([[-5.98,1.6],[-4.66,1.6],[-4.66,7.38]],0xd8c7a0,.37);
  const firmware=component('Firmware flash','Nonvolatile flash stores the firmware used to initialize the platform before handing control to the operating system.','FIRMWARE');
  box(.39,.12,.3,1.22,.23,6.2,0x1e242d,firmware);
  for(let i=0;i<4;i++)for(const side of [-1,1])box(.06,.045,.04,1.22+side*.225,.21,6.1+i*.068,0x939eaf,firmware,.8);
  header('Front-panel audio','Connects the case audio jacks to the motherboard audio circuitry.',-5.51,7.03,5,2,8);
  header('USB 2.0 header · 1','Internal USB connects case ports and internal peripheral devices.',-1.9,7.11,5,2,9);
  header('USB 2.0 header · 2','A second internal USB connection for case ports and devices.',-.85,7.11,5,2,9);
  header('Front-panel connectors','Pins for the case power switch, reset switch, and status LEDs.',3.9,6.38,7);
  const usb3=header('USB 3 header','A shrouded 19-pin connector for front-panel USB ports, beside the DIMM and main power area.',5.21,.58,2,10,19);
  for(const x of [5.1,5.49])box(.045,.27,1.42,x,.31,1.165,0x272c35,usb3);
  for(const z of [.47,1.86])box(.43,.27,.045,5.295,.31,z,0x272c35,usb3);
  header('System fan header','A connector supplies power and fan control to a case fan.',2.68,6.18,4,1);
  header('Clear RTC jumper','With the system powered off, this jumper can reset firmware settings.',1.02,7.12,2,1);
  const superIO=component('Super I/O controller','Handles low-speed board functions such as fan monitoring, legacy interfaces, and hardware sensors.','I/O CONTROLLER');
  box(.65,.09,.65,-4.05,.21,1.7,0x1b2029,superIO);
  for(let i=0;i<8;i++)for(const side of [-1,1]){
    box(.07,.025,.025,-4.05+side*.36,.18,1.45+i*.07,0x808a9a,superIO,.7);
    box(.025,.025,.07,-4.3+i*.07,.18,1.7+side*.36,0x808a9a,superIO,.7);
  }

  // Deterministic small components give the board density without random flicker.
  // Populate functional islands, leaving connectors, mounting holes, and the
  // audio isolation strip clear instead of spreading parts in blanket grids.
  for(const [startX,startZ,columns,rows] of [[2.65,.17,6,3],[3.2,3.65,5,4],[-2.45,6.05,6,2],[-5.9,3.25,3,4]] as const){
    for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
      const x=startX+col*.27;const z=startZ+row*.17;
      box(.105,.055,.06,x,.18,z,0x8b95a3);box(.055,.035,.06,x+.11,.17,z,0x202632);
    }
  }
  for(let i=0;i<18;i++)cylinder(.068,.16,1.65,.22,-5.7+i*.25,0x909bac);

  // A second node sits beyond the ATX board only when demonstrating NUMA.
  const remote=new THREE.Group();scene.add(remote);
  const remoteNode=addNode('remote',2.8,.18,3.3,9.05,.12,2.5,0x303943,remote);
  box(1.45,.24,1.45,0,.24,-.4,0x8a94aa,remoteNode);
  for(let i=0;i<2;i++)box(.15,.72,2.3,.95+i*.35,.41,0,0x606d7e,remoteNode);
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
