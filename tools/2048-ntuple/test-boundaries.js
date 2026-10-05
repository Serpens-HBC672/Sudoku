#!/usr/bin/env node
'use strict';

// Bounded synthetic regressions only: no model download, training, or self-play.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const N = require('./ntuple2048.js');
const game = require('../2048-expectimax/expectimax2048.js');
const ref = require('./reference-ntuple.js');
const ENTRIES = 16 ** 6;
const UINT32_MAX = 0xffffffff;
const FROZEN_SHA256 = 'ab2e0c4eca2e84061602f9d4b80a45debd9986a35a618f32478cb0ae097261ed';
// Reuse one sparse backing table, including across the 4x6 and 8x6 fixtures.
const backing = new Float32Array(ENTRIES);
let checks = 0, guardedReads = 0, parityDecisions = 0;
function test(name, action) { action(); console.log(`ok ${++checks} - ${name}`); }
function weight(table, index) { return Math.fround((index % 8191) - 4000 + table / 8); }
function fixture(patterns, API = N) {
  const model = new API.NTupleModel(patterns.map(() => backing), patterns);
  const reads = [];
  // Trap each weight access: out-of-bounds reads must fail, never become undefined
  // or silently use a truncated index. No large pretrained model is needed.
  model.tables = patterns.map((_, table) => new Proxy(backing, {
    get(target, key) {
      if (typeof key === 'string' && /^-?\d+(?:\.\d+)?$/.test(key)) {
        const index = Number(key);
        assert.ok(Number.isInteger(index) && index >= 0 && index < ENTRIES, `out-of-bounds table ${table} index ${key}`);
        guardedReads++;
        reads.push([table, index]);
        return weight(table, index);
      }
      return Reflect.get(target, key, target);
    }
  }));
  return {model, reads};
}
function independentBoard(lo, hi) {
  return Array.from({length: 16}, (_, i) => {
    const rank = Math.floor((i < 8 ? lo : hi) / 16 ** (i % 8)) % 16;
    return rank === 0 ? 0 : 2 ** rank;
  });
}
function expectedReads(board, patterns) {
  return ref.indices(board, patterns).flatMap((indices, table) => indices.map(index => [table, index]));
}
function sortedReads(reads) { return reads.map(pair => pair.join(':')).sort(); }
function assertEvaluation(model, reads, board, evaluate) {
  const expected = expectedReads(board, model.patterns);
  reads.length = 0;
  assert.equal(evaluate(), expected.reduce((sum, [table, index]) => sum + weight(table, index), 0));
  assert.deepEqual(sortedReads(reads), sortedReads(expected), 'every accessed table and index must match independent extraction');
}
function outcome(result) {
  const {elapsedMs, ...deterministic} = result;
  assert.ok(Number.isFinite(elapsedMs) && elapsedMs >= 0);
  return deterministic;
}

const frozenPath = path.join(__dirname, 'results/development-selective-v3-source/ntuple2048.js');
const frozenSource = fs.readFileSync(frozenPath, 'utf8');
assert.equal(crypto.createHash('sha256').update(frozenSource).digest('hex'), FROZEN_SHA256, 'baseline must remain the original frozen solver');
const baselineContext = {module: {exports: {}}, require, Float32Array, Uint8Array, Float64Array, performance};
vm.runInNewContext(frozenSource, baselineContext, {filename: frozenPath});
const baseline = baselineContext.module.exports;

for (const network of ['4x6', '8x6']) {
  const patterns = N.MODEL_CATALOG[network].patterns;
  const {model, reads} = fixture(patterns);
  test(`${network}: rank 15 reaches exactly the last table entry, without truncation`, () => {
    const board = Array(16).fill(32768);
    const indices = N.tupleIndices(board, patterns);
    assert.equal(indices.length, patterns.length * 8);
    assert.ok(indices.every(index => index === ENTRIES - 1));
    assertEvaluation(model, reads, board, () => model.evaluate(board));
    assertEvaluation(model, reads, board, () => model.evaluatePacked(UINT32_MAX, UINT32_MAX));
    assert.ok(reads.every(([, index]) => index === ENTRIES - 1));
    const mixed = Array.from({length: 16}, (_, rank) => rank ? 2 ** rank : 0);
    assertEvaluation(model, reads, mixed, () => model.evaluate(new Uint32Array(mixed)));
  });
  test(`${network}: valid uint32 endpoints and high-bit words preserve all nibbles`, () => {
    for (const [lo, hi] of [[0, 0], [UINT32_MAX, UINT32_MAX], [UINT32_MAX, 0], [0, UINT32_MAX],
      [0x80000000, 0x80000000], [0xf0000000, 0xf0000000], [0xfedcba98, 0x76543210]]) {
      const board = independentBoard(lo, hi);
      assert.deepEqual(game._internals.pack(board), [lo, hi]);
      assertEvaluation(model, reads, board, () => model.evaluatePacked(lo, hi));
      assertEvaluation(model, reads, board, () => model.evaluatePacked((lo | 0) >>> 0, (hi | 0) >>> 0));
    }
  });
  test(`${network}: invalid packed words are rejected before any table read`, () => {
    const invalid = [-1, -0x80000000, -(2 ** 32), 0.5, -0.5, NaN, Infinity, -Infinity,
      2 ** 32, 2 ** 32 + 1, Number.MAX_SAFE_INTEGER, undefined, null, '0', '4294967295', true, 0n, {}, Symbol('word')];
    for (const word of invalid) for (const side of [0, 1]) {
      reads.length = 0;
      const args = side === 0 ? [word, 0] : [0, word];
      assert.throws(() => model.evaluatePacked(...args), {name: 'RangeError', message: new RegExp(`^${side === 0 ? 'lo' : 'hi'} must be an unsigned 32-bit integer`)});
      assert.equal(reads.length, 0, 'invalid input must not query weights');
    }
    assert.throws(() => model.evaluatePacked(0), /hi must be/);
  });
  test(`${network}: numeric evaluation rejects rank 16+ while chooseMove reports terminal`, () => {
    const solver = new N.NTupleSolver(model, {ply: 2, criticalSearch: true});
    for (const tile of [32768, 65536, 131072, 2 ** 52]) {
      const board = [tile, ...Array(15).fill(0)];
      const original = board.slice();
      reads.length = 0;
      if (tile > 32768) {
        assert.throws(() => model.evaluate(board), /supports tiles through 32768/);
        assert.throws(() => N.tupleIndices(board, patterns), /supports tiles through 32768/);
        assert.equal(reads.length, 0);
      }
      const result = solver.chooseMove(board);
      assert.equal(result.direction, null);
      assert.equal(result.targetReached, true);
      assert.equal(result.nodes, 0);
      assert.equal(result.value, 1000000000);
      assert.equal(reads.length, 0, 'terminal root must not evaluate or truncate a large tile');
      assert.deepEqual(board, original);
    }
    for (const target of [65536, 131072, 2 ** 52]) assert.throws(() => new N.NTupleSolver(model, {target}), /target must be/);
    // Shape/tile validation still happens before the early target stop.
    assert.throws(() => solver.chooseMove([65536, 3, ...Array(14).fill(0)]), /Tiles must/);
  });
  test(`${network}: two 16384 tiles reach the goal without further weight queries`, () => {
    const board = [16384, 16384, ...Array(14).fill(0)];
    for (const options of [{ply: 1}, {ply: 2}, {ply: 2, criticalSearch: true}]) {
      reads.length = 0;
      const result = new N.NTupleSolver(model, options).chooseMove(board);
      assert.equal(result.direction, 1);
      assert.equal(result.targetReached, false, 'the input is not yet a goal');
      assert.equal(result.nodes, 0);
      assert.equal(result.value, 1000000000);
      assert.equal(reads.length, 0);
      assert.equal(Math.max(...game.move(board, result.direction).board), 32768);
    }
  });
  test(`${network}: trusted search leaves skip the external packed validator`, () => {
    let integerChecks = 0;
    const numberSpy = new Proxy(Number, {get(target, key) {
      if (key === 'isInteger') return value => { integerChecks++; return Number.isInteger(value); };
      return Reflect.get(target, key);
    }});
    const context = {module: {exports: {}}, require, Number: numberSpy, Float32Array, Uint8Array, Float64Array, performance};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'ntuple2048.js'), 'utf8'), context);
    const API = context.module.exports, observed = fixture(patterns, API);
    const solver = new API.NTupleSolver(observed.model, {ply: 2, criticalSearch: true});
    const board = [8192, 4096, 2048, 1024, 64, 128, 256, 512, 32, 16, 8, 4, 2, 4, 2, 0];
    integerChecks = 0;
    assert.ok(solver.chooseMove(board).complete);
    assert.ok(observed.reads.length > 0, 'the trusted path must actually evaluate weights');
    assert.equal(integerChecks, board.filter(Boolean).length, 'only numeric root tiles need integer checks; packed leaves need none');
    integerChecks = 0;
    observed.model.evaluate(board);
    assert.equal(integerChecks, 0, 'Game.pack already validated numeric evaluation input');
    observed.model.evaluatePacked(UINT32_MAX, UINT32_MAX);
    assert.equal(integerChecks, 2, 'the public packed boundary checks both words');
  });
  test(`${network}: existing evaluator wrappers still observe numeric and search leaves`, () => {
    const original = model.evaluatePacked;
    let calls = 0;
    model.evaluatePacked = function(lo, hi) { calls++; return original.call(this, lo, hi); };
    try {
      assertEvaluation(model, reads, Array(16).fill(32768), () => model.evaluate(Array(16).fill(32768)));
      assert.equal(calls, 1);
      reads.length = 0;
      const board = [8192, 4096, 2048, 1024, 64, 128, 256, 512, 32, 16, 8, 4, 2, 4, 2, 0];
      assert.ok(new N.NTupleSolver(model, {ply: 2, criticalSearch: true}).chooseMove(board).complete);
      assert.ok(calls > 1, 'caller-supplied leaf wrappers remain in use');
      assert.equal(reads.length, (calls - 1) * patterns.length * 8);
    } finally { model.evaluatePacked = original; }
  });
  test(`${network}: valid-board decisions and exact values match the frozen solver`, () => {
    const previous = fixture(patterns, baseline);
    const boards = [
      [2, ...Array(15).fill(0)],
      [2, 2, 0, 0, ...Array(12).fill(0)],
      [8192, 4096, 2048, 1024, 64, 128, 256, 512, 32, 16, 8, 4, 2, 4, 2, 0],
      [16384, 8192, 8192, 1024, 64, 128, 256, 512, 32, 16, 8, 4, 2, 4, 2, 0],
      [16384, 16384, ...Array(14).fill(0)],
      [32768, ...Array(15).fill(0)],
      [65536, ...Array(15).fill(0)],
      [8192, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2]
    ];
    for (const options of [{ply: 1}, {ply: 2}, {ply: 2, criticalSearch: true}]) {
      const oldSolver = new baseline.NTupleSolver(previous.model, options);
      const newSolver = new N.NTupleSolver(model, options);
      for (const board of boards) {
        reads.length = 0; previous.reads.length = 0;
        assert.deepEqual(outcome(newSolver.chooseMove(board)), outcome(oldSolver.chooseMove(board)));
        assert.deepEqual(reads, previous.reads, 'all feature queries and their order must be unchanged');
        parityDecisions++;
      }
    }
  });
}
test('numeric game continuation is distinct from rank-15 packed search', () => {
  const board = [32768, 32768, ...Array(14).fill(0)];
  const moved = game.move(board, 3);
  assert.deepEqual(moved.board, [65536, ...Array(15).fill(0)]);
  assert.equal(moved.score, 65536);
  assert.equal(moved.moved, true);
  assert.throws(() => N.tupleIndices(moved.board), /supports tiles through 32768/);
  const packed = game._internals.pack(board);
  assert.deepEqual(game._internals.unpack(...game._internals.movePacked(...packed, 3)), board,
    'packed rank-15 tiles deliberately do not merge into an unrepresentable rank 16');
});
console.log(JSON.stringify({ok: true, tests: checks, guardedReads, parityDecisions, frozenSourceSha256: FROZEN_SHA256,
  pretrainedChecks: false, benchmarkGames: 0}));
