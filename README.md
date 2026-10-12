# Under the Hood

A Three.js systems-learning lab: follow animated requests, data, and ownership traffic through an exposed CPU package, private caches, shared L3, and RAM on a procedural 3D motherboard.

The charcoal interface uses red accents around a viewport-filling ATX motherboard. The green PCB has the 244 × 305 mm ATX proportions, rear I/O, VRM heatsinks, four DIMM slots with two modules, PCIe slots, M.2 storage, chipset, SATA ports, power connectors, a CMOS battery, and internal headers. The CPU is an enlarged teaching cutaway. Component names and descriptions appear only while hovering; there is no printed lettering or persistent field of labels. Floating playback and detail panels can be collapsed; focus mode hides the interface.

Use **Focus CPU and memory** in the camera controls to inspect the smaller CPU units. Reset returns to the full board. Bright paths with moving arrowheads follow the active lesson route. Their screen width stays consistent as you zoom, and their raised, rounded paths clear the model. These are teaching overlays rather than literal electrical wires. Cache layers separate smoothly, with routes following the moving units. Peripheral geometry supplies context and hover explanations; the lessons continue to focus on CPU and memory activity. Lesson details sits alongside the bottom timeline and opens upward. On touch devices, its book button opens the notes and CPU/memory component picker.

The layout is representative rather than a replica of a particular product. ATX dimensions and connector placement were checked against [ASUS ATX specifications](https://www.asus.com/uk/motherboards-components/motherboards/tuf-gaming/tuf-gaming-z790-plus-d4/techspec/) and the [ASUS motherboard layout manual](https://dlcdnets.asus.com/pub/ASUS/mb/LGA1700/ROG_STRIX_B760-A_GAMING_WIFI_D4/G21348_ROG_STRIX_B760-A_GAMING_WIFI_D4_UM_WEB.pdf?model=ROG+STRIX+B760-A+GAMING+WIFI+D4).

## Run in Docker

Requires Docker with Linux containers (for example Docker Desktop).

```sh
docker compose up --build -d
```

Open **http://localhost:8080**. Stop with `docker compose down`.

The multi-stage Dockerfile builds the TypeScript/Vite application and serves the static output using Nginx. No backend, account, API key, or database is needed. Port 8080 is configurable in `compose.yaml`.

The VPS deployment at [systems.pixelware.nl](https://systems.pixelware.nl) uses a separate shared Caddy stack for HTTPS. See [VPS deployment and HTTPS](DEPLOYMENT.md) and the [migration report](deploy/VPS-MIGRATION-REPORT.md). The standalone `compose.vps.yaml` connects the app to the proxy network without publishing another host port.

## Run locally

Requires Node.js 22.12+ or Node.js 24.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite (normally http://localhost:5173).

```sh
npm test
npm run build
npm run preview
```

## Explore

- Sixteen lessons: memory reads, registers, cache lines, hierarchy, pipelines, sequential/random locality, DRAM, prefetching, coherence, false sharing, write-back, arrays/lists, branches, SIMD, virtual memory/TLBs, and NUMA.
- Start the guided tour to automatically replay each lesson in order. It uses the first scenario of each concept and stops after the NUMA lesson. Pause and resume freely; manually selecting a lesson ends the tour.
- Each lesson has two comparison scenarios. Pause, seek a numbered step, change speed, replay, or turn looping off. Animation progress is independent of the illustrative model-cycle totals.
- Left-drag to orbit; right-drag to move the camera across the board; scroll to zoom. Hover over hardware to identify it; moving away dismisses the label. Use the camera controls for the CPU/RAM close-up, top view, full-board reset, and an exploded cache-layer view. Click a CPU or memory unit to inspect it, or choose a component in Lesson details.
- Open the menu for concepts and the guided tour. Expand Lesson details for explanations, code, diagrams, and keyboard-accessible component inspection. Expand All steps to seek a moment; minimize Playback to keep the board clear. F hides or restores the floating panels; Escape restores them and closes the concept menu.
- Switch between generic x86-64, Arm64, and two-node NUMA topologies. The NUMA lesson selects and retains the NUMA view. Arm and x86 use the same deliberately generic two-core hierarchy; neither is a model of a specific chip.
- Read the explanation, inspect code, or see architecture/model notes in Lesson details. The field guide includes real C++ experiments and primary references.
- Space: play/pause; arrows: previous/next step; R: replay; /: search. Native control behavior takes precedence when a control is focused. Reduced-motion preference starts playback paused.
- Completed lessons are stored in this browser’s local storage. Deep-link a lesson with its hash, e.g. `/#false-sharing`.

## Connect the diagram to a measurement

Download `public/experiments.cpp` from the app or use it directly. With a C++20 compiler (Linux or WSL recommended):

```sh
g++ -O3 -std=c++20 -pthread public/experiments.cpp -o experiments
./experiments locality 8388608
./experiments sharing 10000000
./experiments layout 8388608
```

The experiments print elapsed time and checksums, prepare traversal orders outside the timed region, and repeat each comparison. Tune the working set beyond your last-level cache. In the false-sharing experiment, place threads on different physical cores for a meaningful result. These small experiments illustrate effects, not isolated laboratory measurements; allocation, indexing overhead, data footprint, vectorization, scheduling, and the platform affect results.

## Accuracy and scope

This is a deterministic educational animation, **not a cycle-accurate emulator or a benchmark of your hardware**. The playback model uses illustrative costs. Its bytes counter sums the explicit transfers in the lesson, not all physical bus traffic; its hit/miss events are teaching events rather than hardware performance-counter readings. Transfers spanning several illustrated levels count once. The serial cache lookup and fill path is simplified; real accesses overlap and cache policies vary.

The modeled line size is 64 bytes with sixteen 4-byte integer slots. The example array is aligned. The CPU exposes two representative cores. L1 is shown as a data cache; instruction caches, register renaming, store buffers, complex pipelines, and cache directories are omitted. Coherence is MESI-style rather than a complete protocol implementation. Language-level data races and memory ordering require separate treatment. The board, traces, and dimensions are illustrative, not electrical schematics.

Three.js and all app assets are bundled locally. The interface uses local system fonts. WebGL is required for the 3D board. If it is unavailable, the textual lessons and simulation controls remain usable.

Primary references used to ground the explanations:

- [Intel architecture optimization manuals](https://www.intel.com/content/www/us/en/developer/articles/technical/intel64-and-ia32-architectures-optimization.html)
- [Intel VTune false sharing](https://www.intel.com/content/www/us/en/docs/vtune-profiler/cookbook/2024-0/false-sharing.html)
- [Arm CoreLink coherent home nodes](https://developer.arm.com/documentation/100020/0001/functional-description/about-the-functions/fully-coherent-home-node?lang=en)
- [Linux kernel NUMA documentation](https://docs.kernel.org/mm/numa.html)

## Source map

- `src/lessons.ts`: lesson content, routes, variants, and illustrative event costs.
- `src/simulation.ts`: deterministic playback and cumulative state reconstruction.
- `src/scene.ts`: procedural Three.js motherboard, camera, hit testing, labels, and animated paths.
- `src/main.ts`, `src/layout.ts`, `src/style.css`: responsive floating interface, accessibility, and controls.
- `src/simulation.test.ts`: meaningful scenario invariants and playback tests.

To add a concept, add a `Lesson` with two variant labels and a steps function, using the available `NodeId` endpoints. Add scene endpoints when needed. Update the lesson count in the interface if you change the curriculum size.
