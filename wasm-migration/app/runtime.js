// Embedded inside the original solver script, so its Blob Worker gets the same
// engine and immutable-givens contract without external requests or async races.
const WASM_RUNTIME = (() => {
  /* ADAPTER */
  const base64 = /* WASM_BASE64 */;
  let core = null;
  let attempted = false;
  const stats = { backend: 'uninitialized', searches: 0, detailSearches: 0 };
  function getCore() {
    if (attempted) return core;
    attempted = true;
    try {
      if (typeof WebAssembly === 'undefined') throw new Error('WebAssembly unavailable');
      const bytes = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0));
      core = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { abort: makeAbort() } }).exports;
      stats.backend = 'wasm';
    } catch (error) {
      stats.backend = 'javascript';
      console.warn('[Sudoku] WASM initialization unavailable; using the original JavaScript solver.', error);
    }
    return core;
  }
  function load(grid, getCands, givenGrid) {
    const engine = getCore();
    if (!engine) return null;
    const masks = Array.from({ length: 81 }, (_, index) => {
      const r = Math.floor(index / 9), c = index % 9;
      return grid[r][c] ? 0 : candMaskAt(getCands, r, c);
    });
    loadPosition(engine, grid, masks, givenGrid ?? null);
    return engine;
  }
  return {
    stats,
    next(grid, getCands, order, givenGrid, validator) {
      // Detailed chain derivations are UI data not present in the WASM ABI.
      // Preserve the original complete path when that user option is enabled.
      if (state.settings.showChainDetail) { stats.detailSearches++; return undefined; }
      const engine = load(grid, getCands, givenGrid);
      if (!engine) return undefined;
      stats.searches++;
      if (!order || order === TECHNIQUE_CHAIN) return findNextStepWasm(engine, { validator });
      for (const entry of order) {
        const id = TECHNIQUE_CHAIN.indexOf(entry);
        if (id < 0) throw new Error('Unknown Sudoku technique order entry');
        const finding = runTechniqueById(engine, id, 6790);
        if (finding && (!validator || validator(finding))) return finding;
      }
      return null;
    },
    all(grid, getCands, givenGrid, validator) {
      const engine = load(grid, getCands, givenGrid);
      if (!engine) return undefined;
      stats.searches++;
      return findAllAvailableStepsWasm(engine, { validator });
    },
  };
})();
