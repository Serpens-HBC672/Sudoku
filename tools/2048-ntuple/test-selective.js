#!/usr/bin/env node
'use strict';

// Small deterministic correctness suite for selective third-ply search.
// No training, downloads, or games. Real-weight mode: --model 8x6patt.json.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {NTupleModel, NTupleSolver, loadModel} = require('./ntuple2048.js');
const game = require('../2048-expectimax/expectimax2048.js');
const ref = require('./reference-ntuple.js');
const PATTERNS = ['012456', '456789', '012345', '234569', '01259a', '345678', '134567', '01489a'];
const LATE = [8192, 4096, 2048, 1024, 64, 128, 256, 512, 32, 16, 8, 4, 2, 4, 2, 0];
const FULL = [...LATE.slice(0, 15), 2];
const TWO_EMPTY = LATE.map((tile, index) => index === 14 ? 0 : tile);
const LOW_TILE = LATE.map(tile => tile === 8192 ? 4096 : tile);
const GOAL_LEAF = [16384, 8192, 8192, 1024, 64, 128, 256, 512, 32, 16, 8, 4, 2, 4, 2, 0];
const EARLY = [2, 2, 0, 0, ...Array(12).fill(0)];
const DEAD = [8192, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2];
const CASES = [LATE, FULL, TWO_EMPTY, LOW_TILE, GOAL_LEAF, EARLY, DEAD];
let checks = 0;
const startedAt = new Date().toISOString();
const startTime = performance.now();
function test(name, action) { action(); console.log(`ok ${++checks} - ${name}`); }
function close(actual, expected, label) {
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected), label + ': finite values');
  assert.ok(Math.abs(actual - expected) <= Math.max(1e-8, Math.abs(expected) * 5e-12), `${label}: got ${actual}, expected ${expected}`);
}
function chosenPly(board, options) {
  const ply = options.ply === undefined ? 2 : options.ply;
  const emptyLimit = options.criticalEmpty === undefined ? 1 : options.criticalEmpty;
  const tileLimit = options.criticalTile === undefined ? 8192 : options.criticalTile;
  let empty = 0, maximum = 0;
  for (const tile of board) { if (tile === 0) empty++; if (tile > maximum) maximum = tile; }
  return options.criticalSearch === true && empty <= emptyLimit && maximum >= tileLimit ? 3 : ply;
}
function checkDecision(model, board, options, label) {
  const original = board.slice();
  const actualPly = chosenPly(board, options);
  const expected = ref.chooseMove(board, model.tables, actualPly, model.patterns);
  const actual = new NTupleSolver(model, options).chooseMove(board);
  assert.deepEqual(board, original, label + ': input mutation');
  assert.equal(actual.actualPly, actualPly, label + ': depth trigger');
  assert.equal(actual.ply, options.ply === undefined ? 2 : options.ply, label + ': base depth metadata');
  assert.equal(actual.complete, true);
  assert.equal(actual.targetReached, false);
  assert.ok(Number.isInteger(actual.nodes) && actual.nodes >= 0);
  if (expected.direction === null) {
    assert.equal(actual.direction, null);
    assert.equal(actual.value, 0);
    return actual;
  }
  assert.ok(Number.isInteger(actual.direction) && actual.direction >= 0 && actual.direction <= 3);
  assert.notEqual(expected.values[actual.direction], null, label + ': legal action');
  close(actual.value, expected.values[actual.direction], label + ': reported action value');
  close(expected.values[actual.direction], expected.value, label + ': best action value');
  const sorted = expected.values.filter(value => value !== null).sort((a, b) => b - a);
  if (sorted.length === 1 || sorted[0] - sorted[1] > Math.max(1e-8, Math.abs(sorted[0]) * 5e-12)) assert.equal(actual.direction, expected.direction);
  return actual;
}

// Enumerate reference leaf boards without using production move/search helpers.
// Multiplicities matter: a goal afterstate must be evaluated at its arrival,
// never after an additional tile spawn or a possible rank-16 merge.
function leafTrace(board, ply, target = 32768) {
  const leaves = new Map();
  function afterstate(after, remaining) {
    if (remaining === 0 || after.some(tile => tile >= target)) {
      const key = after.join(',');
      leaves.set(key, (leaves.get(key) || 0) + 1);
      return;
    }
    for (let cell = 0; cell < 16; cell++) {
      if (after[cell] !== 0) continue;
      for (const tile of [2, 4]) {
        const spawned = after.slice(); spawned[cell] = tile;
        for (let direction = 0; direction < 4; direction++) {
          const next = ref.move(spawned, direction);
          if (next.moved) afterstate(next.board, remaining - 1);
        }
      }
    }
  }
  for (let direction = 0; direction < 4; direction++) {
    const after = ref.move(board, direction);
    if (after.moved) afterstate(after.board, ply - 1);
  }
  return leaves;
}
function traceGoalLeaves(model) {
  const expected = leafTrace(GOAL_LEAF, 3);
  const actual = new Map();
  const original = model.evaluatePacked;
  model.evaluatePacked = function(lo, hi) {
    const board = game._internals.unpack(lo, hi);
    const key = board.join(',');
    actual.set(key, (actual.get(key) || 0) + 1);
    return original.call(this, lo, hi);
  };
  let result;
  try { result = new NTupleSolver(model, {ply: 2, criticalSearch: true}).chooseMove(GOAL_LEAF); }
  finally { model.evaluatePacked = original; }
  assert.equal(result.actualPly, 3);
  const entries = map => Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  assert.deepEqual(entries(actual), entries(expected), 'evaluated leaf multiset must stop exactly at target');
  const goalLeaves = Array.from(actual.entries()).filter(([key]) => key.split(',').map(Number).some(tile => tile === 32768));
  assert.ok(goalLeaves.length > 0, 'fixture must actually reach the goal inside search');
  for (const key of actual.keys()) assert.ok(key.split(',').map(Number).every(tile => tile <= 32768), 'no rank-16 leaf');
  return {distinctLeaves: actual.size, leafEvaluations: Array.from(actual.values()).reduce((sum, count) => sum + count, 0), distinctGoalLeaves: goalLeaves.length};
}

function runChecks(model, label) {
  test(label + ': disabled selective mode preserves base 1-/2-ply choices and values', () => {
    for (const ply of [1, 2]) for (const board of CASES) {
      const baseline = new NTupleSolver(model, {ply}).chooseMove(board);
      const disabled = checkDecision(model, board, {ply, criticalSearch: false}, label + ' disabled');
      assert.equal(disabled.direction, baseline.direction);
      assert.equal(disabled.value, baseline.value);
      assert.equal(disabled.actualPly, ply);
    }
  });
  test(label + ': default trigger uses BEFORESTATE empty-count and tile boundaries', () => {
    const cases = [[LATE, 3], [FULL, 3], [TWO_EMPTY, 2], [LOW_TILE, 2], [EARLY, 2], [DEAD, 3]];
    for (const [board, expectedPly] of cases) {
      const actual = checkDecision(model, board, {ply: 2, criticalSearch: true}, label + ' default trigger');
      assert.equal(actual.actualPly, expectedPly);
    }
  });
  test(label + ': explicit thresholds and base-ply-one fallback respect boundaries', () => {
    const options = [
      [LATE, {ply: 1, criticalSearch: true}, 3],
      [EARLY, {ply: 1, criticalSearch: true}, 1],
      [LATE, {ply: 2, criticalSearch: true, criticalEmpty: 0}, 2],
      [FULL, {ply: 2, criticalSearch: true, criticalEmpty: 0}, 3],
      [TWO_EMPTY, {ply: 2, criticalSearch: true, criticalEmpty: 2}, 3],
      [LATE, {ply: 2, criticalSearch: true, criticalTile: 16384}, 2],
      [LOW_TILE, {ply: 2, criticalSearch: true, criticalTile: 4096}, 3]
    ];
    for (const [board, configuration, expectedPly] of options) {
      const actual = checkDecision(model, board, configuration, label + ' explicit threshold');
      assert.equal(actual.actualPly, expectedPly);
    }
  });
  test(label + ': late-game third-ply decisions and Q values match independent recursion', () => {
    for (const board of [LATE, FULL, GOAL_LEAF, ref.reflectLeftRight(LATE), ref.rotate(FULL, 1)]) {
      checkDecision(model, board, {ply: 2, criticalSearch: true}, label + ' three-ply reference');
    }
  });
  let trace;
  test(label + ': goal leaves stop exactly before any additional spawn or merge', () => { trace = traceGoalLeaves(model); });
  test(label + ': existing and immediate root goals retain terminal behavior', () => {
    const solver = new NTupleSolver(model, {ply: 2, criticalSearch: true});
    const existing = solver.chooseMove([32768, ...Array(15).fill(0)]);
    assert.equal(existing.targetReached, true);
    assert.equal(existing.direction, null);
    assert.equal(existing.nodes, 0);
    const immediate = solver.chooseMove([16384, 16384, ...Array(14).fill(0)]);
    assert.equal(immediate.direction, 1);
    assert.equal(immediate.nodes, 0);
    assert.equal(immediate.value, 1000000000);
  });
  return {label, trace,
    late: new NTupleSolver(model, {ply: 2, criticalSearch: true}).chooseMove(LATE),
    goalLeaf: new NTupleSolver(model, {ply: 2, criticalSearch: true}).chooseMove(GOAL_LEAF)};
}

function syntheticModel() {
  const tables = Array.from({length: 8}, () => new Float32Array(16 ** 6));
  const model = new NTupleModel(tables, PATTERNS);
  const leaves = new Set();
  for (const board of CASES) {
    // Only sparse-empty late boards are expanded to third ply.
    const ply = board.filter(tile => tile === 0).length <= 2 && Math.max(...board) >= 4096 ? 3 : 2;
    for (const key of leafTrace(board, ply).keys()) leaves.add(key);
    for (const key of leafTrace(board, 1).keys()) leaves.add(key);
    for (const key of leafTrace(board, 2).keys()) leaves.add(key);
  }
  for (const key of leaves) {
    const indices = ref.indices(key.split(',').map(Number), PATTERNS);
    for (let table = 0; table < 8; table++) for (const index of indices[table]) {
      const hash = (Math.imul(index ^ (index >>> 13), 0x45d9f3b) ^ Math.imul(table + 1, 0x9e3779b1)) >>> 0;
      tables[table][index] = Math.fround((hash % 400001) - 200000 + table / 16);
    }
  }
  return model;
}
let manifestPath = null;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--model') {
    manifestPath = process.argv[++i];
    if (!manifestPath || manifestPath.startsWith('--')) throw new Error('--model requires a manifest path');
  } else if (process.argv[i] === '--help') { console.log('node test-selective.js [--model /path/8x6patt.json]'); process.exit(0); }
  else throw new Error('Unknown argument: ' + process.argv[i]);
}
const synthetic = syntheticModel();
test('selective configuration rejects unsafe or malformed options', () => {
  for (const criticalSearch of [1, 'true', null]) assert.throws(() => new NTupleSolver(synthetic, {criticalSearch}));
  for (const criticalEmpty of [-1, 1.5, 5, Infinity]) assert.throws(() => new NTupleSolver(synthetic, {criticalEmpty}));
  for (const criticalTile of [0, 3, 65536, NaN]) assert.throws(() => new NTupleSolver(synthetic, {criticalTile}));
});
const summaries = [runChecks(synthetic, 'synthetic')];
if (manifestPath) {
  const model = loadModel(path.resolve(manifestPath));
  assert.deepEqual(Array.from(model.patterns), PATTERNS, 'expected verified 8x6 model');
  summaries.push(runChecks(model, 'pretrained 8x6'));
} else console.log('# Actual-model checks skipped; use --model 8x6patt.json.');
const hashes = {};
for (const filename of ['ntuple2048.js', 'reference-ntuple.js', 'test-selective.js']) hashes[filename] = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, filename))).digest('hex');
console.log(JSON.stringify({ok: true, tests: checks, startedAt, finishedAt: new Date().toISOString(), elapsedMs: performance.now() - startTime, actualModelChecked: Boolean(manifestPath), hashes, summaries}));
