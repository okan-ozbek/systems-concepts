# Experimental C++ Lab

Open `http://localhost:8080/#cpp-lab`, or choose **C++ Lab** in the header.
Start both the web app and compiler with:

```sh
docker compose up --build -d
```

Edit `main.cpp`, choose an example, and select **Compile & run**
(Ctrl/Cmd+Enter). Step with the arrows, play the captured trace, or seek a
checkpoint in the timeline or execution history. Red value chips mark changes
from the preceding snapshot. Program input is supplied before running.
The draft persists in browser local storage. Changing it invalidates the trace.

The desktop workspace starts with an even split between the IDE and motherboard.
Drag the divider to resize the IDE; its width is remembered across reloads.
Focus the divider and use Left/Right (Shift for larger adjustments), Home/End
for its limits, or double-click to restore the even split. Both sides retain a
minimum width. Camera controls live in the IDE's top navigation and collapse
into a menu when the IDE is narrow. The IDE's
bottom runner has Trace, Variables, Console (including stdin), and Diagnostics
tabs; the concept navigation opens within the IDE side. Playback controls stay
under the motherboard. Left/Right step through checkpoints, Home/End jump to
the beginning/end, and Space toggles playback when a native button or text
control is not focused. Editor arrows retain normal caret movement; arrows on
runner tabs switch tabs, and the timeline supports its native range controls.
On narrow screens the IDE sits above the model with both regions visible.

## What is real and what is modeled

Clang from [WASI SDK 30](https://github.com/WebAssembly/wasi-sdk/releases/tag/wasi-sdk-30)
compiles C++20 to wasm32 at `-O0`. We use Clang's source AST to insert checkpoints
at statement boundaries in `main`, rather than interpreting C++ with JavaScript
or inserting calls into arbitrary lines with regular expressions.
The compiler first validates the original program, then compiles the instrumented
version. The returned binary runs in a dedicated browser Web Worker.

Snapshots contain actual numeric values and WASM linear-memory addresses, plus
console output from the captured run. C arrays, numeric `std::array`, and numeric
`std::vector` expose their element buffers. These addresses are not native stack,
physical RAM, or hardware register addresses. Instrumentation changes the binary
and its memory layout. Undefined behavior in user code still means the results
cannot be trusted.

Checkpoints after declarations and expressions show their completed effects.
Enter-scope checkpoints mark block entry. Before checkpoints mark control-flow decisions, break/continue,
and return. A loop's body-entry checkpoint repeats with each iteration, including
its initialized iteration variable. The final checkpoint records completion and
the output. Playback navigates immutable snapshots; stepping backward does not
reverse or re-execute the program. Blank lines/comments are skipped; multi-line
statements are identified by their starting line.

Clang's AST also wraps evaluated array/vector subscripts, `at`/`front`/`back`,
pointer dereferences, fields, and reference aliases in `main`. Each supported
access reports its actual WASM address, byte size, source expression/line, and
read/write/read-modify-write mode. Index/base side effects execute once; binding
a reference or taking `sizeof` does not become a fictitious load. Access hooks
preserve the lvalue and const/volatile qualifiers. Return-expression accesses
are retained on the return checkpoint. A condition's evaluated accesses can
appear with the following scope/statement checkpoint; their own source line is
shown in the ordered access list.

The Three.js memory routes now come from a **stateful data-cache simulation**,
rather than assuming every memory-looking statement misses to DRAM:

- 64-byte aligned lines; L1 32 KiB / 8-way, L2 256 KiB / 8-way,
  L3 8 MiB / 16-way; per-set LRU replacement, inclusive hierarchy, one core.
- A cold demand fetch fills the whole line. Neighboring elements reuse it;
  actual buffer alignment determines the element grouping. This models the
  contiguous storage required for numeric vectors by the
  [C++ vector specification](https://eel.is/c++draft/vector.overview).
- Write-allocate stores fetch a missing line and mark its L1 copy dirty.
  Eviction moves modified data down the hierarchy; an L3 writeback reaches DRAM.
  A store is not automatically an immediate DRAM write. These are documented
  cache principles, with an explicit simplified profile; see the
  [Intel optimization manuals](https://www.intel.com/content/www/us/en/developer/articles/technical/intel64-and-ia32-architectures-optimization.html).
- Numeric buffer initialization and library changes are inferred from snapshots
  and labeled separately from captured accesses. Initialization warms the cache,
  so a small freshly constructed vector's scan normally hits L1 in this model.
  Preserved data in a relocated vector produces an inferred copy; ownership
  transfers between watched vectors do not invent element copies.
- Instrumentation's own snapshot reads are excluded. Scalar locals are shown as
  conceptual registers; their loads/stores and vector-object metadata are not
  included in the buffer/field access simulation. Helper/library/allocator and
  constructor internals are not traced. Changed snapshots cannot reveal library
  reads or stores that leave values unchanged. No traffic is invented for an
  unsupported access or `new` alone.
- Playback precomputes immutable cache results once per run. Seeking backward,
  replaying, or pausing does not warm the caches again. Up to 50,000 captured
  access events and 50,000 simulated line lookups are allowed. If the simulation
  budget is exceeded, prediction stops explicitly while captured values remain.

The runner shows the aligned line, highlighted element bytes, modeled hit/fill
counts, and an ordered list of accesses and writebacks. For a statement with
multiple accesses, the animation highlights the furthest explicit demand;
inferred initialization is animated when there is no explicit access.
Native compiler optimization, host physical addresses, instruction caches,
prefetching, speculative/out-of-order execution, TLB behavior, coherence between
cores, timing, and **actual host cache hits** are not measured. No fabricated
cycle counters are added. Optimized native C++ may vectorize or eliminate loads,
so this source-level wasm32 model cannot predict an exact native instruction trace.

## First-version boundaries

- One translation unit; checkpoints inside `main`, not helper-function bodies.
- Declarations, expressions, nested block scopes, braced `if`/`else`, `for`,
  `while`, `return`, `break`, and `continue`. Unsupported control structures
  report an error instead of silently producing an incomplete trace.
- Only initialized numeric locals are watched. Uninitialized locals are never
  read by instrumentation, including when they shadow an initialized name.
  Up to 32 variables and 32 elements per variable are shown.
- Numeric vectors/arrays are supported. Pointers, class internals, strings,
  vector<bool>, and long double are not watched. Programs may use some of those
  objects normally; the tracer omits them.
- No custom macros, conditional preprocessing, project files, threads,
  exceptions, filesystem, or network access. Allowed standard headers are listed
  in `compiler/instrument.py`. Use small examples rather than a full project.
- Budgets: 16 KB source, 4 MB binary, 32 MB WASM memory, 400 checkpoints,
  16 KB output, 5 seconds browser execution. Compilation has a wall-clock and
  CPU budget per stage, one active compilation, and 6 requests/minute per client
  with a small initial burst. Cancel aborts the browser request/worker; an
  already-started server compilation finishes within its own bounded deadline.

## Container isolation and deployment

The compiler has an unprivileged UID, read-only root filesystem, a small temporary
filesystem, dropped capabilities, no-new-privileges, and memory/CPU/process limits.
It is attached only to an internal Docker network. It has no host mounts, Docker
socket, credentials, published port, or outbound network. The NGINX container
proxies the same-origin `/api/cpp/` endpoint to it. Submitted code is compiled only;
no user binary is run on the server. Worker imports expose console/stdin,
linear-memory reads, clock/random, and trace hooks; host filesystem and socket
calls return a capability error. The worker is terminated when finished,
cancelled, or past its deadline.

`compose.vps.yaml` includes the same service for a later VPS deployment and
preserves the shared Caddy network on the web container only. This experiment
has been built and tested locally; no VPS deployment is performed as part of
this change. The public compiler would need operational monitoring and an
appropriate access policy before broad use.

For Vite development, keep Docker running, then run `npm run dev`.
`vite.config.ts` proxies API calls through the local Docker app at port 8080.

## Verification

```sh
npm test
npm run build
npm run test:cpp
```

The integration command uses the running compiler and the built browser worker.
It checks arithmetic, line attribution, arrays/loops, vectors, branches, input,
floats, scope/shadowing, helper calls, break/continue, diagnostics, and budgets.
It also verifies evaluated addresses, side effects, nested subscripts, reference
aliases, return accesses, and real vector iteration through the same cache replay
used by the UI. Unit tests check line reuse/alignment, initialization, conflict
eviction, LRU, L2/L3 hits, dirty writebacks, relocation/ownership, seeking, and
clear animation paths in normal and exploded motherboard views.
To target another approved instance, set `CPP_LAB_URL` before running it.
For a batch of local tests, set `CPP_LAB_DIRECT=1` to call the same API through
`docker compose exec`, avoiding the interactive NGINX rate limit. In PowerShell:
`$env:CPP_LAB_DIRECT='1'; npm run test:cpp; Remove-Item Env:CPP_LAB_DIRECT`.
