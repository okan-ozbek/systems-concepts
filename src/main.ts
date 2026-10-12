import './style.css';
import type { CppLab } from './lab';
import { layout } from './layout';
import { architectures, lessons, type Architecture, type Lesson, type Step } from './lessons';
import { HardwareScene, nodeInfo } from './scene';
import { Playback, snapshot } from './simulation';

const paths:Record<string,string>={
  cpu:'M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3M6 6h12v12H6zM10 10h4v4h-4z',
  arrow:'M5 12h14m-5-5 5 5-5 5',play:'m9 5 11 7-11 7z',pause:'M8 5v14M16 5v14',
  next:'m5 5 10 7-10 7zM19 5v14',prev:'m19 5-10 7 10 7zM5 5v14',
  reset:'M3 10a9 9 0 1 1 2 8M3 4v6h6',search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  layers:'m12 3 10 6-10 6L2 9zM2 13l10 6 10-6M2 17l10 6 10-6',
  book:'M12 6c-3-3-7-3-10-2v15c4-1 7-1 10 2m0-15c3-3 7-3 10-2v15c-4-1-7-1-10 2z',
  expand:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  code:'m8 6-6 6 6 6m8-12 6 6-6 6m-2-15-4 18',
  info:'M12 11v6m0-10v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  check:'m5 12 4 4L19 6',close:'m6 6 12 12M6 18 18 6',
  orbit:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 2c-6 5-6 15 0 20 6-5 6-15 0-20M2 12h20',
  download:'M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4',menu:'M4 6h16M4 12h16M4 18h16',
  clock:'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'
};
const icon=(name:string,cls='')=>`<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]??paths.cpu}"/></svg>`;
const escape=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const $=<T extends HTMLElement=HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
let lesson:Lesson=lessons[0];let variant=0;let arch:Architecture='x86';let steps:Step[]=lesson.steps(variant,arch);
let currentTab='idea';let completed=new Set<string>();
let touring=false;
try{completed=new Set(JSON.parse(localStorage.getItem('hood-completed')??'[]'));}catch{/* Storage is optional. */}
const playback=new Playback();if(matchMedia('(prefers-reduced-motion: reduce)').matches)playback.playing=false;
let scene:HardwareScene|null=null;let inspected:string|null=null;
let lab:CppLab|null=null;
let labLoading:Promise<CppLab>|null=null;

$('#app').innerHTML=layout(icon, Object.entries(architectures).map(([id,a])=>`<option value="${id}">${a.name}</option>`).join(''));
function setWalkthroughOpen(open:boolean){
  if(open&&matchMedia('(max-width: 760px)').matches)$<HTMLDetailsElement>('#notes-panel').open=false;
  $('.walkthrough').classList.toggle('minimized',!open);$('#walkthrough-toggle').setAttribute('aria-expanded',String(open));
  $('#walkthrough-toggle').setAttribute('aria-label',open?'Minimize playback panel':'Expand playback panel');
}
function setFocusMode(focused:boolean){document.body.classList.toggle('panels-hidden',focused);$('#restore-ui').hidden=!focused;if(focused)closeSidebar();}
$('#walkthrough-toggle').addEventListener('click',()=>setWalkthroughOpen($('.walkthrough').classList.contains('minimized')));
$('#focus-mode').addEventListener('click',()=>setFocusMode(true));$('#restore-ui').addEventListener('click',()=>setFocusMode(false));
if(matchMedia('(max-width: 760px)').matches)setWalkthroughOpen(false);
const compactViewport=matchMedia('(max-width: 760px)');
function syncViewMenu(){$<HTMLDetailsElement>('#view-menu').open=!compactViewport.matches;}
syncViewMenu();compactViewport.addEventListener('change',syncViewMenu);
$('#notes-panel').addEventListener('toggle',()=>{if($<HTMLDetailsElement>('#notes-panel').open&&compactViewport.matches)setWalkthroughOpen(false);});

function renderNav(query=''){
  const filtered=lessons.filter(l=>`${l.title} ${l.description} ${l.tag}`.toLowerCase().includes(query.toLowerCase()));
  const groups=[...new Set(filtered.map(l=>l.group))];
  $('#lesson-nav').innerHTML=groups.map(group=>`<div class="nav-group"><h2>${group}</h2>${filtered.filter(l=>l.group===group).map(l=>`<button data-lesson="${l.id}" class="nav-lesson ${l.id===lesson.id?'active':''}" ${l.id===lesson.id?'aria-current="page"':''}><span class="nav-number">${String(lessons.indexOf(l)+1).padStart(2,'0')}</span><span>${l.title}</span>${completed.has(l.id)?icon('check','nav-check'):'<span class="nav-indicator"></span>'}</button>`).join('')}</div>`).join('')||'<p class="no-results">No matching concepts.</p>';
  $('#completed-count').textContent=`${completed.size} explored`;$('#course-fill').style.width=`${completed.size/lessons.length*100}%`;
}
function setLesson(id:string,updateHash=true,preserveTour=false){
  if(id==='cpp-lab'){openLab();return;}
  lab?.close();
  if(touring&&!preserveTour){touring=false;playback.loop=true;$<HTMLInputElement>('#repeat').checked=true;syncTour();}
  lesson=lessons.find(l=>l.id===id)??lessons[0];variant=0;inspected=null;
  if(lesson.id==='numa'){arch='numa';$<HTMLSelectElement>('#architecture').value=arch;scene?.setArchitecture(arch);}
  $<HTMLSelectElement>('#architecture').disabled=lesson.id==='numa';
  steps=lesson.steps(variant,arch);playback.reset();
  $('#lesson-title').textContent=lesson.title;$('#lesson-subtitle').textContent=lesson.subtitle;$('#lesson-tag').textContent=lesson.tag;
  $('#lesson-number').textContent=`${String(lessons.indexOf(lesson)+1).padStart(2,'0')} / 16`;$('#breadcrumb').textContent=lesson.group;
  $('#arch-badge').textContent=architectures[arch].short;
  $('#scenario').innerHTML=lesson.variants.map((v,i)=>`<button data-variant="${i}" aria-pressed="${i===variant}" class="${i===variant?'active':''}">${v}</button>`).join('');
  renderNav($<HTMLInputElement>('#search').value);renderSteps();renderTab();updateStep();
  closeSidebar();
  if(updateHash)history.replaceState(null,'',`#${lesson.id}`);
  $('#next-lesson').innerHTML=`${lessons.indexOf(lesson)===lessons.length-1?'Back to the start':'Next concept'} ${icon('arrow')}`;
}
function renderSteps(){
  $('#step-list').innerHTML=steps.map((s,i)=>`<li><button data-step="${i}"><span class="step-marker">${i+1}</span><span>${s.title}</span></button></li>`).join('');
  $('#timeline').innerHTML=steps.map((s,i)=>`<button data-step="${i}" aria-label="Step ${i+1}: ${s.title}" title="${s.title}"><span></span></button>`).join('');
}
function updateStep(){
  const step=steps[playback.index];const state=snapshot(steps,playback.index);
  scene?.setStep(step);
  $('#step-count').textContent=`STEP ${playback.index+1} / ${steps.length}`;$('#step-pill').textContent=`${playback.index+1} / ${steps.length}`;
  $('#step-label').textContent=step.title;$('#step-detail').textContent=step.detail;
  $('#signal-label').textContent=({request:'ADDRESS REQUEST',data:'DATA TRANSFER',ownership:'OWNERSHIP TRANSFER',invalidate:'INVALIDATE / REDIRECT',compute:'EXECUTION'} as const)[step.signal??'request'];
  $('#signal-label').dataset.signal=step.signal??'request';$('#value-chip').textContent=state.value;
  $('#cycles').textContent=String(state.cycles);$('#bytes').textContent=`${state.bytes} B`;$('#hit-count').textContent=String(state.hits);
  $('#state0').textContent=state.states[0];$('#state1').textContent=state.states[1];
  document.querySelectorAll<HTMLElement>('[data-cell]').forEach(el=>el.classList.toggle('lit',state.cells.includes(Number(el.dataset.cell))));
  document.querySelectorAll<HTMLElement>('#step-list [data-step], #timeline [data-step]').forEach(el=>{
    el.classList.toggle('active',Number(el.dataset.step)===playback.index);el.classList.toggle('done',Number(el.dataset.step)<playback.index);
    el.setAttribute('aria-current',Number(el.dataset.step)===playback.index?'step':'false');
  });
  document.querySelectorAll<HTMLElement>('#timeline [data-step] span').forEach((el,i)=>el.style.width=i<playback.index?'100%':i===playback.index?`${playback.progress*100}%`:'0%');
  renderConceptVisual();
  $('#inspector-copy').textContent=['coherence','false-sharing','writeback'].includes(lesson.id)?'S = shared · E = exclusive · M = modified · I = invalid. Badges show the illustrative line’s state.':'A fetch brings the entire line closer. Highlighted slots show the data used in this step.';
  if(playback.index===steps.length-1&&!completed.has(lesson.id)){
    completed.add(lesson.id);try{localStorage.setItem('hood-completed',JSON.stringify([...completed]));}catch{/* Storage is optional. */}renderNav($<HTMLInputElement>('#search').value);
  }
  syncPlay();
}
function renderConceptVisual(){
  let html='';const i=playback.index;
  const title=(label:string,badge:string)=>`<div class="line-title"><span class="small-label">${label}</span><span>${badge}</span></div>`;
  const boxes=(values:string[],active=true)=>`<div class="vector-row">${values.map(v=>`<span class="${active?'lit':''}">${v}</span>`).join('')}</div>`;
  if(lesson.id==='pipeline'){
    html=title('INSTRUCTIONS IN FLIGHT',variant?'12 beats':'6 beats');
    const labels=['Fetch','Decode','Execute','Retire'];
    html+=`<table class="pipeline-table"><thead><tr><th>Cycle</th><th>A</th><th>B</th><th>C</th></tr></thead><tbody>${Array.from({length:steps.length},(_,r)=>`<tr class="${r===i?'current':r<i?'past':''}"><th>${r+1}</th>${[0,1,2].map(c=>{const stage=variant?r-c*4:r-c;return `<td>${stage>=0&&stage<4?labels[stage]:'·'}</td>`;}).join('')}</tr>`).join('')}</tbody></table><p>${variant?'Each instruction waits for the previous one to finish.':'Stages overlap, while each instruction still passes through all four stages.'}</p>`;
  }
  if(lesson.id==='simd'){
    html=title('VECTOR REGISTER LANES',variant?'1 lane':'4 lanes')+boxes(variant?['2']:['2','5','3','8'])+'<div class="diagram-operation">+</div>'+boxes(variant?['1']:['1','2','4','1'])+'<div class="diagram-operation">↓ ADD</div>'+boxes(variant?['3']:['3','7','7','9'],i>=1)+'<p>Each displayed lane is 32 bits. One instruction applies the same operation across the active lanes.</p>';
  }
  if(lesson.id==='registers')html=title('THE ACTIVE OPERANDS','core 0')+`<div class="register-demo"><span>r0<b>7</b></span><span>r1<b>5</b></span><span class="${i>=2?'lit':''}">r2<b>${i>=2?'12':'—'}</b></span></div><p>Registers supply the ALU with operands. The result can feed the next instruction without another memory load.</p>`;
  if(lesson.id==='virtual')html=title('TRANSLATE, THEN ACCESS',variant?'walk':'hit')+`<div class="translation-diagram"><span class="lit">Virtual page <b>0x12</b></span><i>↓</i><span class="${i>=1?'lit':''}">${variant?'Page-table walk':'TLB mapping'} <b>0x12 → 0xA3</b></span><i>↓</i><span class="${i>=2?'lit':''}">Physical page <b>0xA3</b></span></div><p>Example page numbers. The offset within the page stays the same. All pages here are present in memory.</p>`;
  if(lesson.id==='numa')html=title('MEMORY HAS A HOME',variant?'remote':'local')+`<div class="numa-diagram"><span class="lit">NODE 0<b>CPU + local DRAM</b></span><i>↔</i><span class="${variant&&i>0?'lit':''}">NODE 1<b>CPU + remote DRAM</b></span></div><p>${variant?'The memory request crosses the inter-node link.':'The memory request stays on the same node.'} A cache hit can avoid either DRAM path.</p>`;
  if(lesson.id==='branch')html=title('PREDICTED PATH',variant?'miss':'correct')+`<div class="branch-diagram"><span class="lit">Branch</span><i>→</i><span class="${variant&&i>=2?'flushed':'lit'}">Predicted work</span><i>→</i><span class="${i>=2?'lit':''}">${variant?'Redirect':'Retire'}</span></div><p>${variant?'A wrong guess discards younger speculative results.':'A correct guess keeps the instruction stream moving.'}</p>`;
  if(lesson.id==='dram'){
    const row=variant&&i===1?-1:variant&&i>=2?2:1;
    html=title('ONE DRAM BANK · SCHEMATIC','rows')+`<div class="dram-rows">${Array.from({length:4},(_,r)=>`<div class="${r===row?'lit':''}"><span>row ${r}</span>${Array.from({length:8},()=>'<i></i>').join('')}</div>`).join('')}</div><div class="row-buffer">ROW BUFFER <b>${row<0?'precharged / no open row':`row ${row} open`}</b></div><p>Rows contain many cache lines. This miniature bank shows row selection, not the physical row size.</p>`;
  }
  if(lesson.id==='false-sharing'&&variant===1){
    html=title('INDEPENDENT CACHE LINES','2 × 64 B')+`<div class="separate-lines"><span>Core 0 · line A</span>${boxes(['a','·','·','·'])}<span>Core 1 · line B</span>${boxes(['b','·','·','·'])}</div><p>Each counter occupies a separate aligned line. Both cores can retain Modified ownership.</p>`;
  }
  $('#concept-visual').innerHTML=html;$('.line-inspector').classList.toggle('custom',!!html);
}
function syncPlay(){ $('#play').innerHTML=icon(playback.playing?'pause':'play');$('#play').setAttribute('aria-label',playback.playing?'Pause simulation':'Play simulation'); }
function syncTour(){$('#tour').innerHTML=`${icon(touring?'pause':'play')}<span>${touring?'End guided tour':'Start guided tour'}</span>${icon('arrow')}`;}
function renderTab(){
  const content=$('#tab-content');content.setAttribute('aria-labelledby',`tab-${currentTab}`);
  if(currentTab==='idea')content.innerHTML=`<p class="description">${lesson.description}</p><div class="takeaway"><span>${icon('arrow')}</span><p>${lesson.takeaway}</p></div>`;
  if(currentTab==='code')content.innerHTML=`<pre><code>${escape(lesson.code)}</code></pre><div class="experiment-link"><span>Connect the animation to real measurements.</span><a href="/experiments.cpp" download>${icon('download')}C++ experiments</a></div>`;
  if(currentTab==='notes')content.innerHTML=`<p class="description">${lesson.caveat}</p><div class="model-note">${icon('cpu')}<p>${architectures[arch].note}</p></div>`;
}
function showGuide(mode='guide'){
  const guides=`<h2>Build your mental movies.</h2><p class="dialog-intro">Start with one core reading a value. Then follow the data between caches. Finally, watch two cores touch the same line.</p><div class="guide-movies"><button data-open-lesson="load"><b>01</b><span>A single core reading data</span>${icon('arrow')}</button><button data-open-lesson="hierarchy"><b>02</b><span>A value traveling through memory</span>${icon('arrow')}</button><button data-open-lesson="coherence"><b>03</b><span>Two cores sharing a line</span>${icon('arrow')}</button></div><h3>Diagram → experiment → explanation</h3><p>Predict what will happen with the scenario controls. Download the three experiments, measure on your own machine, then replay the lesson to explain the result.</p><a class="download-link" href="/experiments.cpp" download>${icon('download')} Download C++ experiment suite</a><pre><code>g++ -O3 -std=c++20 -pthread experiments.cpp -o experiments\n./experiments locality 8388608\n./experiments sharing 10000000\n./experiments layout 8388608</code></pre><p class="fine-print">Use Linux, WSL, or a toolchain with C++20 support. Adjust the data size above your last-level cache. Times depend on the processor, compiler, scheduling, and memory placement. Run several times.</p>`;
  const about=`<h2>A useful model of the machine.</h2><p class="dialog-intro">This is an animated teaching model, not a cycle-accurate CPU emulator. Time is stretched so every transfer can be followed.</p><p>The package is opened to show two representative cores, private caches, a shared last-level cache, and external memory. A real processor’s topology can differ. All counters describe the selected scripted sequence; they are not measurements of your browser or CPU.</p><h3>Reading the colors</h3><p>Orange: address requests. Mint: data. Violet: ownership. Red: invalidation or discarded work. Blue: computation.</p><h3>Keep these distinctions in mind</h3><p>Coherence is per cache line; memory ordering is a separate concern. An invalid cache copy is not a deleted variable. A TLB miss is not automatically a page fault. A thread is software scheduled onto execution hardware.</p><h3>Continue with primary references</h3><ul class="resource-list"><li><a href="https://www.intel.com/content/www/us/en/developer/articles/technical/intel64-and-ia32-architectures-optimization.html" target="_blank" rel="noopener noreferrer">Intel architecture optimization manuals ↗</a></li><li><a href="https://www.intel.com/content/www/us/en/docs/vtune-profiler/cookbook/2024-0/false-sharing.html" target="_blank" rel="noopener noreferrer">Intel VTune: false sharing ↗</a></li><li><a href="https://developer.arm.com/documentation/100020/0001/functional-description/about-the-functions/fully-coherent-home-node?lang=en" target="_blank" rel="noopener noreferrer">Arm CoreLink: coherence and home nodes ↗</a></li><li><a href="https://docs.kernel.org/mm/numa.html" target="_blank" rel="noopener noreferrer">Linux kernel: NUMA ↗</a></li></ul><h3>Keyboard shortcuts</h3><p>Space: play / pause · ← / →: change step · R: replay · /: find a concept. F: show or hide panels. Expand Lesson details to reach component inspection with Tab.</p>`;
  $('#dialog-content').innerHTML=mode==='guide'?guides:about;$<HTMLDialogElement>('#guide-dialog').showModal();
}

$('#lesson-nav').addEventListener('click',e=>{const b=(e.target as Element).closest<HTMLElement>('[data-lesson]');if(b)setLesson(b.dataset.lesson!);});
$('#search').addEventListener('input',()=>renderNav($<HTMLInputElement>('#search').value));
$('#scenario').addEventListener('click',e=>{
  const b=(e.target as Element).closest<HTMLElement>('[data-variant]');if(!b)return;
  variant=Number(b.dataset.variant);steps=lesson.steps(variant,arch);playback.reset();
  document.querySelectorAll<HTMLElement>('[data-variant]').forEach(el=>{el.classList.toggle('active',Number(el.dataset.variant)===variant);el.setAttribute('aria-pressed',String(Number(el.dataset.variant)===variant));});
  renderSteps();updateStep();
});
function seekFromEvent(e:Event){const b=(e.target as Element).closest<HTMLElement>('[data-step]');if(b){playback.seek(Number(b.dataset.step),steps.length);playback.playing=false;updateStep();}}
$('#step-list').addEventListener('click',seekFromEvent);$('#timeline').addEventListener('click',seekFromEvent);
$('#play').addEventListener('click',()=>{if(!playback.playing&&playback.progress>=1&&!playback.loop)playback.reset();playback.playing=!playback.playing;syncPlay();});
$('#replay').addEventListener('click',()=>{playback.reset();updateStep();});
$('#prev-step').addEventListener('click',()=>{playback.playing=false;playback.seek(playback.index-1,steps.length);updateStep();});
$('#next-step').addEventListener('click',()=>{playback.playing=false;playback.next(steps.length);updateStep();});
$('#speed').addEventListener('change',()=>{playback.speed=Number($<HTMLSelectElement>('#speed').value);});
$('#repeat').addEventListener('change',()=>{playback.loop=$<HTMLInputElement>('#repeat').checked;if(playback.loop){touring=false;syncTour();}});
$('#architecture').addEventListener('change',()=>{arch=$<HTMLSelectElement>('#architecture').value as Architecture;scene?.setArchitecture(arch);steps=lesson.steps(variant,arch);playback.reset();$('#arch-badge').textContent=architectures[arch].short;renderTab();renderSteps();updateStep();});
$('#explode').addEventListener('click',()=>{if(scene){scene.setExploded(!scene.exploded);$('#explode').setAttribute('aria-pressed',String(scene.exploded));scene.setStep(lab?.active?lab.step:steps[playback.index]);}});
$('#top-view').addEventListener('click',()=>{scene?.topView();$('#top-view').setAttribute('aria-pressed',String(scene?.top));});
$('#reset-camera').addEventListener('click',()=>{scene?.resetCamera();$('#top-view').setAttribute('aria-pressed','false');});
$('#focus-cpu').addEventListener('click',()=>{scene?.focusCPU();$('#top-view').setAttribute('aria-pressed','false');});
document.querySelectorAll<HTMLElement>('[data-tab]').forEach(el=>el.addEventListener('click',()=>{
  currentTab=el.dataset.tab!;document.querySelectorAll<HTMLElement>('[data-tab]').forEach(t=>t.setAttribute('aria-selected',String(t===el)));renderTab();
}));
$('#next-lesson').addEventListener('click',()=>setLesson(lessons[(lessons.indexOf(lesson)+1)%lessons.length].id));
$('#guide').addEventListener('click',()=>showGuide());$('#about').addEventListener('click',()=>showGuide('about'));$('#state-help').addEventListener('click',()=>showGuide('about'));
$('#tour').addEventListener('click',()=>{
  touring=!touring;playback.loop=!touring;$<HTMLInputElement>('#repeat').checked=playback.loop;
  if(touring){setLesson(lessons[0].id,true,true);playback.playing=true;syncPlay();}
  syncTour();
});
$('#close-guide').addEventListener('click',()=>$<HTMLDialogElement>('#guide-dialog').close());
$('#guide-dialog').addEventListener('click',e=>{if(e.target===$('#guide-dialog'))$<HTMLDialogElement>('#guide-dialog').close();});
$('#dialog-content').addEventListener('click',e=>{const b=(e.target as Element).closest<HTMLElement>('[data-open-lesson]');if(b){setLesson(b.dataset.openLesson!);$<HTMLDialogElement>('#guide-dialog').close();}});
function closeSidebar(){$('#sidebar').classList.remove('mobile-open');$('#mobile-menu').setAttribute('aria-expanded','false');}
function openSidebar(){$('#sidebar').classList.add('mobile-open');$('#mobile-menu').setAttribute('aria-expanded','true');}
$('#mobile-menu').addEventListener('click',()=>{const open=$('#sidebar').classList.toggle('mobile-open');$('#mobile-menu').setAttribute('aria-expanded',String(open));});
$('#sidebar-close').addEventListener('click',closeSidebar);
window.addEventListener('hashchange',()=>setLesson(location.hash.slice(1),false));
window.addEventListener('keydown',e=>{
  if(e.key==='Escape'){closeSidebar();setFocusMode(false);}
  if(lab?.active)return;
  if(['INPUT','SELECT','TEXTAREA','BUTTON','A'].includes((e.target as HTMLElement).tagName)||$<HTMLDialogElement>('#guide-dialog').open)return;
  if(e.code==='Space'){e.preventDefault();$('#play').click();}
  if(e.key==='ArrowRight'){e.preventDefault();$('#next-step').click();}if(e.key==='ArrowLeft'){e.preventDefault();$('#prev-step').click();}
  if(e.key.toLowerCase()==='r')$('#replay').click();if(e.key.toLowerCase()==='f')setFocusMode(!document.body.classList.contains('panels-hidden'));
  if(e.key==='/'){e.preventDefault();setFocusMode(false);openSidebar();$('#search').focus();}
});

try{
  scene=new HardwareScene($('#canvas-container'),id=>{
    if(lab?.active)return;
    setFocusMode(false);setWalkthroughOpen(true);
    inspected=id;playback.playing=false;syncPlay();
    $('#signal-label').textContent='COMPONENT INSPECTOR';$('#step-detail').textContent=nodeInfo[id].detail;$('#value-chip').textContent=nodeInfo[id].name;
  });
}catch(error){
  console.warn('WebGL initialization unavailable',error);
  $('#canvas-container').innerHTML=`<div class="webgl-fallback">${icon('cpu')}<h2>Explore the hardware step by step.</h2><p>3D rendering is unavailable in this browser. The complete lesson sequence, data, and controls still work.</p><div class="fallback-path">Registers → L1 → L2 → L3 → DRAM</div></div>`;
}
function loadLab():Promise<CppLab>{
  if(lab)return Promise.resolve(lab);
  return labLoading??=import('./lab').then(({CppLab})=>{
    lab=new CppLab(step=>scene?.setStep(step),()=>{
      playback.playing=false;touring=false;syncTour();closeSidebar();setFocusMode(false);
      $('#breadcrumb').textContent='Experimental workspace';$('#open-cpp-lab').innerHTML='Back to lessons';
      $<HTMLSelectElement>('#architecture').disabled=true;scene?.resetCamera();
    },()=>{$('#open-cpp-lab').innerHTML='C++ Lab <span>Experimental</span>';});
    return lab;
  });
}
function openLab(){
  history.replaceState(null,'','#cpp-lab');
  const button=$<HTMLButtonElement>('#open-cpp-lab');
  button.disabled=true;button.textContent='Opening C++ Lab…';
  void loadLab().then(instance=>{
    // A lesson selected while the module loads should keep that selection.
    if(location.hash==='#cpp-lab')instance.open();
  }).catch(error=>{
    labLoading=null;
    console.warn('C++ Lab could not be loaded',error);
    button.title='Could not open the C++ Lab. Refresh the page or click to retry.';
  }).finally(()=>{
    button.disabled=false;
    if(!lab?.active)button.innerHTML='C++ Lab <span>Experimental</span>';
  });
}
$('#open-cpp-lab').addEventListener('click',()=>{if(lab?.active)setLesson(lesson.id);else openLab();});
const initialLesson=location.hash.slice(1)||'load';
setLesson(initialLesson==='cpp-lab'?'load':initialLesson,false);
if(initialLesson==='cpp-lab')openLab();
let last=performance.now();
function frame(now:number){
  const delta=Math.min((now-last)/1000,.1);last=now;
  if(!lab?.active&&playback.tick(delta,steps.length)){inspected=null;updateStep();}
  lab?.tick(delta);
  if(touring&&!playback.playing&&playback.progress>=1){
    const next=lessons.indexOf(lesson)+1;
    if(next<lessons.length){setLesson(lessons[next].id,true,true);playback.playing=true;syncPlay();}
    else{touring=false;syncTour();}
  }
  scene?.render(now/1000,lab?.active?lab.progress:playback.progress);
  const fill=document.querySelector<HTMLElement>(`#timeline [data-step="${playback.index}"] span`);if(fill)fill.style.width=`${playback.progress*100}%`;
  requestAnimationFrame(frame);
}requestAnimationFrame(frame);
