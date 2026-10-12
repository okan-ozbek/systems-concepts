export function layout(icon:(name:string,cls?:string)=>string, architectureOptions:string){
  return `
  <main class="workspace">
    <section class="stage" id="stage" aria-label="Hardware simulation">
      <div id="canvas-container"></div>
      <div class="board-caption"><span id="arch-badge">X86-64</span><span>ATX / exposed CPU package</span></div>
      <div class="stage-bottom"><div class="legend"><span><i class="request-dot"></i>Request</span><span><i class="data-dot"></i>Data</span><span><i class="ownership-dot"></i>Ownership</span></div><span class="orbit-hint">Left-drag to orbit · right-drag to move · scroll to zoom</span></div>
    </section>

    <header class="topbar floating-panel">
      <div class="topbar-left"><button id="mobile-menu" class="icon-button" aria-label="Toggle lesson navigation" aria-controls="sidebar" aria-expanded="false">${icon('menu')}</button><a class="app-name" href="#load">${icon('cpu')}Under the Hood</a><span class="header-divider"></span><span id="breadcrumb">The foundations</span></div>
      <div class="topbar-right"><button id="open-cpp-lab" class="lab-mode-button">C++ Lab <span>Experimental</span></button><label class="architecture">${icon('cpu')}<select id="architecture" aria-label="Hardware architecture">${architectureOptions}</select></label><span class="header-divider"></span><details class="view-menu" id="view-menu" open><summary aria-label="Camera and view options">${icon('orbit')}</summary><div class="view-menu-body"><button class="icon-button" id="focus-cpu" aria-label="Focus CPU and memory" title="Focus CPU and memory">${icon('cpu')}</button><button class="icon-button" id="explode" aria-label="Separate the cache layers" title="Separate the cache layers" aria-pressed="false">${icon('layers')}</button><button class="icon-button" id="top-view" aria-label="Toggle top view" title="Toggle top view" aria-pressed="false">${icon('expand')}</button><button class="icon-button" id="reset-camera" aria-label="Reset camera" title="Reset camera">${icon('orbit')}</button><button id="focus-mode" class="icon-button" aria-label="Hide panels" title="Focus mode (F)">${icon('close')}</button><button id="about" class="icon-button" aria-label="About this simulation" title="About this simulation">${icon('info')}</button></div></details></div>
    </header>

    <div class="lesson-heading"><div class="eyebrow"><span id="lesson-number">01 / 16</span><span id="lesson-tag">START HERE</span></div><h1 id="lesson-title"></h1><p id="lesson-subtitle"></p></div>

    <aside class="walkthrough floating-panel" aria-label="Current step">
      <div class="walkthrough-heading"><span>Playback</span><span class="step-pill" id="step-pill"></span><button id="walkthrough-toggle" class="icon-button" aria-label="Minimize playback panel" aria-expanded="true" aria-controls="walkthrough-body">${icon('layers')}</button></div>
      <div class="walkthrough-body" id="walkthrough-body">
        <div class="scenario" id="scenario"></div>
        <div class="step-detail" aria-live="polite"><span class="signal-label" id="signal-label"></span><p id="step-detail"></p><div class="value-chip" id="value-chip"></div></div>
        <details class="sequence"><summary>All steps <span>Jump to a moment</span></summary><ol id="step-list"></ol></details>
        <div class="metrics"><div><b id="cycles">0</b><span>model cycles</span></div><div><b id="bytes">0 B</b><span>bytes moved</span></div><div><b id="hit-count">0</b><span>cache hits</span></div></div><span class="metric-note">Illustrative totals · not measured</span>
        <div class="page-footer"><button id="next-lesson">Next concept ${icon('arrow')}</button></div>
      </div>
    </aside>

    <details class="notes-panel floating-panel" id="notes-panel">
      <summary aria-label="Lesson details: notes, code and diagram" title="Lesson details">${icon('book')}<span>Lesson details</span><span class="summary-meta">Notes / code / diagram</span>${icon('arrow')}</summary>
      <div class="notes-body"><div class="tabs" role="tablist" aria-label="Lesson details"><button role="tab" aria-selected="true" id="tab-idea" data-tab="idea" aria-controls="tab-content">The idea</button><button role="tab" aria-selected="false" id="tab-code" data-tab="code" aria-controls="tab-content">Code & experiment</button><button role="tab" aria-selected="false" id="tab-notes" data-tab="notes" aria-controls="tab-content">Model notes</button></div><div id="tab-content" role="tabpanel" aria-labelledby="tab-idea"></div>
        <div class="line-inspector"><div id="concept-visual"></div><div class="line-title"><span class="small-label">CACHE LINE</span><span>64 B</span></div><div id="line-cells" class="line-cells">${Array.from({length:16},(_,i)=>`<span data-cell="${i}">${i}</span>`).join('')}</div><div class="line-ruler"><span>16 × 4-byte integers</span><span id="line-caption">Selected bytes</span></div><div class="cache-states"><span>Core 0 <b id="state0">—</b></span><span>Core 1 <b id="state1">—</b></span><button id="state-help" title="Explain coherence states">${icon('info')}</button></div><p id="inspector-copy"></p></div>
        <details class="component-picker"><summary>Inspect a component</summary><div id="component-controls"></div></details>
      </div>
    </details>

    <div class="playback floating-panel" aria-label="Simulation controls"><div class="transport"><button id="replay" class="icon-button" title="Replay lesson (R)">${icon('reset')}</button><button id="prev-step" class="icon-button" title="Previous step (←)">${icon('prev')}</button><button id="play" class="play-button" aria-label="Pause simulation">${icon('pause')}</button><button id="next-step" class="icon-button" title="Next step (→)">${icon('next')}</button></div><div class="scrubber"><div class="scrubber-label"><span id="step-count"></span><span id="step-label"></span></div><div id="timeline" class="timeline" aria-label="Jump to a simulation step"></div></div><div class="playback-settings"><label class="repeat-label"><input type="checkbox" id="repeat" checked>Loop</label><select id="speed" aria-label="Playback speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="3">3×</option></select></div></div>
    <button id="restore-ui" class="floating-panel" hidden>${icon('menu')}Show controls</button>
  </main>

  <aside class="sidebar floating-panel" id="sidebar" aria-label="Concept library">
    <div class="drawer-header"><span>Concepts <b>16</b></span><button id="sidebar-close" class="icon-button" aria-label="Close lesson navigation">${icon('close')}</button></div>
    <div class="search-box">${icon('search')}<input id="search" type="search" placeholder="Find a concept…" aria-label="Search concepts"><kbd>/</kbd></div><nav id="lesson-nav" aria-label="Lessons"></nav>
    <div class="sidebar-bottom"><button id="tour">${icon('play')}<span>Start guided tour</span>${icon('arrow')}</button><button id="guide">${icon('book')}<span>Open the field guide</span>${icon('arrow')}</button><div class="course-progress"><span id="completed-count"></span><span>16 concepts</span></div><div class="course-track"><div id="course-fill"></div></div></div>
  </aside>

  <dialog id="guide-dialog"><div class="dialog-header"><span class="small-label">FIELD GUIDE</span><button id="close-guide" class="icon-button" aria-label="Close field guide">${icon('close')}</button></div><div id="dialog-content"></div></dialog>`;
}
