# Frozen selective development gate source

Solver SHA-256: ab2e0c4eca2e84061602f9d4b80a45debd9986a35a618f32478cb0ae097261ed.
Benchmark SHA-256: b152ce970df576f53d82d7763b3c37163dc48ce71402bceba8e0a3e8e80c6249.

Copy these files into a separate tools/2048-ntuple/ checkout copy with its sibling game helper to reproduce. The old generic metadata semantics string says two-ply; the explicit criticalSearch options and actualPlyHistogram correctly record the selective third ply. The final benchmark clarifies that wording without changing search logic.
