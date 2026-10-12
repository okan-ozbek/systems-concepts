export type NodeId = 'reg0' | 'reg1' | 'l10' | 'l11' | 'l20' | 'l21' | 'l3' | 'dram' | 'remote' | 'alu' | 'tlb' | 'io';
export type Signal = 'request' | 'data' | 'ownership' | 'invalidate' | 'compute';
export type Architecture = 'x86' | 'arm' | 'numa';
export interface Step {
  title: string; detail: string; route: NodeId[]; signal?: Signal;
  cycles?: number; bytes?: number; hit?: boolean; miss?: boolean;
  states?: [string, string]; cells?: number[]; value?: string;
}
export interface Lesson {
  id: string; group: string; title: string; subtitle: string; tag: string;
  description: string; takeaway: string; caveat: string; code: string;
  variants: [string, string]; steps: (variant: number, arch: Architecture) => Step[];
}
const s = (title: string, detail: string, route: NodeId[], extra: Partial<Step> = {}): Step => ({title, detail, route, ...extra});
const load = (warm: boolean): Step[] => warm ? [
  s('Issue a load', 'Core 0 asks for arr[100]. A load instruction names an address; the value is not in a register yet.', ['reg0','l10'], {cycles:1, value:'arr[100]'}),
  s('Find an L1 hit', 'The line containing arr[100] is already valid in the private L1 data cache. No trip to main memory is needed.', ['l10'], {cycles:4,hit:true,cells:[4],value:'L1 hit'}),
  s('Deliver the value', 'The selected 4-byte integer is delivered to a register. The rest of the cache line stays available for nearby accesses.', ['l10','reg0'], {signal:'data',bytes:4,value:'x = 42'})
] : [
  s('Issue a load', 'Core 0 asks for arr[100]. Follow the orange address request down the hierarchy.', ['reg0','l10'], {cycles:1,value:'arr[100]'}),
  s('Check the private caches', 'The line is absent from L1 and L2. These misses send the request toward the shared last-level cache.', ['l10','l20'], {cycles:12,miss:true,value:'L1 / L2 miss'}),
  s('Check the shared L3', 'No valid copy is present in this teaching model. The memory controller must request data from DRAM.', ['l20','l3'], {cycles:40,miss:true,value:'L3 miss'}),
  s('Reach main memory', 'DRAM accesses the row holding the address. This longer wait is why locality matters so much.', ['l3','dram'], {cycles:200,miss:true,value:'DRAM access'}),
  s('Bring back a whole line', 'A 64-byte line returns. Here it contains arr[96] through arr[111]: sixteen 4-byte integers.', ['dram','l3','l20','l10'], {signal:'data',bytes:64,cells:Array.from({length:16},(_,i)=>i),value:'64 B fill'}),
  s('Extract the requested value', 'arr[100] is slot 4 in this aligned line. Its 4 bytes reach a register, and execution can continue.', ['l10','reg0'], {signal:'data',bytes:4,cells:[4],value:'x = 42'})
];
export const lessons: Lesson[] = [
  {
    id:'load',group:'The foundations',title:'A single memory read',subtitle:'Follow one value from main memory to a CPU register.',tag:'START HERE',
    description:'Your code says x = arr[100]. The hardware has to locate the data, move a cache line, and deliver the requested bytes to the core. This is the first mental movie to master.',
    takeaway:'An L1 hit avoids the long journey to DRAM. Reusing nearby data is often more valuable than doing fewer arithmetic operations.',
    caveat:'The serial lookup and fills are a teaching model. Real CPUs overlap requests, use fill buffers, and differ in cache inclusion policies. Cycle counts throughout this app are illustrative, not measurements.',
    code:'// Assume 4-byte ints and a 64-byte aligned array.\nint x = arr[100];  // line: arr[96] … arr[111]\nint y = arr[101];  // can reuse the same line',variants:['Cold caches','L1 hit'],steps:v=>load(v===1)
  },
  {
    id:'registers',group:'The foundations',title:'Registers & execution',subtitle:'Where values become work.',tag:'CORE BASICS',
    description:'Registers hold the operands the core is actively using. A load brings values to registers; an execution unit operates on them; a store can eventually move results back to memory.',
    takeaway:'A thread is a stream of software execution. The OS schedules it on a core; it is not another physical CPU.',
    caveat:'Registers shown here are conceptual architectural registers. Modern cores also rename registers and use many more internal physical registers.',
    code:'// Conceptual assembly\nLOAD r0, [a]\nLOAD r1, [b]\nADD  r2, r0, r1\nSTORE [result], r2',variants:['One thread','Two cores'],steps:v=>[
      s('Load the operands','Two cached values enter the register file of core 0.',['l10','reg0'],{signal:'data',bytes:8,value:'r0 = 7, r1 = 5'}),
      s('Execute the addition','The arithmetic logic unit adds the operands. A clock edge advances the core’s work.',['reg0','alu'],{signal:'compute',cycles:1,value:'7 + 5'}),
      s('Keep the result','The result is available as a register value for dependent instructions.',['alu','reg0'],{signal:'data',value:'r2 = 12'}),
      v ? s('Another core works independently','A second scheduled thread can use core 1’s own registers and execution resources.',['l11','reg1'],{signal:'compute',cycles:1,value:'thread B → core 1'}) : s('Store the result','A store updates a cache line after acquiring write permission.',['reg0','l10'],{signal:'data',bytes:4,value:'result = 12'})
    ]
  },
  {
    id:'cacheline',group:'The foundations',title:'Inside a cache line',subtitle:'One requested integer. Sixteen delivered neighbors.',tag:'64 BYTES',
    description:'A cache line is the transfer and coherence unit in this model. With 4-byte integers and a 64-byte line, one fetch brings sixteen adjacent elements into the cache.',
    takeaway:'Variables and cache lines are different units. Addresses decide which values travel together.',
    caveat:'64 bytes is common on x86 CPUs and many Arm designs, but is not universal. The array is assumed aligned; type sizes and alignment change the mapping.',
    code:'// 64 B / 4 B per int = 16 integers\n// line base = floor(index / 16) * 16\nint a = arr[100]; // slot 4 in line 96–111\nint b = arr[111]; // slot 15, same line',variants:['arr[100]','arr[111]'],steps:v=>[
      s('Calculate the line address','Both index 100 and index 111 belong to the aligned line starting at index 96.',['reg0','l10'],{cells:[v?15:4],value:v?'slot 15':'slot 4'}),
      s('Fetch the crate','Memory delivers the whole line, including values the instruction did not ask for.',['dram','l3','l20','l10'],{signal:'data',bytes:64,cells:Array.from({length:16},(_,i)=>i),cycles:200,value:'16 adjacent ints'}),
      s('Select one item','Only the selected integer enters the destination register; the remaining fifteen stay in cache.',['l10','reg0'],{signal:'data',bytes:4,cells:[v?15:4],value:v?'arr[111]':'arr[100]'})
    ]
  },
  {
    id:'hierarchy',group:'The foundations',title:'The memory hierarchy',subtitle:'Small and close. Large and far away.',tag:'DATA DISTANCE',
    description:'Registers, L1, L2, L3, and DRAM trade capacity for access cost. The board opens the CPU package so you can see the small private caches and larger shared cache.',
    takeaway:'The closer valid copy can serve a read, the sooner the core can use it.',
    caveat:'Cache sizes, latencies, sharing boundaries, and the presence of L3 vary by CPU. These are generic topology examples, not models of a particular processor.',
    code:'Registers → active operands\nL1        → closest private cache\nL2        → larger private cache\nL3        → shared last-level cache\nDRAM      → main memory',variants:['Near → far','Far → near'],steps:v=>v ? [
      s('Main memory','The largest store in this model is external DRAM.',['dram'],{cycles:200,value:'DRAM • large / slower'}),
      s('Last-level cache','A shared cache reduces expensive off-chip requests.',['dram','l3'],{signal:'data',cycles:40,value:'L3 • shared'}),
      s('Private caches','L2 and L1 place useful data closer to one core.',['l3','l20','l10'],{signal:'data',cycles:12,value:'L2 → L1'}),
      s('Registers','Execution units consume operands in registers.',['l10','reg0'],{signal:'data',cycles:1,value:'registers • tiny / fast'})
    ] : [
      s('Registers','A few active operands live right beside execution.',['reg0'],{cycles:1,value:'~1 cycle'}),
      s('L1 data cache','A small private cache can satisfy many ordinary loads.',['reg0','l10'],{cycles:4,value:'~4 cycles'}),
      s('L2 cache','More capacity, with a longer access path.',['l10','l20'],{cycles:12,value:'~12 cycles'}),
      s('Shared L3 cache','Several cores share this larger cache.',['l20','l3'],{cycles:40,value:'~40 cycles'}),
      s('DRAM','Off-chip memory has much more capacity and latency.',['l3','dram'],{cycles:200,value:'~200 cycles'})
    ]
  },
  {
    id:'pipeline',group:'The foundations',title:'Clock cycles & pipelines',subtitle:'An assembly line for instructions.',tag:'IN FLIGHT',
    description:'A cycle is one beat of the core’s rhythm. A pipeline overlaps stages of different instructions. Superscalar cores can also begin or execute multiple operations per cycle.',
    takeaway:'Instruction latency and instruction throughput are different. Several instructions can be in flight while each still takes several cycles.',
    caveat:'The four-stage pipeline is deliberately simplified. Actual out-of-order cores use many stages, dependencies, queues, and multiple execution ports.',
    code:'Cycle   A        B        C\n  1     Fetch\n  2     Decode   Fetch\n  3     Execute  Decode   Fetch\n  4     Retire   Execute  Decode\n  5              Retire   Execute\n  6                       Retire',variants:['Pipelined','Serial'],steps:v=>v ? Array.from({length:12},(_,i)=>{
      const instruction=['A','B','C'][Math.floor(i/4)];const stage=['Fetch','Decode','Execute','Retire'][i%4];
      return s(`${stage} ${instruction}`,`The serial example completes each instruction before beginning another. Beat ${i+1}: ${stage.toLowerCase()} instruction ${instruction}.`,i%4===2?['reg0','alu']:['l10','reg0'],{cycles:1,signal:'compute',value:`${instruction}: ${stage.toLowerCase()}`});
    }) : Array.from({length:6},(_,i)=>s(`Clock beat ${i+1}`,['Fetch instruction A.','Decode A while fetching B.','Execute A, decode B, and fetch C.','Retire A, execute B, and decode C.','Retire B while executing C.','Retire C. Three instructions have completed in six illustrative beats.'][i],i%2?['reg0','alu']:['l10','reg0'],{cycles:1,signal:'compute',value:`cycle ${i+1}`}))
  },
  {
    id:'locality',group:'Moving data',title:'Sequential vs. random',subtitle:'Same data. A very different journey.',tag:'SPATIAL LOCALITY',
    description:'Sequential traversal uses neighbors already delivered in a cache line. Scattered accesses may bring in a new line for each value. Watch how the useful bytes per transfer change.',
    takeaway:'Contiguous data increases the work you can do with each fetched line.',
    caveat:'The scattered example uses four different cold lines. Real random access can hit caches; working-set size, associativity, prefetching, and memory parallelism matter.',
    code:'// Compare on a working set larger than your caches.\nfor (size_t i = 0; i < n; ++i)\n  sum += data[i];\n\n// Prepare shuffled indices outside the timed loop.\nfor (size_t i : shuffled_indices)\n  sum += data[i];',variants:['Sequential','Scattered'],steps:v=>[
      s('First cold load','Fetch a 64-byte line to read one integer.',['dram','l3','l20','l10','reg0'],{signal:'data',bytes:64,miss:true,cycles:200,cells:[0],value:'arr[0]'}),
      ...[1,2,3].map((i)=>v ? s(`Jump to index ${[1024,4096,8192][i-1]}`,'This address belongs to another cold line. Another whole 64-byte transfer serves just one requested integer.',['dram','l3','l20','l10','reg0'],{signal:'data',bytes:64,miss:true,cycles:200,cells:[0],value:`new line ${i+1}`}) : s(`Read the next neighbor: arr[${i}]`,'This value shares the fetched line. L1 supplies it without another DRAM transfer.',['l10','reg0'],{signal:'data',hit:true,cycles:4,cells:[i],value:'L1 hit'}))
    ]
  },
  {
    id:'dram',group:'Moving data',title:'Inside DRAM',subtitle:'Banks, rows, and the cost of opening a page.',tag:'MAIN MEMORY',
    description:'The memory controller translates requests into commands for DRAM banks. Opening a row places its contents in a row buffer; accesses to the open row can avoid opening another.',
    takeaway:'DRAM is structured storage. A row hit and a row conflict do not have the same cost.',
    caveat:'Row sizes, bank addressing, timings, and controller scheduling depend on the device and platform. DRAM rows are much larger than the sixteen-cell cache-line visualization.',
    code:'Request address\n  → memory controller\n  → select channel / bank / row\n  → activate row\n  → read a burst\n  → return a cache line',variants:['Row hit','Row conflict'],steps:v=>[
      s('Dispatch to the bank','The memory controller selects a bank for the physical address.',['l3','dram'],{signal:'request',cycles:20,value:'bank 0'}),
      v?s('Close the previous row','A conflicting row is open. Precharge prepares the bank for another activation.',['dram'],{cycles:60,value:'precharge'}) : s('Reuse the open row','The requested row is already in the row buffer. No conflicting row needs closing.',['dram'],{cycles:10,value:'row buffer hit'}),
      s(v?'Activate the requested row':'Select the columns',v?'Activate the new row into the row buffer.':'Select the columns holding the requested cache line.',['dram'],{cycles:v?60:10,cells:[0,1,2,3],value:v?'activate':'column read'}),
      s('Return the burst','Data travels back through the controller toward the requesting core.',['dram','l3','l20','l10'],{signal:'data',bytes:64,cycles:40,value:'64 B transfer'})
    ]
  },
  {
    id:'prefetch',group:'Moving data',title:'Hardware prefetching',subtitle:'Bring the next line closer before it is needed.',tag:'LOOK AHEAD',
    description:'Hardware can detect some access patterns and speculatively fetch future lines. It can hide part of the waiting time, provided there is a predictable stream and enough resources.',
    takeaway:'Predictable access patterns help hardware overlap memory movement with useful work.',
    caveat:'This is a generic stream-prefetch example. Prefetchers vary; they consume bandwidth and can fetch unused data. A prefetch is neither guaranteed nor free.',
    code:'for (size_t i = 0; i < n; ++i) {\n  sum += data[i];\n  // Hardware may detect the forward stream\n  // and request future cache lines.\n}',variants:['Predictable stream','Unpredictable jumps'],steps:v=>[
      s('Observe two loads','The core loads data and hardware observes the addresses.',['l10','reg0'],{cycles:4,value:v?'0 → 9001':'0 → 16'}),
      s(v?'No stable stream':'Predict the next line',v?'Scattered addresses give this simple stream predictor no useful next address.':'The observed stride suggests the next consecutive cache line.',['reg0','l20'],{value:v?'no prediction':'predict index 32'}),
      s(v?'Demand request waits':'Fetch ahead of demand',v?'The next cold load must trigger its own memory request.':'While the core works, a speculative request brings the next line toward its cache.',['dram','l3','l20'],{signal:'data',bytes:64,cycles:v?200:40,miss:!!v,value:v?'demand miss':'prefetch fill'}),
      s('Use the next value',v?'Data arrives after the demand wait.':'The demand load finds the prefetched line closer to the core.',['l20','l10','reg0'],{signal:'data',hit:!v,cycles:12,value:'next operand'})
    ]
  },
  {
    id:'coherence',group:'Working together',title:'Cache coherence',subtitle:'Two copies. One latest value.',tag:'MESI MODEL',
    description:'Cores can hold copies of the same line. Before a core modifies it, coherence grants write ownership and makes other cached copies invalid. The next reader must obtain the current data.',
    takeaway:'Coherence is about a single line’s visibility. It does not make arbitrary multithreaded code race-free or establish all memory ordering.',
    caveat:'A simplified MESI-style sequence is shown. Real protocols can have extra states and directories; cache-to-cache transfer need not pass through L3 or DRAM.',
    code:'std::atomic<int> counter{10};\n// On core 0\ncounter.store(11, std::memory_order_relaxed);\n// On core 1\nint x = counter.load(std::memory_order_relaxed);\n// This illustrates one line, not thread synchronization.',variants:['Core 0 writes','Core 1 writes'],steps:v=>[
      s('Both cores share the line','Both private caches contain a clean copy of counter = 10.',['l3','l10','l11'],{signal:'data',states:['S · 10','S · 10'],value:'shared / shared'}),
      s('Request write ownership','The writer must gain exclusive permission before modifying the line.',v?['reg1','l11','l3']:['reg0','l10','l3'],{signal:'ownership',cycles:20,value:'ownership request'}),
      s('Invalidate the other copy','Coherence invalidates the other core’s copy before the writer obtains permission.',v?['l3','l10']:['l3','l11'],{signal:'invalidate',states:v?['I','M · 11']:['M · 11','I'],cycles:20,value:'counter = 11'}),
      s('The next reader gets current data','The invalid copy cannot satisfy a load. The owner supplies the modified line through the coherence fabric.',v?['l11','l3','l10','reg0']:['l10','l3','l11','reg1'],{signal:'data',bytes:64,states:['S · 11','S · 11'],cycles:40,value:'reader sees 11'})
    ]
  },
  {
    id:'false-sharing',group:'Working together',title:'False sharing',subtitle:'Different counters. The same cache line.',tag:'LINE PING-PONG',
    description:'Two threads update independent counters. If their counters share a line, each write competes for ownership of the entire line. Separate aligned lines let the threads keep private ownership.',
    takeaway:'Independent variables can still contend. Layout and alignment determine whether they share a coherence unit.',
    caveat:'Padding here assumes a 64-byte coherence line. Check the target platform. Atomic counters avoid language-level data races; ownership traffic still has a cost.',
    code:'struct Packed {\n  std::atomic<int> a{0}, b{0};\n};\nstruct alignas(64) Counter {\n  std::atomic<int> value{0};\n};\nstruct Separated { Counter a, b; };',variants:['Same line','Separate lines'],steps:v=>[
      s('Core 0 writes counter a','Core 0 gains permission and updates a.',['reg0','l10'],{signal:'ownership',states:['M · a','I'],cycles:4,cells:[0],value:'a++'}),
      s(v?'Core 1 owns its own line':'Core 1 writes counter b',v?'b occupies a different aligned line. Core 0’s line stays valid.':'b is in the same line. Core 1 invalidates core 0’s copy and takes ownership.',v?['reg1','l11']:['l10','l3','l11'],{signal:'ownership',bytes:v?0:64,states:v?['M · a','M · b']:['I','M · a,b'],cycles:v?4:60,cells:[1],value:v?'no contention':'line transfer'}),
      s('Core 0 writes again',v?'Core 0 keeps its line and can update locally.':'Ownership returns to core 0, even though it only touches a.',v?['reg0','l10']:['l11','l3','l10'],{signal:'ownership',bytes:v?0:64,states:v?['M · a','M · b']:['M · a,b','I'],cycles:v?4:60,cells:[0],value:v?'local update':'ping'}),
      s('Core 1 writes again',v?'Both cores make independent progress.':'The line moves back again. This is false sharing: shared line, independent variables.',v?['reg1','l11']:['l10','l3','l11'],{signal:'ownership',bytes:v?0:64,states:v?['M · a','M · b']:['I','M · a,b'],cycles:v?4:60,cells:[1],value:v?'local update':'pong'})
    ]
  },
  {
    id:'writeback',group:'Working together',title:'Stores & write-back',subtitle:'A changed value does not have to visit DRAM immediately.',tag:'DIRTY LINES',
    description:'In a write-back cache, a store updates a locally owned cache line and marks it dirty. The modified line can be written to the next level when it is evicted.',
    takeaway:'The latest value can live in a cache. Coherence can locate it even while DRAM holds an older copy.',
    caveat:'This assumes cacheable write-back memory and write allocation. Store buffers, fences, write-through policies, and persistence require additional reasoning.',
    code:'arr[100] = 99;\n// A write-back cache can retain the dirty line.\n// Eviction writes modified data to the next level.\n// Reaching DRAM can happen later.',variants:['Retain in cache','Evict the line'],steps:v=>[
      s('Obtain ownership','Core 0 asks for write permission; any conflicting cached copy is invalidated.',['reg0','l10','l3','l11'],{signal:'invalidate',states:['M','I'],cycles:40,value:'exclusive writer'}),
      s('Update the cached value','The store changes the local copy. The line is dirty relative to lower levels.',['reg0','l10'],{signal:'data',bytes:4,states:['M · 99','I'],cells:[4],value:'cache = 99'}),
      v?s('Evict a dirty line','Space is needed. The modified line is written to the next level, and later can reach memory.',['l10','l20','l3','dram'],{signal:'data',bytes:64,cycles:200,states:['I','I'],value:'write-back'}) : s('Use the latest cached copy','A subsequent local read finds the updated value without waiting for a DRAM write.',['l10','reg0'],{signal:'data',hit:true,cycles:4,value:'read 99'})
    ]
  },
  {
    id:'linked-list',group:'Beyond the basics',title:'Arrays vs. linked lists',subtitle:'Contiguous traversal or a trail of pointers.',tag:'DATA LAYOUT',
    description:'An array places neighbors next to each other. A scattered linked list must load a node before discovering the address of the next one, adding a dependent chain of memory requests.',
    takeaway:'Locality and predictable addresses can matter more than the asymptotic complexity of a traversal.',
    caveat:'Linked-list nodes can be allocated contiguously, and arrays can have poor access patterns. This example specifically compares a contiguous array with scattered cold nodes.',
    code:'// Contiguous\nfor (int x : values) sum += x;\n\n// Potentially scattered; each next address depends\n// on completing the previous node load.\nfor (Node* p = head; p; p = p->next)\n  sum += p->value;',variants:['Contiguous array','Scattered list'],steps:v=>Array.from({length:4},(_,i)=>s(v?`Chase pointer ${i+1}`:`Read element ${i}`,v?'Load a scattered node, then discover its next pointer. This dependency limits overlap between successive loads.':i?'The next element is in the already fetched cache line.':'One line brings in several adjacent elements.',v||!i?['dram','l3','l20','l10','reg0']:['l10','reg0'],{signal:'data',bytes:v||!i?64:0,cycles:v||!i?200:4,hit:!v&&i>0,miss:!!v||i===0,cells:[v?0:i],value:v?`node ${i+1} → next`:`arr[${i}]`}))
  },
  {
    id:'branch',group:'Beyond the basics',title:'Branch prediction',subtitle:'Work ahead, then recover when the guess is wrong.',tag:'SPECULATION',
    description:'To keep its pipeline busy, a core predicts which way a branch will go. A wrong prediction discards younger speculative work and redirects instruction fetching.',
    takeaway:'Unpredictable control flow can waste completed speculative work and delay useful instructions.',
    caveat:'The predictor and penalty are illustrative. Real predictors use complex history; speculative effects and out-of-order execution are more detailed than this sequence.',
    code:'for (int value : data) {\n  if (value > threshold)\n    sum += value;\n}\n// Regular outcomes can be easier to predict\n// than irregular outcomes.',variants:['Correct prediction','Misprediction'],steps:v=>[
      s('Predict the direction','Before the condition resolves, the predictor chooses a likely path.',['l10','reg0'],{cycles:1,value:'predict taken'}),
      s('Execute speculatively','Younger instructions begin work on the predicted path.',['reg0','alu'],{signal:'compute',cycles:2,value:'work in flight'}),
      s(v?'The prediction was wrong':'The prediction was correct',v?'Discard younger results; they must not retire as architectural state.':'The condition confirms the path. Useful work continues.',v?['alu','reg0','l10']:['alu','reg0'],{signal:v?'invalidate':'compute',cycles:v?15:1,value:v?'flush + redirect':'retire results'}),
      s('Fetch the correct path','Instruction fetching continues at the resolved address.',['l10','reg0'],{cycles:1,value:'continue'})
    ]
  },
  {
    id:'simd',group:'Beyond the basics',title:'SIMD & vector lanes',subtitle:'One instruction, several data elements.',tag:'DATA PARALLELISM',
    description:'SIMD instructions perform an operation on multiple elements in a vector register. A compiler can sometimes transform a suitable loop to use these instructions.',
    takeaway:'Contiguous, independent operations often make vectorization easier. Memory bandwidth can still limit the speedup.',
    caveat:'Four 32-bit lanes are shown. Actual vector width, instruction throughput, support, and compiler decisions depend on the target. A four-lane operation does not guarantee 4× overall speed.',
    code:'for (size_t i = 0; i < n; ++i)\n  out[i] = a[i] + b[i];\n\n// Conceptual 128-bit SIMD\n// [a0 a1 a2 a3] + [b0 b1 b2 b3]\n//        → [c0 c1 c2 c3]',variants:['Four vector lanes','Scalar operation'],steps:v=>[
      s('Load the operands',v?'One pair of scalar operands enters registers.':'Two vectors of four 32-bit elements enter vector registers.',['l10','reg0'],{signal:'data',bytes:v?8:32,cells:v?[0]:[0,1,2,3],value:v?'1 pair':'4 pairs'}),
      s(v?'Add one pair':'Add across four lanes',v?'A scalar operation produces one result.':'One vector instruction applies addition to all four lanes.',['reg0','alu'],{signal:'compute',cycles:1,value:v?'a0 + b0':'[a0+b0 … a3+b3]'}),
      s('Store the results','Results move from registers into the output cache line.',['alu','reg0','l10'],{signal:'data',bytes:v?4:16,cells:v?[0]:[0,1,2,3],value:v?'1 result':'4 results'})
    ]
  },
  {
    id:'virtual',group:'Beyond the basics',title:'Virtual memory & the TLB',subtitle:'The address your program sees is not the whole story.',tag:'ADDRESS TRANSLATION',
    description:'Programs normally use virtual addresses. A translation lookaside buffer caches mappings to physical pages. A TLB miss can require a hardware page-table walk before the load completes.',
    takeaway:'An address translation miss and a data cache miss are separate events. A TLB miss does not necessarily mean a page fault.',
    caveat:'This shows a generic translation sequence. Translation and L1 lookup may overlap; walk levels and page sizes vary. All pages in this example are present in RAM.',
    code:'Virtual address = virtual page + offset\nTLB lookup → cached translation?\n  hit  → physical page + same offset\n  miss → walk page tables → cache mapping\nThen satisfy the data load.',variants:['TLB hit','TLB miss'],steps:v=>[
      s('Look up the virtual page','The core checks whether the TLB holds the translation.',['reg0','tlb'],{cycles:1,value:'virtual page 0x12'}),
      v?s('Walk the page tables','The mapping is absent. Page-table entries in the memory hierarchy supply the physical page number.',['tlb','l3','dram','tlb'],{signal:'data',cycles:100,value:'present page → no fault'}) : s('Reuse the cached mapping','The cached mapping supplies the physical page number.',['tlb'],{hit:true,cycles:1,value:'TLB hit'}),
      s('Access the data','The physical address identifies the cache line. This example’s data is in L1.',['tlb','l10','reg0'],{signal:'data',hit:true,cycles:4,value:'physical address + offset'})
    ]
  },
  {
    id:'numa',group:'Beyond the basics',title:'NUMA & memory placement',subtitle:'Not all main memory is equally close.',tag:'MULTI-SOCKET',
    description:'On a NUMA machine, cores and memory are grouped into nodes. Local memory is attached to the requesting node; remote memory is reached through an inter-node link.',
    takeaway:'Thread placement and memory placement belong together. Keeping a working set local can reduce remote traffic.',
    caveat:'The board uses two conceptual NUMA nodes. Latencies and interconnect topology vary. Allocation policies and first-touch behavior are OS-dependent.',
    code:'// On Linux, compare local and remote placement:\nnumactl --cpunodebind=0 --membind=0 ./benchmark\nnumactl --cpunodebind=0 --membind=1 ./benchmark\n// Use a working set larger than last-level cache.',variants:['Local memory','Remote memory'],steps:v=>[
      s('Core 0 misses its caches','The data is not in this node’s cache hierarchy.',['reg0','l10','l20','l3'],{miss:true,cycles:40,value:'node 0 request'}),
      s(v?'Cross the node interconnect':'Use the local controller',v?'The physical page belongs to node 1; the request must cross the node interconnect.':'The physical page belongs to node 0 and is served by its local controller.',v?['l3','remote']:['l3','dram'],{cycles:v?300:200,value:v?'remote DRAM':'local DRAM'}),
      s('Return the line','The cache line returns to the requesting core, where subsequent reads can reuse it.',v?['remote','l3','l20','l10','reg0']:['dram','l3','l20','l10','reg0'],{signal:'data',bytes:64,cells:[0],value:'64 B → node 0'})
    ]
  }
];
export const architectures: Record<Architecture, {name:string; short:string; note:string}> = {
  x86:{name:'x86-64 · multicore',short:'X86-64',note:'Generic multicore model: private L1/L2 caches, a shared L3, and 64-byte lines. Specific x86 processors differ.'},
  arm:{name:'Arm64 · multicore',short:'ARM64',note:'Generic Arm application-processor model. Cluster cache sharing, line size, and coherence protocol depend on the implementation; this example keeps 64-byte lines.'},
  numa:{name:'NUMA · dual node',short:'NUMA',note:'Two conceptual memory nodes connected by an inter-node link. Each node can have many cores; node 1 is collapsed into a package in this view.'}
};
