#!/usr/bin/env node
'use strict';

// Fast, bounded correctness checks. This does not train a model or run games.
// Optional real-weight parity:
// node test-ntuple.js --model /path/4x6patt.json --raw-model /path/4x6patt.w
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {NTupleModel, NTupleSolver, loadModel, tupleIndices} = require('./ntuple2048.js');
const game = require('../2048-expectimax/expectimax2048.js');
const ref = require('./reference-ntuple.js');
const ENTRIES = 16 ** 6;
const RAW_BYTES = 805306497;
const RAW_HEADERS = [5, 201326628, 402653251, 603979874];
const RAW_VALUES = [24, 201326647, 402653270, 603979893];
const PATTERN_IDS = [0x012345n, 0x456789n, 0x012456n, 0x45689an];
const FIRST_VALUES = [-9400.4130859375, 8949.708984375, 36163.5859375, 14768.443359375];
let checks = 0;
function test(name, action) {
  action();
  checks++;
  console.log('ok ' + checks + ' - ' + name);
}
function close(actual, expected, label, tolerance = 2e-12) {
  assert.ok(Number.isFinite(actual), label + ': result must be finite');
  const delta = Math.abs(actual - expected);
  assert.ok(delta <= Math.max(1e-8, Math.abs(expected) * tolerance),
    `${label}: got ${actual}, expected ${expected}, difference ${delta}`);
}
function generator(seed = 0x5eed2048) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
function randomBoards(count, seed) {
  const rng = generator(seed);
  return Array.from({length: count}, () => Array.from({length: 16}, () => rng() < 0.3 ? 0 : 2 ** (1 + Math.floor(rng() * 12))));
}
const CASES = [
  [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [2, 2, 2, 2, 0, 4, 0, 4, 8, 0, 8, 16, 0, 0, 0, 0],
  [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2],
  [2, 4, 8, 16, 4, 8, 16, 32, 8, 16, 32, 64, 16, 32, 64, 64],
  [4096, 2048, 1024, 512, 32, 64, 128, 256, 16, 8, 4, 2, 0, 0, 0, 0],
  [16384, 8192, 4096, 2048, 128, 256, 512, 1024, 64, 32, 16, 8, 2, 4, 0, 0],
  ...randomBoards(26, 0x987abcde)
];

function checkDecision(solver, board, tables, ply, label) {
  const original = Array.from(board);
  const expected = ref.chooseMove(board, tables, ply);
  const actual = solver.chooseMove(board);
  assert.deepEqual(Array.from(board), original, label + ': input mutation');
  assert.equal(actual.complete, true, label + ': complete flag');
  assert.equal(actual.targetReached, false, label + ': unexpected target flag');
  assert.ok(Number.isFinite(actual.elapsedMs) && actual.elapsedMs >= 0, label + ': elapsed time');
  assert.ok(Number.isInteger(actual.nodes) && actual.nodes >= 0, label + ': node count');
  assert.ok(Number.isFinite(actual.value), label + ': finite value');
  if (expected.direction === null) {
    assert.equal(actual.direction, null, label + ': no legal moves');
    assert.equal(actual.name, null, label + ': terminal move name');
    return;
  }
  assert.ok(expected.values[actual.direction] !== null, label + ': selected an illegal direction');
  assert.equal(actual.name, ['up', 'right', 'down', 'left'][actual.direction], label + ': direction/name contract');
  close(expected.values[actual.direction], expected.value, label + ': selected action Q');
  close(actual.value, expected.values[actual.direction], label + ': reported Q');
  const sorted = expected.values.filter(value => value !== null).sort((a, b) => b - a);
  if (sorted.length === 1 || sorted[0] - sorted[1] > Math.max(1e-8, Math.abs(sorted[0]) * 2e-12)) {
    assert.equal(actual.direction, expected.direction, label + ': unique best action');
  }
}

function syntheticValue(table, index) {
  const mixed = (Math.imul(index ^ (index >>> 11), 0x45d9f3b) ^ Math.imul(table + 1, 0x9e3779b1)) >>> 0;
  return Math.fround((mixed % 400001) - 200000 + table / 8);
}

function runUnitTests() {
  const tables = Array.from({length: 4}, () => new Float32Array(ENTRIES));
  const model = new NTupleModel(tables);
  test('independent array movement matches game engine on 400 fixed-seed moves', () => {
    for (const board of randomBoards(100, 42)) {
      for (let d = 0; d < 4; d++) assert.deepEqual(ref.move(board, d), game.move(board, d));
    }
    assert.deepEqual(ref.move([2, 2, 2, 2, ...new Array(12).fill(0)], 3),
      {board: [4, 4, 0, 0, ...new Array(12).fill(0)], score: 8, moved: true});
  });
  test('reference D4 transformations are eight distinct bijections', () => {
    const labels = Array.from({length: 16}, (_, i) => i);
    const transformed = ref.symmetries(labels);
    assert.equal(new Set(transformed.map(board => board.join(','))).size, 8);
    for (const board of transformed) assert.deepEqual(board.slice().sort((a, b) => a - b), labels);
    assert.deepEqual(ref.rotate(labels, 1), [12, 8, 4, 0, 13, 9, 5, 1, 14, 10, 6, 2, 15, 11, 7, 3]);
    assert.deepEqual(ref.rotate(labels, 4), labels);
  });
  test('tuple order puts the first cell in low bits, across all four patterns', () => {
    const ranks = Array.from({length: 16}, (_, i) => i);
    const board = ranks.map(rank => rank ? 2 ** rank : 0);
    const actual = Array.from(tupleIndices(board));
    assert.equal(actual.length, 32);
    const expectedIdentity = [0x543210, 0x987654, 0x654210, 0xa98654];
    for (let table = 0; table < 4; table++) {
      assert.equal(ref.rankIndex(ranks, ref.PATTERNS[table]), expectedIdentity[table]);
      assert.equal(actual[table * 8], expectedIdentity[table]);
      assert.deepEqual(actual.slice(table * 8, table * 8 + 8).sort((a, b) => a - b),
        ref.indices(board)[table].slice().sort((a, b) => a - b));
    }
    assert.deepEqual(Array.from(tupleIndices(new Uint32Array(board))), actual);
  });
  test('all 32 indices match independent D4 extraction for 32 varied boards', () => {
    for (const board of CASES) {
      const expected = ref.indices(board), actual = Array.from(tupleIndices(board));
      for (let t = 0; t < 4; t++) assert.deepEqual(actual.slice(t * 8, t * 8 + 8).sort((a, b) => a - b), expected[t].slice().sort((a, b) => a - b));
    }
  });
  test('model rejects malformed table storage', () => {
    assert.throws(() => new NTupleModel([]));
    assert.throws(() => new NTupleModel(tables.slice(0, 3)));
    assert.throws(() => new NTupleModel([...tables, tables[0]]));
    assert.throws(() => new NTupleModel([new Float32Array(16), ...tables.slice(1)]));
    assert.throws(() => new NTupleModel([new Uint32Array(tables[0].buffer), ...tables.slice(1)]));
  });
  test('numeric input validation rejects bad shape, bad tiles, and rank overflow', () => {
    const invalid = [null, undefined, '0'.repeat(16), [], Array(15).fill(0), Array(17).fill(0), new DataView(new ArrayBuffer(16))];
    for (const bad of invalid) {
      assert.throws(() => model.evaluate(bad));
      assert.throws(() => tupleIndices(bad));
      assert.throws(() => new NTupleSolver(model).chooseMove(bad));
    }
    for (const tile of [-2, 1, 3, 0.5, NaN, Infinity, '2', 2n, 65536, 2 ** 53]) {
      const bad = Array(16).fill(0); bad[7] = tile;
      assert.throws(() => model.evaluate(bad), 'bad tile ' + String(tile));
      assert.throws(() => tupleIndices(bad), 'bad tile ' + String(tile));
      if (tile !== 65536) assert.throws(() => new NTupleSolver(model).chooseMove(bad));
    }
    assert.equal(model.evaluate(new Uint16Array(16)), 0);
  });
  test('evaluation rejects nonfinite selected weights', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      tables[0][0] = value;
      assert.throws(() => model.evaluate(Array(16).fill(0)), /non-finite/);
    }
    tables[0][0] = 0;
  });
  test('solver rejects unsupported ply and target options', () => {
    for (const ply of [0, 3, -1, 1.5]) assert.throws(() => new NTupleSolver(model, {ply}));
    for (const target of [3, 7, 65536, NaN]) assert.throws(() => new NTupleSolver(model, {target}));
  });
  test('zero-weight 1-/2-ply choices obey legal moves, merge reward, and dead states', () => {
    for (const ply of [1, 2]) {
      const solver = new NTupleSolver(model, {ply});
      for (let i = 0; i < CASES.length; i++) checkDecision(solver, CASES[i], tables, ply, `zero ply ${ply} case ${i}`);
    }
    assert.equal(new NTupleSolver(model, {ply: 1}).chooseMove(CASES[0]).direction, 1, 'equal legal Q chooses first direction (right)');
  });
  test('negative-weight 2-ply uses the native nonnegative leaf floor and +1 bonus', () => {
    for (const table of tables) table.fill(-1);
    assert.equal(model.evaluate(CASES[0]), -32);
    const solver = new NTupleSolver(model, {ply: 2});
    for (let i = 0; i < 8; i++) checkDecision(solver, CASES[i], tables, 2, 'negative case ' + i);
    assert.equal(ref.innerBest(CASES[2], tables), 0, 'dead child value');
    assert.ok(ref.innerBest(CASES[0], tables) >= 1, 'living child survival bonus');
    for (const table of tables) table.fill(0);
  });
  test('target already reached and immediate target merge stop before further search', () => {
    for (const ply of [1, 2]) {
      const solver = new NTupleSolver(model, {ply});
      for (const targetTile of [32768, 65536, 2 ** 52]) {
        const board = [targetTile, ...Array(15).fill(0)];
        const result = solver.chooseMove(board);
        assert.equal(result.direction, null);
        assert.equal(result.targetReached, true);
        assert.equal(result.nodes, 0);
        assert.ok(Number.isFinite(result.value));
      }
      const board = [16384, 16384, ...Array(14).fill(0)];
      const result = solver.chooseMove(board);
      assert.equal(result.direction, 1, 'first immediate winning direction');
      assert.equal(result.nodes, 0);
      assert.ok(game.move(board, result.direction).board.includes(32768));
      assert.ok(Number.isFinite(result.value));
    }
  });
  const evalBoards = [...CASES, Array(16).fill(0), Array.from({length: 16}, (_, rank) => rank ? 2 ** rank : 0)];
  test('independent synthetic weights agree for direct and packed evaluation', () => {
    for (const board of [...evalBoards, ...CASES.flatMap(board => ref.leafBoards(board, 2))]) {
      const all = ref.indices(board);
      for (let t = 0; t < 4; t++) for (const index of all[t]) tables[t][index] = syntheticValue(t, index);
    }
    for (const board of evalBoards) {
      const expected = ref.evaluate(board, tables);
      close(model.evaluate(board), expected, 'synthetic direct evaluation');
      const [lo, hi] = game._internals.pack(board);
      close(model.evaluatePacked(lo, hi), expected, 'synthetic packed evaluation');
      for (const transformed of ref.symmetries(board)) close(model.evaluate(transformed), expected, 'synthetic symmetry invariant');
    }
  });
  test('synthetic 1-/2-ply choices agree with independent array-board reference', () => {
    for (const ply of [1, 2]) {
      const solver = new NTupleSolver(model, {ply});
      for (let i = 0; i < CASES.length; i++) checkDecision(solver, CASES[i], tables, ply, `synthetic ply ${ply} case ${i}`);
    }
  });
  return {unitCases: CASES.length, tableBytes: tables.reduce((sum, table) => sum + table.byteLength, 0)};
}

function realFixtures() {
  // Independently computed with direct reads from the pinned .w value offsets,
  // not with the production converter or model evaluator.
  return [
    {board: Array(16).fill(0), value: 403850.6015625},
    {board: [2, ...Array(14).fill(0), 2], value: 238136.7265625},
    {board: CASES[4], value: 225496.75415039062},
    {board: CASES[5], value: 164879.41248321533},
    {board: CASES[2], value: 287330.6320800781}
  ];
}

function runRealModelTests(manifestPath, rawPath) {
  const model = loadModel(manifestPath);
  // Reference tables are read directly from the independently located flat
  // data file, without calling production table-index or evaluation methods.
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const dataPath = path.resolve(path.dirname(manifestPath), manifest.inference.file);
  const bytes = fs.readFileSync(dataPath);
  assert.equal(bytes.length, 268435456);
  const tables = Array.from({length: 4}, (_, t) => new Float32Array(bytes.buffer, bytes.byteOffset + t * 67108864, ENTRIES));
  test('pinned pretrained model matches independently read scalar and board fixtures', () => {
    for (let t = 0; t < 4; t++) assert.equal(tables[t][0], FIRST_VALUES[t]);
    for (const fixture of realFixtures()) close(model.evaluate(fixture.board), fixture.value, 'fixed raw-weight fixture');
  });
  test('pretrained evaluation agrees with independent indexing and all D4 transforms', () => {
    for (const board of CASES) {
      const expected = ref.evaluate(board, tables);
      close(model.evaluate(board), expected, 'real-model independent evaluation');
      const [lo, hi] = game._internals.pack(board);
      close(model.evaluatePacked(lo, hi), expected, 'real-model packed evaluation');
      for (const transformed of ref.symmetries(board)) close(model.evaluate(transformed), expected, 'real-model symmetry invariant');
    }
  });
  test('pretrained 1-/2-ply decisions agree with independent array-board reference', () => {
    for (const ply of [1, 2]) {
      const solver = new NTupleSolver(model, {ply});
      for (let i = 0; i < CASES.length; i++) checkDecision(solver, CASES[i], tables, ply, `real model ply ${ply} case ${i}`);
    }
    close(new NTupleSolver(model, {ply: 1}).chooseMove(CASES[5]).value, 180687.43719100952, 'raw read one-ply Q fixture');
    close(new NTupleSolver(model, {ply: 2}).chooseMove(CASES[5]).value, 181143.3481781006, 'raw read two-ply Q fixture');
  });
  test('model loader rejects wrong provenance and truncated inference data', () => {
    const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ntuple-loader-test-'));
    try {
      const invalid = JSON.parse(JSON.stringify(manifest));
      invalid.inference.file = 'short.f32';
      invalid.source.sha256 = '0'.repeat(64);
      fs.writeFileSync(path.join(temp, 'invalid.json'), JSON.stringify(invalid));
      assert.throws(() => loadModel(path.join(temp, 'invalid.json')), /pinned|verified/);
      invalid.source.sha256 = manifest.source.sha256;
      fs.writeFileSync(path.join(temp, 'invalid.json'), JSON.stringify(invalid));
      fs.writeFileSync(path.join(temp, 'short.f32'), Buffer.alloc(16));
      assert.throws(() => loadModel(path.join(temp, 'invalid.json')), /size|SHA-256/);
    } finally { fs.rmSync(temp, {recursive: true, force: true}); }
  });
  if (rawPath) {
    test('converter retains sampled raw weights exactly and skips training extensions', () => {
      assert.equal(fs.statSync(rawPath).size, RAW_BYTES);
      const fd = fs.openSync(rawPath, 'r');
      const read = (length, offset) => {
        const b = Buffer.alloc(length);
        assert.equal(fs.readSync(fd, b, 0, length, offset), length);
        return b;
      };
      try {
        assert.equal(read(5, 0).toString('hex'), '0004000000');
        const rng = generator(0x4c6a);
        for (let t = 0; t < 4; t++) {
          const header = read(19, RAW_HEADERS[t]);
          assert.equal(header[0], 128);
          assert.equal(header.readBigUInt64LE(1), PATTERN_IDS[t]);
          assert.equal(header.readUInt16LE(9), 4);
          assert.equal(header.readBigUInt64LE(11), BigInt(ENTRIES));
          const indices = [0, 1, 15, 16, 255, 256, 0x543210, ENTRIES - 1, ...Array.from({length: 64}, () => Math.floor(rng() * ENTRIES))];
          for (const index of indices) {
            const raw = read(4, RAW_VALUES[t] + 4 * index);
            assert.equal(raw.readUInt32LE(0), bytes.readUInt32LE(t * 67108864 + 4 * index), `bit-exact raw table ${t} entry ${index}`);
          }
          const extension = read(10, RAW_VALUES[t] + 67108864);
          assert.equal(extension.readUInt16LE(0), 4);
          assert.equal(extension.readBigUInt64LE(2), 33554432n);
          assert.equal(read(2, RAW_VALUES[t] + 67108864 + 10 + 134217728).readUInt16LE(0), 0);
        }
      } finally { fs.closeSync(fd); }
    });
  }
}

let manifestPath = process.env.NTUPLE_MODEL || null;
let rawPath = process.env.NTUPLE_RAW_MODEL || null;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--model') {
    manifestPath = process.argv[++i];
    if (!manifestPath || manifestPath.startsWith('--')) throw new Error('--model requires a path');
  } else if (process.argv[i] === '--raw-model') {
    rawPath = process.argv[++i];
    if (!rawPath || rawPath.startsWith('--')) throw new Error('--raw-model requires a path');
  }
  else if (process.argv[i] === '--help') {
    console.log('node test-ntuple.js [--model /path/4x6patt.json] [--raw-model /path/4x6patt.w]');
    process.exit(0);
  } else throw new Error('Unknown argument: ' + process.argv[i]);
}
if (rawPath && !manifestPath) throw new Error('--raw-model requires --model');
const summary = runUnitTests();
if (manifestPath) runRealModelTests(path.resolve(manifestPath), rawPath && path.resolve(rawPath));
else console.log('# Real-model checks skipped; supply --model and optionally --raw-model. No download is implicit.');
console.log(JSON.stringify({ok: true, tests: checks, ...summary, pretrainedChecks: Boolean(manifestPath), rawChecks: Boolean(rawPath)}));
