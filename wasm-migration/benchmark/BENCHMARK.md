# Local measured performance

One observed positive state per workload, same individual technique JS/WASM, one untimed warmup and three timed repetitions, parity checked outside timers. Not full-solve or coarse-dispatch speedup. Common caller grid/masks are prepared outside BOTH timers. WASM input preparation measures copy and givens. JS includes oracle normalization and solution validation; WASM includes Finding materialization and the same solution validation rule, reported separately.

Node v22.23.1; win32; CPU 13th Gen Intel(R) Core(TM) i7-13700H; incremental runtime; DFC budget 6790. Module initialization 1.962 ms. WASM SHA-256 009d0805c461df9a49b7015b642fc9e8a6dd5f0503a957f4606639b39ccf6a1a.

One untimed warmup and three timed repetitions per actual positive state. Exact ordered Finding parity is required before timing acceptance. Timed runs were performed after local regression work completed. Raw samples and full input grid/masks: evidence/performance/results.json. These are representative per-technique end-to-end measurements, not whole-application or whole-puzzle speedups.

| Case | Technique | JS ms | Input ms | WASM compute ms | Finding ms | WASM end-to-end ms | Ratio |
|---:|---|---:|---:|---:|---:|---:|---:|
| 57 | nakedSingle | 0.038 | 0.021 | 0.001 | 0.006 | 0.030 | 1.28x |
| 11 | lockedCandidate | 0.053 | 0.020 | 0.002 | 0.017 | 0.040 | 1.32x |
| 22 | dynamicNishioChain | 344.703 | 0.027 | 15.279 | 0.041 | 15.356 | 22.45x |
| 23 | dynamicNishioChain | 2763.702 | 0.025 | 73.999 | 0.061 | 74.100 | 37.30x |
| 24 | dynamicNishioChain | 19.624 | 0.033 | 1.834 | 0.034 | 1.905 | 10.30x |
| 56 | dynamicUnaryChain | 9446.415 | 0.029 | 393.102 | 0.063 | 393.208 | 24.02x |
| 27 | msls | 4392.027 | 0.040 | 696.481 | 0.090 | 696.585 | 6.31x |
| 42 | juniorExocet | 0.768 | 0.020 | 0.040 | 0.030 | 0.093 | 8.25x |

SIMD-enabled and scalar files have identical bytes; no SIMD speedup is claimed. No cross-machine historical timings enter the ratios.
