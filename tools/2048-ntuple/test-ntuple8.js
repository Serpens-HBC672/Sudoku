#!/usr/bin/env node
'use strict';

// Bounded 8-table correctness checks only: no training, self-play, or download.
// node test-ntuple8.js --model /path/8x6patt.json --raw-model /path/8x6patt.w
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {NTupleModel, NTupleSolver, loadModel, tupleIndices} = require('./ntuple2048.js');
const game = require('../2048-expectimax/expectimax2048.js');
const ref = require('./reference-ntuple.js');
const ENTRIES = 16 ** 6;
// Independently verified headers of the pinned public 8x6patt.w model.
const PATTERNS = ['012456', '456789', '012345', '234569', '01259a', '345678', '134567', '01489a'];
const RAW_BYTES = 1610612989;
const RAW_SHA256 = 'bb8678095de7b5a934be105e51f7bb13f762eeb48b42a99e0ebc0da3fcbbbe9f';
const RAW_OFFSETS = [24, 201326647, 402653270, 603979893, 805306516, 1006633139, 1207959762, 1409286385];
const FIRST_WEIGHTS = [70216.28125, -13266.5498046875, 46380.37109375, 12587.576171875, 1934.4609375, -9230.376953125, -44957.6015625, -8977.7109375];
let checks = 0;
function test(name, action) { action(); console.log(`ok ${++checks} - ${name}`); }
function close(actual, expected, label) {
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected), label + ': values must be finite');
  assert.ok(Math.abs(actual - expected) <= Math.max(1e-8, Math.abs(expected) * 3e-12),
    `${label}: got ${actual}, expected ${expected}`);
}
function generator(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
const rng = generator(0x8602048);
const CASES = [
  Array(16).fill(0),
  [2, ...Array(15).fill(0)],
  [2, 2, 2, 2, 0, 4, 0, 4, 8, 0, 8, 16, 0, 0, 0, 0],
  [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2],
  [2, 4, 8, 16, 4, 8, 16, 32, 8, 16, 32, 64, 16, 32, 64, 64],
  [4096, 2048, 1024, 512, 32, 64, 128, 256, 16, 8, 4, 2, 0, 0, 0, 0],
  [16384, 8192, 4096, 2048, 128, 256, 512, 1024, 64, 32, 16, 8, 2, 4, 0, 0],
  ...Array.from({length: 25}, () => Array.from({length: 16}, () => rng() < 0.3 ? 0 : 2 ** (1 + Math.floor(rng() * 12))))
];
function checkDecision(model, tables, patterns, board, ply, label) {
  const original = board.slice();
  const expected = ref.chooseMove(board, tables, ply, patterns);
  const actual = new NTupleSolver(model, {ply}).chooseMove(board);
  assert.deepEqual(board, original, label + ': input mutation');
  assert.equal(actual.complete, true);
  assert.equal(actual.ply, ply);
  assert.equal(actual.targetReached, false);
  assert.ok(Number.isInteger(actual.nodes) && actual.nodes >= 0);
  assert.ok(Number.isFinite(actual.elapsedMs) && actual.elapsedMs >= 0);
  if (expected.direction === null) {
    assert.equal(actual.direction, null, label + ': no legal moves');
    assert.equal(actual.name, null);
    assert.equal(actual.value, 0);
    return;
  }
  assert.ok(Number.isInteger(actual.direction) && actual.direction >= 0 && actual.direction <= 3, label + ': direction');
  assert.notEqual(expected.values[actual.direction], null, label + ': illegal move');
  close(actual.value, expected.values[actual.direction], label + ': reported Q');
  close(expected.values[actual.direction], expected.value, label + ': selected action Q');
  assert.equal(actual.name, ['up', 'right', 'down', 'left'][actual.direction]);
  const sorted = expected.values.filter(value => value !== null).sort((a, b) => b - a);
  if (sorted.length === 1 || sorted[0] - sorted[1] > Math.max(1e-8, Math.abs(sorted[0]) * 3e-12)) assert.equal(actual.direction, expected.direction);
}
function syntheticValue(table, index) {
  const mixed = (Math.imul(index ^ (index >>> 13), 0x45d9f3b) ^ Math.imul(table + 1, 0x9e3779b1)) >>> 0;
  return Math.fround((mixed % 400001) - 200000 + table / 16);
}
function checkIndices(patterns, boards) {
  for (const board of boards) {
    const expected = ref.indices(board, patterns);
    const actual = Array.from(tupleIndices(board, patterns));
    assert.equal(actual.length, 64);
    for (let table = 0; table < 8; table++) {
      assert.deepEqual(actual.slice(table * 8, table * 8 + 8).sort((a, b) => a - b), expected[table].slice().sort((a, b) => a - b));
    }
  }
}
function runSynthetic() {
  const tables = Array.from({length: 8}, () => new Float32Array(ENTRIES));
  const model = new NTupleModel(tables, PATTERNS);
  test('64 feature indices match independent D4 extraction for 32 varied boards', () => checkIndices(PATTERNS, CASES));
  test('every pattern preserves first-cell-low-nibble indexing', () => {
    const board = Array.from({length: 16}, (_, rank) => rank ? 2 ** rank : 0);
    const indices = tupleIndices(board, PATTERNS);
    for (let table = 0; table < 8; table++) {
      assert.equal(indices[table * 8], parseInt(Array.from(PATTERNS[table]).reverse().join(''), 16));
    }
    checkIndices(PATTERNS, [board]);
  });
  test('generic model rejects malformed patterns and mismatched table count', () => {
    for (const patterns of [[], ['01234'], ['0123456'], ['01234g'], [123456], Array(17).fill('012345')]) assert.throws(() => new NTupleModel(tables, patterns));
    assert.throws(() => new NTupleModel(tables.slice(0, 7), PATTERNS));
    const original = PATTERNS.slice();
    const copy = new NTupleModel(tables, original);
    original[0] = 'ffffff';
    assert.equal(copy.patterns[0], PATTERNS[0]);
    assert.ok(Object.isFrozen(copy.patterns));
  });
  test('eight-table zero-weight 1-/2-ply decisions match array reference', () => {
    for (const ply of [1, 2]) for (let i = 0; i < CASES.length; i++) checkDecision(model, tables, PATTERNS, CASES[i], ply, `zero ply ${ply} case ${i}`);
    assert.equal(new NTupleSolver(model, {ply: 1}).chooseMove(CASES[1]).direction, 1, 'exact tie uses first legal direction');
  });
  test('all eight tables contribute, including negative leaf clipping', () => {
    for (let t = 0; t < 8; t++) tables[t][0] = -(t + 1);
    assert.equal(model.evaluate(Array(16).fill(0)), -8 * 36);
    for (const table of tables) table.fill(-1);
    assert.equal(model.evaluate(CASES[1]), -64);
    for (let i = 1; i < 8; i++) checkDecision(model, tables, PATTERNS, CASES[i], 2, `negative case ${i}`);
    for (const table of tables) table.fill(0);
  });
  test('synthetic direct, packed, and eight-symmetry evaluation match independent scoring', () => {
    const boards = [...CASES, Array.from({length: 16}, (_, rank) => rank ? 2 ** rank : 0)];
    for (const board of [...boards, ...CASES.flatMap(board => ref.leafBoards(board, 2))]) {
      const indices = ref.indices(board, PATTERNS);
      for (let table = 0; table < 8; table++) for (const index of indices[table]) tables[table][index] = syntheticValue(table, index);
    }
    for (const board of boards) {
      const expected = ref.evaluate(board, tables, PATTERNS);
      close(model.evaluate(board), expected, 'synthetic evaluation');
      close(model.evaluatePacked(...game._internals.pack(board)), expected, 'synthetic packed evaluation');
      for (const transformed of ref.symmetries(board)) close(model.evaluate(transformed), expected, 'synthetic D4 invariance');
    }
  });
  test('synthetic eight-table 1-/2-ply choices and Q values match array reference', () => {
    for (const ply of [1, 2]) for (let i = 0; i < CASES.length; i++) checkDecision(model, tables, PATTERNS, CASES[i], ply, `synthetic ply ${ply} case ${i}`);
  });
  test('eight-table solver stops on existing or immediate target without expansion', () => {
    for (const ply of [1, 2]) {
      const solver = new NTupleSolver(model, {ply});
      const existing = solver.chooseMove([32768, ...Array(15).fill(0)]);
      assert.equal(existing.targetReached, true);
      assert.equal(existing.direction, null);
      assert.equal(existing.nodes, 0);
      const winning = solver.chooseMove([16384, 16384, ...Array(14).fill(0)]);
      assert.equal(winning.direction, 1);
      assert.equal(winning.nodes, 0);
      assert.ok(Number.isFinite(winning.value));
    }
  });
}

// Independent raw-file reader. It does not use the production converter,
// its offset metadata, or the production model's Float32Array table views.
function openRawModel(rawPath) {
  const fd = fs.openSync(rawPath, 'r');
  const size = fs.fstatSync(fd).size;
  const read = (length, offset) => {
    const b = Buffer.alloc(length);
    assert.equal(fs.readSync(fd, b, 0, length, offset), length, 'raw read length');
    return b;
  };
  try {
    const outer = read(5, 0);
    assert.equal(outer[0], 0);
    assert.equal(outer.readUInt32LE(1), 8);
    const patterns = [], offsets = [], headers = [], extensions = [];
    let offset = 5;
    for (let table = 0; table < 8; table++) {
      headers.push(offset);
      const header = read(19, offset);
      assert.equal(header[0], 128, 'raw table format');
      patterns.push(header.readBigUInt64LE(1).toString(16).padStart(6, '0'));
      assert.equal(header.readUInt16LE(9), 4, 'raw scalar width');
      assert.equal(header.readBigUInt64LE(11), BigInt(ENTRIES), 'raw table size');
      offset += 19;
      offsets.push(offset);
      offset += 4 * ENTRIES;
      const tableExtensions = [];
      for (;;) {
        const width = read(2, offset).readUInt16LE(0);
        offset += 2;
        if (width === 0) break;
        assert.equal(width, 4, 'training extension width');
        const count = Number(read(8, offset).readBigUInt64LE(0));
        assert.ok(Number.isSafeInteger(count) && count >= 0);
        offset += 8;
        tableExtensions.push({width, count});
        offset += width * count;
        assert.ok(offset <= size, 'training extension bounds');
      }
      extensions.push(tableExtensions);
    }
    assert.equal(offset, size, 'all source bytes accounted for');
    const cache = patterns.map(() => new Map());
    const tables = patterns.map((_, table) => new Proxy({}, {get(_target, property) {
      const index = Number(property);
      assert.ok(Number.isInteger(index) && index >= 0 && index < ENTRIES);
      if (!cache[table].has(index)) cache[table].set(index, read(4, offsets[table] + 4 * index).readFloatLE(0));
      return cache[table].get(index);
    }}));
    return {fd, size, patterns, offsets, headers, extensions, read, tables, close: () => fs.closeSync(fd)};
  } catch (error) { fs.closeSync(fd); throw error; }
}

function runActual(manifestPath, rawPath) {
  const model = loadModel(manifestPath);
  assert.equal(model.patterns.length, 8, 'an eight-table model is required');
  assert.deepEqual(Array.from(model.patterns), PATTERNS, 'verified eight-table pattern order');
  const patterns = Array.from(model.patterns);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.source.sha256, RAW_SHA256);
  assert.equal(manifest.source.bytes, RAW_BYTES);
  const raw = rawPath ? openRawModel(rawPath) : null;
  let bytes = null;
  try {
    let tables;
    if (raw) {
      test('source header signatures independently verify all eight model patterns and their order', () => {
        assert.deepEqual(patterns, raw.patterns);
        assert.equal(raw.size, RAW_BYTES);
        assert.deepEqual(raw.offsets, RAW_OFFSETS);
        assert.deepEqual(raw.patterns, PATTERNS);
        for (const extensions of raw.extensions) assert.deepEqual(extensions, [{width: 4, count: 33554432}]);
      });
      tables = raw.tables;
    } else {
      bytes = fs.readFileSync(path.resolve(path.dirname(manifestPath), manifest.inference.file));
      assert.equal(bytes.length, 8 * ENTRIES * 4);
      tables = Array.from({length: 8}, (_, t) => new Proxy({}, {get(_target, index) { return bytes.readFloatLE(t * ENTRIES * 4 + Number(index) * 4); }}));
    }
    test('actual-model known raw scalars and empty-board fixture match pinned source', () => {
      for (let t = 0; t < 8; t++) assert.equal(tables[t][0], FIRST_WEIGHTS[t]);
      assert.equal(model.evaluate(Array(16).fill(0)), 437491.6015625);
      assert.equal(ref.evaluate(Array(16).fill(0), tables, patterns), 437491.6015625);
    });
    test('actual-model 64 indices match independent pattern extraction', () => checkIndices(patterns, CASES));
    test('actual-model direct/packed values and D4 invariance match independent weights', () => {
      for (const board of CASES) {
        const expected = ref.evaluate(board, tables, patterns);
        close(model.evaluate(board), expected, 'actual direct evaluation');
        close(model.evaluatePacked(...game._internals.pack(board)), expected, 'actual packed evaluation');
        for (const transformed of ref.symmetries(board)) close(model.evaluate(transformed), expected, 'actual symmetry invariance');
      }
    });
    test('actual-model 1-/2-ply selected actions and Q values match array-board reference', () => {
      for (const ply of [1, 2]) for (let i = 0; i < CASES.length; i++) checkDecision(model, tables, patterns, CASES[i], ply, `actual ply ${ply} case ${i}`);
    });
    if (raw) test('576 sampled converted weights are bit-identical to source offsets', () => {
      const fd = fs.openSync(path.resolve(path.dirname(manifestPath), manifest.inference.file), 'r');
      const sampleRng = generator(0x864c6a);
      const output = Buffer.alloc(4);
      try {
        for (let t = 0; t < 8; t++) {
          const indices = [0, 1, 15, 16, 255, 256, 0x654210, ENTRIES - 1,
            ...Array.from({length: 64}, () => Math.floor(sampleRng() * ENTRIES))];
          for (const index of indices) {
            assert.equal(fs.readSync(fd, output, 0, 4, t * ENTRIES * 4 + index * 4), 4);
            assert.equal(output.readUInt32LE(0), raw.read(4, raw.offsets[t] + index * 4).readUInt32LE(0), `raw table ${t} entry ${index}`);
          }
        }
      } finally { fs.closeSync(fd); }
    });
    return {patterns, sourceBytes: raw ? raw.size : null, rawValueOffsets: raw ? raw.offsets : null,
      emptyBoardValue: model.evaluate(Array(16).fill(0)), fixtureBoard: CASES[6], fixtureValue: model.evaluate(CASES[6]),
      fixtureOnePly: new NTupleSolver(model, {ply: 1}).chooseMove(CASES[6]),
      fixtureTwoPly: new NTupleSolver(model, {ply: 2}).chooseMove(CASES[6])};
  } finally { if (raw) raw.close(); }
}

let manifestPath = process.env.NTUPLE8_MODEL || null;
let rawPath = process.env.NTUPLE8_RAW_MODEL || null;
let syntheticOnly = false;
for (let i = 2; i < process.argv.length; i++) {
  const argument = process.argv[i];
  if (argument === '--model' || argument === '--raw-model') {
    const value = process.argv[++i];
    if (!value || value.startsWith('--')) throw new Error(argument + ' requires a path');
    if (argument === '--model') manifestPath = value; else rawPath = value;
  } else if (argument === '--synthetic-only') syntheticOnly = true;
  else if (argument === '--help') {
    console.log('node test-ntuple8.js [--model /path/8x6patt.json] [--raw-model /path/8x6patt.w] [--synthetic-only]');
    process.exit(0);
  } else throw new Error('Unknown argument ' + argument);
}
if (rawPath && !manifestPath) throw new Error('--raw-model requires --model');
if (syntheticOnly && (manifestPath || rawPath)) throw new Error('--synthetic-only cannot be combined with model paths');
runSynthetic();
const actual = manifestPath ? runActual(path.resolve(manifestPath), rawPath && path.resolve(rawPath)) : null;
if (!actual) console.log('# Actual 8x6 model checks skipped; supply --model and --raw-model after download verification.');
console.log(JSON.stringify({ok: true, tests: checks, boards: CASES.length, features: 64, actualModelChecked: Boolean(actual), rawChecked: Boolean(rawPath), actual}));
