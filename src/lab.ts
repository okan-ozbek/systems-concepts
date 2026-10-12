import './lab.css';
import type { LabResult } from './lab-types';
import type { Step } from './lessons';
import { cacheConfig, lineValues, modelTrace, type ModeledMoment } from './lab-cache';

const examples=[
{name:'Arithmetic',source:`#include <iostream>

int main() {
    int a = 7;
    int b = 5;
    int result = a + b;
    result *= 2;
    std::cout << "Result: " << result << '\\n';
    return 0;
}`},
{name:'Array & loop',source:`#include <iostream>

int main() {
    int values[4] = {2, 5, 3, 8};
    int total = 0;
    for (int i = 0; i < 4; ++i) {
        total += values[i];
    }
    std::cout << "Sum: " << total << '\\n';
    return 0;
}`},
{name:'Vector',source:`#include <iostream>
#include <vector>

int main() {
    std::vector<int> values{1, 2, 3, 4};
    values.push_back(5);
    int total = 0;
    for (std::size_t i = 0; i < values.size(); ++i) {
        total += values[i];
    }
    std::cout << "Sum: " << total << '\\n';
    return 0;
}`},
{name:'Memory read / write',source:`#include <iostream>

int main() {
    int values[4] = {10, 20, 30, 40};
    int loaded = values[2];  // initialization may already leave this line in L1
    values[1] = loaded + 5;  // store into L1; writeback can happen later
    int result = values[1]; // reuse the dirty L1 line
    std::cout << result << '\\n';
    return 0;
}`},
{name:'Branch',source:`#include <iostream>

int main() {
    int temperature = 24;
    int fan = 0;
    if (temperature > 20) {
        fan = 1;
    } else {
        fan = 0;
    }
    std::cout << "Fan: " << fan << '\\n';
    return 0;
}`}];
const escape=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function highlight(line:string){
  return line.split(/(\/\/.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:int|double|float|bool|char|auto|long|unsigned|const|return|for|while|if|else|true|false|void)\b|\b\d+(?:\.\d+)?\b|#include)/g).map(token=>{
    const kind=token.startsWith('//')?'comment':/^["']/.test(token)?'string':/^\d/.test(token)?'number':/^(?:#include|int|double|float|bool|char|auto|long|unsigned|const|return|for|while|if|else|true|false|void)$/.test(token)?'keyword':'';
    return kind?`<span class="syntax-${kind}">${escape(token)}</span>`:escape(token);
  }).join('');
}
const controlPaths={rewind:'M3 10a9 9 0 1 1 2 8M3 4v6h6',prev:'m14 6-6 6 6 6',next:'m10 6 6 6-6 6',play:'m9 5 11 7-11 7z',pause:'M8 5v14M16 5v14'};
const controlIcon=(name:keyof typeof controlPaths)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${name==='play'?`<path d="${controlPaths[name]}" fill="currentColor" stroke="none"/>`:`<path d="${controlPaths[name]}"/>`}</svg>`;

export class CppLab {
  active=false;playing=false;progress=0;step:Step={title:'Ready',detail:'',route:[]};
  private root:HTMLElement;private editor:HTMLTextAreaElement;private result:LabResult|null=null;
  private index=0;private compiledSource='';private worker:Worker|null=null;private controller:AbortController|null=null;
  private modeled:ModeledMoment[]=[];
  private timer:ReturnType<typeof setTimeout>|null=null;private busy=false;private runId=0;private lastLine=-1;
  private reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  private splitPercent=50;private resizePointer:number|null=null;private previousViewOpen=true;
  constructor(private onStep:(step:Step)=>void,private onOpen:()=>void,private onClose:()=>void){
    this.root=document.createElement('section');this.root.id='cpp-lab';this.root.hidden=true;this.root.setAttribute('aria-label','Experimental C++ workspace');
    this.root.innerHTML=`
      <div class="lab-ide" id="lab-ide">
      <section class="lab-editor-panel" aria-label="C++ editor">
        <div class="lab-panel-heading"><div><span class="lab-kicker">EXPERIMENTAL</span><h1>C++ Lab</h1></div><span class="lab-language">C++20</span></div>
        <div class="lab-filebar"><span>main.cpp</span><select id="lab-example" aria-label="Load a C++ example">${examples.map((e,i)=>`<option value="${i}">${e.name}</option>`).join('')}</select></div>
        <div class="lab-editor-wrap"><div class="lab-gutter" aria-hidden="true"></div><div class="lab-editor-content"><pre class="lab-highlight" aria-hidden="true"></pre><textarea id="lab-editor" aria-label="C++ source code" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off"></textarea></div></div>
        <div class="lab-runbar"><button id="lab-run" class="lab-primary">Compile & run <kbd>Ctrl ↵</kbd></button><button id="lab-stop" aria-label="Cancel compilation or execution" disabled>Stop</button></div>
        <div id="lab-status" role="status" aria-live="polite"></div>
        <details class="lab-help"><summary>How this experiment works</summary><p>Clang compiles your code to WebAssembly at -O0. Checkpoints record real values; source-level indexed accesses, dereferences, and field accesses in main record their evaluated addresses and sizes. Playback replays that captured run.</p><p>Loops and branches need braces. Numeric locals must have initializers; C arrays, numeric std::array, and numeric std::vector show up to 32 values. Helper functions and library internals execute but are not stepped into. Pointers and other objects are omitted from variable snapshots; supported field accesses still report addresses. Long double, threads, exceptions, macros, and file I/O are outside this view.</p><p>After checkpoints show a completed statement. Enter-scope checkpoints include evaluated loop conditions. Before checkpoints mark control flow and return. Comments and blank lines have no checkpoints. A multi-line statement uses its starting line.</p><p>Cache simulation: 64 B lines, L1 32 KiB / 8-way, L2 256 KiB / 8-way, L3 8 MiB / 16-way; inclusive LRU, write-back and write-allocate, one core, no prefetch. Initialization, vector relocation, and uninstrumented library stores are inferred from snapshots. Tracer reads do not warm simulated caches. Addresses are wasm32 linear-memory addresses. Native optimization, allocator activity, instructions, physical addresses, and actual host cache hits are not measured.</p></details>
      </section>
      <section class="lab-state-panel" aria-label="Trace runner">
        <div class="lab-runner-header"><div class="lab-runner-tabs" role="tablist" aria-label="Run inspection">${['Trace','Variables','Console','Diagnostics'].map((label,i)=>`<button id="lab-tab-${label.toLowerCase()}" role="tab" aria-selected="${i===0}" aria-controls="lab-pane-${label.toLowerCase()}" data-pane="${label.toLowerCase()}" tabindex="${i===0?'0':'-1'}">${label}</button>`).join('')}</div><span class="lab-captured-badge">CAPTURED</span></div>
        <div class="lab-runner-body">
          <div id="lab-pane-trace" class="lab-pane lab-trace-pane" role="tabpanel" aria-labelledby="lab-tab-trace" tabindex="0">
            <div class="lab-history"><div class="lab-history-heading">Checkpoints <span id="lab-history-count">0</span></div><ol id="lab-history"></ol></div>
            <div class="lab-moment"><span id="lab-location">No run yet</span><h2 id="lab-moment-title">Write. Run. Follow.</h2><p id="lab-explanation">Compile an example, then walk through each checkpoint on the motherboard.</p><div id="lab-cache-details" aria-label="Simulated cache accesses"></div></div>
          </div>
          <div id="lab-pane-variables" class="lab-pane" role="tabpanel" aria-labelledby="lab-tab-variables" tabindex="0" hidden><div class="lab-values-heading"><span>Variables</span><span>WASM memory</span></div><div id="lab-values" class="lab-values"></div></div>
          <div id="lab-pane-console" class="lab-pane" role="tabpanel" aria-labelledby="lab-tab-console" tabindex="0" hidden><div class="lab-console-heading"><span>Program output</span><span id="lab-exit">—</span></div><pre id="lab-output" aria-label="Program output">No output yet.</pre><details class="lab-input"><summary>Program input <span>stdin · supplied before running</span></summary><textarea id="lab-stdin" aria-label="Program standard input" placeholder="Input consumed by std::cin…" rows="2" maxlength="4000"></textarea></details></div>
          <div id="lab-pane-diagnostics" class="lab-pane" role="tabpanel" aria-labelledby="lab-tab-diagnostics" tabindex="0" hidden><details class="lab-diagnostics" id="lab-diagnostics-panel" open><summary>Compiler diagnostics</summary><pre id="lab-diagnostics">No compiler diagnostics.</pre></details></div>
        </div>
      </section>
      </div>
      <div class="lab-divider" role="separator" tabindex="0" aria-label="Resize IDE width" aria-orientation="vertical" aria-controls="lab-ide lab-model-panel" aria-valuemin="25" aria-valuemax="75" aria-valuenow="50" title="Drag to resize · arrow keys to adjust · double-click to reset"></div>
      <section class="lab-model-panel" id="lab-model-panel" aria-label="Motherboard and trace playback">
        <div class="lab-model-heading"><span>Motherboard</span><span>CPU & memory</span></div>
        <div class="lab-model-note"><i></i>Data cache simulation · 64 B lines<span>Drag to orbit · right-drag to move</span></div>
        <div class="lab-transport floating-panel" aria-label="Trace playback controls">
          <div class="lab-transport-heading"><span>Trace playback</span><span id="lab-counter">0 / 0</span></div>
          <div class="lab-transport-controls"><div class="lab-control-buttons"><button id="lab-rewind" aria-label="Replay captured trace" title="Replay captured trace (Home)">${controlIcon('rewind')}</button><button id="lab-prev" aria-label="Previous checkpoint" title="Previous checkpoint (←)">${controlIcon('prev')}</button><button id="lab-play" class="lab-primary" aria-label="Play captured trace" title="Play / pause (Space)">${controlIcon('play')}</button><button id="lab-next" aria-label="Next checkpoint" title="Next checkpoint (→)">${controlIcon('next')}</button></div><span id="lab-phase">Compile to create a trace</span><select id="lab-speed" aria-label="Trace playback speed"><option value="1">1×</option><option value="2">2×</option><option value="0.5">0.5×</option></select></div>
          <div class="lab-seek"><input type="range" id="lab-timeline" min="0" max="0" value="0" aria-label="Trace checkpoint" disabled></div>
        </div>
      </section>`;
    document.querySelector('.workspace')!.append(this.root);this.editor=this.get<HTMLTextAreaElement>('#lab-editor');
    let saved='';try{saved=localStorage.getItem('hood-cpp-source')??'';}catch{/* Storage optional. */}
    this.editor.value=saved||examples[0].source;
    const custom=document.createElement('option');custom.value='custom';custom.textContent='Custom draft';custom.disabled=true;this.get<HTMLSelectElement>('#lab-example').prepend(custom);
    this.syncExample();this.paint();
    try{const width=Number(localStorage.getItem('hood-cpp-ide-width'));if(width>=25&&width<=75)this.splitPercent=width;}catch{/* Storage optional. */}
    const divider=this.get('.lab-divider');
    divider.addEventListener('pointerdown',event=>{
      if(event.button!==0||innerWidth<=760)return;event.preventDefault();this.resizePointer=event.pointerId;
      divider.setPointerCapture(event.pointerId);document.body.classList.add('lab-resizing');divider.focus();
      this.setSplit(event.clientX/innerWidth*100);
    });
    divider.addEventListener('pointermove',event=>{if(event.pointerId===this.resizePointer)this.setSplit(event.clientX/innerWidth*100);});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])divider.addEventListener(event,()=>this.finishResize());
    divider.addEventListener('dblclick',()=>{this.setSplit(50);this.saveSplit();});
    divider.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
      const bounds=this.splitBounds();const increment=event.shiftKey?5:2;
      this.setSplit(event.key==='Home'?bounds.min:event.key==='End'?bounds.max:this.splitPercent+(event.key==='ArrowRight'?increment:-increment));this.saveSplit();
    });
    window.addEventListener('resize',()=>{if(this.active)this.setSplit(this.splitPercent);});
    window.addEventListener('blur',()=>this.finishResize());
    new ResizeObserver(()=>{if(this.active)this.syncNavigation();}).observe(document.querySelector('.topbar')!);
    this.editor.addEventListener('input',()=>this.changed());this.editor.addEventListener('scroll',()=>this.syncScroll());
    this.editor.addEventListener('keydown',event=>{if(event.key==='Tab'){event.preventDefault();this.editor.setRangeText('    ',this.editor.selectionStart,this.editor.selectionEnd,'end');this.changed();}});
    this.get('#lab-run').addEventListener('click',()=>void this.run());
    this.get('#lab-stop').addEventListener('click',()=>{this.cancel();this.setStatus('Run cancelled.');});
    this.get<HTMLSelectElement>('#lab-example').addEventListener('change',()=>{this.editor.value=examples[Number(this.get<HTMLSelectElement>('#lab-example').value)].source;this.changed();});
    this.get('#lab-next').addEventListener('click',()=>this.seek(this.index+1));this.get('#lab-prev').addEventListener('click',()=>this.seek(this.index-1));
    this.get('#lab-rewind').addEventListener('click',()=>this.seek(0));this.get('#lab-play').addEventListener('click',()=>this.togglePlay());
    this.get<HTMLInputElement>('#lab-timeline').addEventListener('input',()=>this.seek(Number(this.get<HTMLInputElement>('#lab-timeline').value)));
    this.get('#lab-history').addEventListener('click',event=>{const button=(event.target as Element).closest<HTMLElement>('[data-moment]');if(button)this.seek(Number(button.dataset.moment));});
    const tabs=Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-pane]'));
    for(const tab of tabs){
      tab.addEventListener('click',()=>this.selectPane(tab.dataset.pane!));
      tab.addEventListener('keydown',event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();const index=tabs.indexOf(tab);
        const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
        this.selectPane(tabs[next].dataset.pane!);tabs[next].focus();
      });
    }
    window.addEventListener('keydown',event=>{
      if(!this.active||event.defaultPrevented||document.querySelector('dialog[open]'))return;
      if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();void this.run();return;}
      const target=event.target as HTMLElement;
      if(event.altKey||event.ctrlKey||event.metaKey||target.closest('input,select,textarea,[contenteditable="true"]'))return;
      if(event.code==='Space'&&!target.closest('button,summary,a')){event.preventDefault();this.togglePlay();}
      if(event.key==='ArrowRight'){event.preventDefault();this.seek(this.index+1);}if(event.key==='ArrowLeft'){event.preventDefault();this.seek(this.index-1);}
      if(event.key==='Home'){event.preventDefault();this.seek(0);}if(event.key==='End'){event.preventDefault();this.seek((this.result?.moments.length??1)-1);}
    });
    this.setStatus('Ready to compile');this.controls();
  }
  private get<T extends HTMLElement=HTMLElement>(selector:string){return this.root.querySelector<T>(selector)!;}
  private splitBounds(){return innerWidth<=760?{min:25,max:75}:{min:Math.max(25,360/innerWidth*100),max:Math.min(75,100-360/innerWidth*100)};}
  private setSplit(percent:number){
    const {min,max}=this.splitBounds();this.splitPercent=innerWidth<=760?this.splitPercent:Math.max(min,Math.min(max,percent));
    document.body.style.setProperty('--lab-ide-width',`${this.splitPercent}%`);
    const divider=this.get('.lab-divider');divider.setAttribute('aria-valuemin',String(Math.round(min)));divider.setAttribute('aria-valuemax',String(Math.round(max)));divider.setAttribute('aria-valuenow',String(Math.round(this.splitPercent)));divider.setAttribute('aria-valuetext',`${Math.round(this.splitPercent)} percent IDE width`);
    this.syncNavigation();
  }
  private saveSplit(){try{localStorage.setItem('hood-cpp-ide-width',String(this.splitPercent));}catch{/* Storage optional. */}}
  private finishResize(){
    if(this.resizePointer===null)return;const id=this.resizePointer;this.resizePointer=null;
    const divider=this.get('.lab-divider');if(divider.hasPointerCapture(id))divider.releasePointerCapture(id);
    document.body.classList.remove('lab-resizing');this.saveSplit();
  }
  private syncNavigation(){
    const nav=document.querySelector<HTMLElement>('.topbar')!;const compact=nav.clientWidth<600;
    if(nav.classList.contains('lab-nav-compact')!==compact){nav.classList.toggle('lab-nav-compact',compact);document.querySelector<HTMLDetailsElement>('#view-menu')!.open=!compact;}
  }
  private selectPane(name:string){
    for(const tab of Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-pane]'))){const selected=tab.dataset.pane===name;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;this.get(`#lab-pane-${tab.dataset.pane}`).hidden=!selected;}
  }
  open(){if(!this.active)this.previousViewOpen=document.querySelector<HTMLDetailsElement>('#view-menu')!.open;this.active=true;this.root.hidden=false;document.body.classList.add('lab-mode');this.setSplit(this.splitPercent);this.onOpen();history.replaceState(null,'','#cpp-lab');this.showMoment();}
  close(){if(!this.active)return;this.finishResize();this.cancel();this.active=false;this.root.hidden=true;document.body.classList.remove('lab-mode');document.querySelector('.topbar')!.classList.remove('lab-nav-compact');document.querySelector<HTMLDetailsElement>('#view-menu')!.open=this.previousViewOpen;this.onClose();}
  private paint(){
    const line=this.result?.moments[this.index]?.line??0;
    this.get('.lab-highlight').innerHTML=this.editor.value.split('\n').map((text,i)=>`<span class="lab-code-line ${i+1===line?'current':''}">${highlight(text)||' '}</span>`).join('')+'<span class="lab-code-line"> </span>';
    this.get('.lab-gutter').innerHTML=this.editor.value.split('\n').map((_,i)=>`<span class="${i+1===line?'current':''}">${i+1}</span>`).join('');this.syncScroll();
  }
  private syncScroll(){this.get('.lab-highlight').style.transform=`translate(${-this.editor.scrollLeft}px,${-this.editor.scrollTop}px)`;this.get('.lab-gutter').scrollTop=this.editor.scrollTop;}
  private syncExample(){const index=examples.findIndex(example=>example.source===this.editor.value);this.get<HTMLSelectElement>('#lab-example').value=index<0?'custom':String(index);}
  private changed(){
    this.cancel();this.result=null;this.modeled=[];this.index=0;this.lastLine=-1;this.syncExample();try{localStorage.setItem('hood-cpp-source',this.editor.value);}catch{/* Storage optional. */}
    this.setStatus('Source changed · compile to refresh the trace.');this.showMoment();
  }
  private setStatus(message:string,error=false){this.get('#lab-status').textContent=message;this.get('#lab-status').classList.toggle('error',error);}
  private cancel(){this.runId++;this.controller?.abort();this.controller=null;this.worker?.terminate();this.worker=null;if(this.timer)clearTimeout(this.timer);this.timer=null;this.busy=false;this.playing=false;this.controls();}
  private controls(){
    this.get<HTMLButtonElement>('#lab-run').disabled=this.busy;this.get<HTMLButtonElement>('#lab-stop').disabled=!this.busy;const count=this.result?.moments.length??0;
    for(const id of ['lab-rewind','lab-prev','lab-play','lab-next'])this.get<HTMLButtonElement>(`#${id}`).disabled=!count||this.busy;
    this.get<HTMLButtonElement>('#lab-prev').disabled=!count||this.index===0||this.busy;this.get<HTMLButtonElement>('#lab-next').disabled=!count||this.index===count-1||this.busy;
    this.get('#lab-play').innerHTML=controlIcon(this.playing?'pause':'play');this.get('#lab-play').setAttribute('aria-label',this.playing?'Pause captured trace':'Play captured trace');
    const slider=this.get<HTMLInputElement>('#lab-timeline');slider.disabled=!count||this.busy;slider.max=String(Math.max(0,count-1));slider.value=String(this.index);this.get('#lab-counter').textContent=`${count?this.index+1:0} / ${count}`;
  }
  private async run(){
    if(this.busy)return;this.cancel();const id=this.runId;this.result=null;this.modeled=[];this.index=0;this.lastLine=-1;this.busy=true;this.compiledSource=this.editor.value;this.showMoment();
    this.setStatus('Compiling with Clang…');this.controller=new AbortController();this.timer=setTimeout(()=>{if(id===this.runId){this.cancel();this.setStatus('Compilation timed out. Try a smaller program.',true);}},45000);
    try{
      const response=await fetch('/api/cpp/compile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:this.compiledSource}),signal:this.controller.signal});
      if(id!==this.runId)return;if([502,503,404].includes(response.status))throw new Error('Compiler service unavailable. Start this project with docker compose up --build -d.');
      if(response.status===429)throw new Error('Compiler is busy or the compile rate limit was reached. Wait a moment, then try again.');
      const payload=await response.json() as {wasm?:string;warnings?:string;compiler?:string;error?:string};if(!response.ok||!payload.wasm)throw new Error(payload.error??'Compilation failed.');
      if(this.timer)clearTimeout(this.timer);this.controller=null;this.get('#lab-diagnostics').textContent=payload.warnings||'No compiler diagnostics.';this.get<HTMLDetailsElement>('#lab-diagnostics-panel').open=Boolean(payload.warnings);
      this.setStatus('Running WebAssembly in your browser…');this.worker=new Worker(new URL('./lab.worker.ts',import.meta.url),{type:'module'});
      this.worker.onmessage=(event:MessageEvent<LabResult>)=>{if(id!==this.runId)return;if(this.timer)clearTimeout(this.timer);this.timer=null;this.worker?.terminate();this.worker=null;this.busy=false;this.result=event.data;this.modeled=modelTrace(event.data.moments,this.compiledSource);this.setStatus(event.data.error?`Stopped: ${event.data.error}`:`${event.data.moments.length} checkpoints · ${payload.compiler}`,Boolean(event.data.error));this.showMoment();};
      this.worker.onerror=event=>{if(id===this.runId){this.cancel();this.setStatus(`Execution failed: ${event.message}`,true);}};
      this.timer=setTimeout(()=>{if(id===this.runId){this.cancel();this.setStatus('Execution stopped after 5 seconds. Check for an infinite loop.',true);}},5000);
      const binary=Uint8Array.from(atob(payload.wasm),c=>c.charCodeAt(0)).buffer;this.worker.postMessage({wasm:binary,stdin:this.get<HTMLTextAreaElement>('#lab-stdin').value},[binary]);
    }catch(error){if(id!==this.runId)return;this.cancel();const message=error instanceof Error?error.message:String(error);this.get('#lab-diagnostics').textContent=message;this.get<HTMLDetailsElement>('#lab-diagnostics-panel').open=true;this.selectPane('diagnostics');this.setStatus('Could not create a trace. See diagnostics.',true);}
    this.controls();
  }
  private seek(index:number){const count=this.result?.moments.length??0;if(!count)return;this.index=Math.max(0,Math.min(count-1,index));this.progress=0;this.playing=false;this.showMoment();}
  private togglePlay(){if(!this.result?.moments.length)return;if(this.index===this.result.moments.length-1){this.index=0;this.progress=0;this.showMoment();}this.playing=!this.playing;this.controls();}
  tick(delta:number){
    if(!this.active)return;const speed=Number(this.get<HTMLSelectElement>('#lab-speed').value);
    if(this.playing){this.progress+=delta*speed/2.2;if(this.progress>=1){this.progress=0;if(this.index<(this.result?.moments.length??0)-1){this.index++;this.showMoment();}else{this.playing=false;this.controls();}}}
  }
  private showMoment(){
    const moment=this.result?.moments[this.index];this.paint();this.controls();this.get('#lab-history-count').textContent=String(this.result?.moments.length??0);
    this.get('#lab-history').innerHTML=(this.result?.moments??[]).map((m,i)=>`<li><button data-moment="${i}" class="${i===this.index?'active':''}" ${i===this.index?'aria-current="step"':''}><span>${i+1}</span>${m.phase==='end'?'Program finished':`${m.phase==='entry'?'Enter scope ·':m.phase==='after'?'After':'Before'} line ${m.line}`}</button></li>`).join('');
    const active=this.get('#lab-history').querySelector<HTMLElement>('.active');active?.scrollIntoView({block:'nearest'});
    if(!moment){this.step={title:'Ready',detail:'',route:[]};this.onStep(this.step);this.get('#lab-location').textContent='No run yet';this.get('#lab-moment-title').textContent='Write. Run. Follow.';this.get('#lab-explanation').textContent='Compile an example, then walk through each checkpoint on the motherboard.';this.get('#lab-cache-details').innerHTML='';this.get('#lab-values').innerHTML='<p class="lab-empty">Initialized numeric locals will appear here.</p>';this.get('#lab-output').textContent='No output yet.';this.get('#lab-exit').textContent='—';this.get('#lab-phase').textContent='Compile to create a trace';return;}
    const modeled=this.modeled[this.index];this.step=modeled.step;this.onStep(this.step);this.get('#lab-location').textContent=moment.phase==='end'?'RUN COMPLETE':`MAIN · LINE ${moment.line}`;this.get('#lab-moment-title').textContent=this.step.title;this.get('#lab-explanation').textContent=this.step.detail;this.get('#lab-phase').textContent=this.step.title;
    const stats=modeled.stats;const focus=modeled.focus;const contents=focus?lineValues(focus,moment.variables):null;
    this.get('#lab-cache-details').innerHTML=`<div class="lab-cache-heading"><span>Simulated data caches</span><span>${cacheConfig.lineBytes} B / line</span></div><div class="lab-cache-totals">${[['L1 hits',stats.l1],['L2 hits',stats.l2],['L3 hits',stats.l3],['DRAM fills',stats.dram],['Writebacks',stats.writebacks]].map(([label,value])=>`<span><b>${value}</b>${label}</span>`).join('')}</div><p class="lab-cache-profile">Cumulative modeled lookups · L1 32 KiB / L2 256 KiB / L3 8 MiB · LRU · initialization included</p>${focus?`<div class="lab-cache-line"><div><span>Line 0x${focus.lineBase.toString(16)} · ${focus.dirty?'dirty':'clean'}</span><span>${contents?escape(contents.name):'WASM address'}</span></div><div class="lab-line-values">${contents?.values.map(v=>`<span class="${v.active?'active':''}" title="${escape(contents.name)}[${v.index}] · 0x${v.address.toString(16)}">${escape(v.value)}<small>${v.index}</small></span>`).join('')||'<span class="lab-line-unavailable">Values outside the captured buffer window</span>'}</div><p>Neighboring elements share this aligned line; the highlighted bytes belong to the selected access.</p></div>`:''}${modeled.accesses.length?`<details class="lab-cache-accesses" open><summary>${modeled.accesses.length} line lookup${modeled.accesses.length===1?'':'s'} at this checkpoint</summary><ol>${modeled.accesses.slice(0,24).map(a=>`<li><div><b>${escape(a.expression)}</b><span>${a.servedBy==='DRAM'?'DRAM fill':`${a.servedBy} hit`}${a.mode==='read'?'': ' · dirty'}</span></div><small>${a.mode.toUpperCase()} ${a.bytes} B @ 0x${a.address.toString(16)} · line ${a.line} · ${a.inferred?'inferred from snapshot':'captured address'}</small>${a.writebacks.map(w=>`<small>Writeback: line 0x${w.lineBase.toString(16)} · ${w.from} → ${w.to}</small>`).join('')}</li>`).join('')}</ol>${modeled.accesses.length>24?`<p>${modeled.accesses.length-24} more lookups included in the totals.</p>`:''}</details>`:'<p class="lab-cache-idle">No supported buffer access at this checkpoint. Tracing snapshots do not count as program loads.</p>'}`;
    this.get('#lab-timeline').setAttribute('aria-valuetext',`${this.index+1} of ${this.result!.moments.length}: ${this.step.title}`);
    const previous=this.result!.moments[this.index-1];
    this.get('#lab-values').innerHTML=moment.variables.map(variable=>{
      const old=previous?.variables.find(v=>v.name===variable.name&&v.address===variable.address);const type=`${variable.kind===2?'f':variable.kind===1?'i':'u'}${variable.elementBytes*8}`;
      return `<div class="lab-variable"><div><b>${escape(variable.name)}</b><span>${type}${variable.bytes>variable.elementBytes?`[${variable.bytes/variable.elementBytes}]`:''} · 0x${variable.address.toString(16)}</span></div><div class="lab-memory-values">${variable.values.map((value,i)=>`<span class="${old?.values[i]!==value?'changed':''}" title="${escape(variable.name)}${variable.values.length>1?`[${i}]`:''} @ 0x${(variable.address+i*variable.elementBytes).toString(16)}">${escape(value)}</span>`).join('')}${variable.truncated?'<span>…</span>':''}</div></div>`;
    }).join('')||`<p class="lab-empty">${moment.phase==='end'?'Local scope has ended. Step back to inspect its values.':'No initialized numeric locals in this scope.'}</p>`;
    this.get('#lab-output').textContent=moment.output||'No output at this checkpoint.';this.get('#lab-exit').textContent=this.result!.exitCode===null?'Stopped':`exit ${this.result!.exitCode}`;
    if(moment.line&&moment.line!==this.lastLine){const top=(moment.line-1)*23;if(top<this.editor.scrollTop||top>this.editor.scrollTop+this.editor.clientHeight-46)this.editor.scrollTop=Math.max(0,top-this.editor.clientHeight/3);this.lastLine=moment.line;this.syncScroll();}
  }
}
