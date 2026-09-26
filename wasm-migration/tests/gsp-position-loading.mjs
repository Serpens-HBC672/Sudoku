import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import * as node from '../bridge/assembly-core.mjs';
import * as browser from '../bridge/sudoku-wasm-adapter.js';
import { loadOracle } from './load-oracle.mjs';
import { loadBenchmarkCorpus } from './benchmark-corpus.mjs';

const bytes = new Uint8Array(await readFile(new URL('../build/sudoku-techniques.wasm', import.meta.url)));
const oracle = await loadOracle();
const cases = (await loadBenchmarkCorpus()).filter(p => p.id >= 47 && p.id <= 54);
const clone = value => JSON.parse(JSON.stringify(value));
const adapters = [node, browser];
const cores = await Promise.all(adapters.map(a => a.instantiateCore(bytes)));
let steps = 0, gspSteps = 0;
for (const puzzle of cases) {
  const trace = oracle.tracePuzzle(puzzle.puzzle, puzzle.solution);
  assert.equal(trace.complete, true);
  assert.equal(trace.soundnessProblem, null);
  for (const step of trace.trace) {
    const grid = Array.from({length:9}, (_,r) => Array.from({length:9}, (_,c) => Number(step.beforeGrid[r*9+c])));
    const masks = Array.from(step.beforeMasks, Number);
    const expected = clone(step.finding);
    const inputs = clone({grid, masks, givens:puzzle.puzzle});
    for (const [i, a] of adapters.entries()) {
      a.loadPosition(cores[i], grid, masks, puzzle.puzzle);
      if (expected.technique === 'gsp') {
        assert.deepEqual(a.runStandaloneTechniqueFinder(cores[i], 3), expected);
      }
      assert.deepEqual(a.findNextStepWasm(cores[i], {
        validator: f => !!oracle.validateFindingAgainstSolution(f, puzzle.solution),
      }), expected, `case ${puzzle.id}, step ${step.step}, adapter ${i}`);
      assert.deepEqual({grid, masks, givens:puzzle.puzzle}, inputs);
    }
    steps++;
    if (expected.technique === 'gsp') gspSteps++;
  }
}
assert.equal(steps, 570);
assert.equal(gspSteps, 42);

const puzzle = cases[0];
const masks = Array.from(oracle.candidateMasksForGrid(puzzle.puzzle), Number);
const expected = clone(oracle.findTechniqueFromMasks('gsp', puzzle.puzzle, masks, puzzle.puzzle, puzzle.solution));
assert.ok(expected);
for (const [i, a] of adapters.entries()) {
  const core = cores[i];
  a.loadPosition(core, puzzle.puzzle, masks, puzzle.puzzle);
  // Reject malformed givens before disturbing the already loaded position.
  for (const invalid of [[], Array(9).fill(Array(9).fill(true)), Array(9).fill(Array(9).fill(10))]) {
    assert.throws(() => a.loadPosition(core, puzzle.solution, Array(81).fill(0), invalid), /given grid/);
    assert.deepEqual(a.runStandaloneTechniqueFinder(core, 3), expected);
  }
  for (const given of [undefined, null]) {
    a.loadPosition(core, puzzle.puzzle, masks, given);
    assert.equal(a.runStandaloneTechniqueFinder(core, 3), null, 'no stale givens after load');
    a.loadGivenGrid(core, puzzle.puzzle);
    assert.deepEqual(a.runStandaloneTechniqueFinder(core, 3), expected, 'legacy API still works');
  }
  a.loadPosition(core, puzzle.solution, Array(81).fill(0), puzzle.puzzle);
  assert.equal(a.findNextStepWasm(core), null);
  a.loadPosition(core, puzzle.puzzle, masks, puzzle.puzzle);
  assert.deepEqual(a.runStandaloneTechniqueFinder(core, 3), expected);
}

// Execute the production browser Worker handler in a Node Worker shim.
// This checks its message path, not browser rendering or browser startup.
const workerUrl = new URL('../bridge/sudoku-wasm-worker.js', import.meta.url).href;
const worker = new Worker(`
  const {parentPort} = require('node:worker_threads');
  globalThis.self = {postMessage: message => parentPort.postMessage(message)};
  import(${JSON.stringify(workerUrl)}).then(() => {
    parentPort.on('message', data => self.onmessage({data}));
    parentPort.postMessage({ready:true});
  }).catch(error => { throw error; });
`, {eval:true});
let id = 0;
function nextMessage(send) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Worker timeout')), 30000);
    function finish(error, result) {
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('error', onError);
      error ? reject(error) : resolve(result);
    }
    function onMessage(message) { finish(null, message); }
    function onError(error) { finish(error); }
    worker.once('message', onMessage);
    worker.once('error', onError);
    if (send) worker.postMessage(send);
  });
}
async function call(message) {
  const result = await nextMessage({id:++id, ...message});
  assert.equal(result.id, id);
  assert.equal(result.ok, true, result.error);
  return result;
}
try {
  assert.equal((await nextMessage()).ready, true);
  await call({type:'init', wasm:bytes});
  for (const givens of [puzzle.puzzle, undefined, puzzle.puzzle]) {
    await call({type:'loadPosition', grid:puzzle.puzzle, masks, givenGrid:givens, solution:puzzle.solution});
    const direct = await call({type:'standalone', techniqueId:3});
    assert.deepEqual(direct.finding, givens ? expected : null);
    if (givens) assert.deepEqual((await call({type:'findNext', budgetLimit:6790})).finding, expected);
  }
} finally {
  await worker.terminate();
}
console.log(`PASS: ${steps} ordered steps per adapter; ${gspSteps} GSP steps; reload, legacy, invalid-input and production Worker message paths.`);
