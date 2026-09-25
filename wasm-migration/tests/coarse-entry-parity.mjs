import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as node from '../bridge/assembly-core.mjs';
import * as browser from '../bridge/sudoku-wasm-adapter.js';
import { loadOracle } from './load-oracle.mjs';
import { loadBenchmarkCorpus } from './benchmark-corpus.mjs';
const bytes = new Uint8Array(await readFile(new URL('../build/sudoku-techniques.wasm', import.meta.url)));
const oracle = await loadOracle();
const entry = (await loadBenchmarkCorpus()).find(x => x.id === 22);
const adapters = [node, browser];
const cores = await Promise.all(adapters.map(a => a.instantiateCore(bytes)));
const clone = x => JSON.parse(JSON.stringify(x));
for (const solved of [false, true]) {
  const grid = clone(solved ? entry.solution : entry.puzzle);
  const masks = Array.from(oracle.candidateMasksForGrid(grid), Number);
  const before = clone({grid, masks});
  adapters.forEach((a,i) => { a.loadPosition(cores[i], grid, masks); a.loadGivenGrid(cores[i], entry.puzzle); });
  const options = {budgetLimit:6790, validator: f => !!oracle.validateFindingAgainstSolution(f, entry.solution)};
  const expected = clone(oracle.enumerateAvailableFromMasks(grid,masks,entry.puzzle,entry.solution));
  assert.equal(expected.length > 1, !solved);
  for (let repeat=0; repeat<3; repeat++) {
    const all = adapters.map((a,i) => a.findAllAvailableStepsWasm(cores[i],options));
    for (const result of all) assert.deepEqual(result,expected);
    const saved = clone(all);
    adapters.forEach((a,i) => {
      assert.deepEqual(a.findNextStepWasm(cores[i],options),expected[0] ?? null);
      let rejected = false;
      const next = a.findNextStepWasm(cores[i],{...options,validator:f => {
        if (!options.validator(f)) return false;
        if (!rejected) { rejected=true; return false; }
        return true;
      }});
      assert.deepEqual(next,expected[1] ?? null);
      for (let k=0;k<81;k++) {
        assert.equal(cores[i].getInputCell(k),grid[Math.floor(k/9)][k%9]);
        assert.equal(cores[i].getInputMask(k),masks[k]);
      }
    });
    assert.deepEqual(all,saved,'previous Findings survive interleaved searches');
    assert.deepEqual({grid,masks},before);
  }
  console.log(JSON.stringify({case:22,solved,budget:6790,findings:expected.length,repetitions:3,status:'PASS'}));
}
