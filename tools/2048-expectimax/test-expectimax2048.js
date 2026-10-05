'use strict';

// Independent reference tests: no dependencies, no implementation tables reused.
// Run: node test-expectimax2048.js
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const api = require('./expectimax2048.js');
const { Solver, move, spawn, createRng, emptyBoard, initialBoard, _internals } = api;
const names = ['up', 'right', 'down', 'left'];
let checks = 0;
const started = performance.now();

function test(name, fn) {
  const t = performance.now();
  fn();
  checks++;
  console.log(`PASS ${name} (${(performance.now() - t).toFixed(1)} ms)`);
}

function referenceLine(line) {
  const compact = line.filter(x => x !== 0);
  const result = [];
  let score = 0;
  for (let i = 0; i < compact.length; i++) {
    if (i + 1 < compact.length && compact[i] === compact[i + 1]) {
      const merged = compact[i] * 2;
      result.push(merged);
      score += merged;
      i++;
    } else result.push(compact[i]);
  }
  while (result.length < 4) result.push(0);
  return { line: result, score };
}

function referenceMove(board, direction) {
  const result = Array(16).fill(0);
  let score = 0;
  for (let lane = 0; lane < 4; lane++) {
    const indices = [];
    for (let k = 0; k < 4; k++) {
      indices.push(direction === 0 ? 4 * k + lane :
        direction === 1 ? 4 * lane + 3 - k :
        direction === 2 ? 4 * (3 - k) + lane : 4 * lane + k);
    }
    const merged = referenceLine(indices.map(i => board[i]));
    score += merged.score;
    indices.forEach((index, k) => { result[index] = merged.line[k]; });
  }
  return { board: result, moved: result.some((v, i) => v !== board[i]), score };
}

function assertMove(board, direction, context) {
  const expected = referenceMove(board, direction);
  const actual = move(board, direction);
  assert.deepEqual(actual.board, expected.board, `${context}: board`);
  assert.equal(actual.score, expected.score, `${context}: score`);
  assert.equal(actual.moved, expected.moved, `${context}: moved`);
  assert.equal(actual.board.reduce((a, b) => a + b, 0), board.reduce((a, b) => a + b, 0), `${context}: tile mass`);
  return expected;
}

function seededRandom(seed) {
  // An unrelated, fixed reference PRNG avoids circularly testing the supplied RNG.
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function referenceEvaluation(board) {
  const rank = board.map(v => v ? Math.log2(v) : 0);
  const lines = [];
  for (let i = 0; i < 4; i++) {
    lines.push(rank.slice(i * 4, i * 4 + 4));
    lines.push([rank[i], rank[i + 4], rank[i + 8], rank[i + 12]]);
  }
  return lines.reduce((total, line) => {
    const nonzero = line.filter(Boolean);
    const runs = [];
    for (const n of nonzero) {
      if (runs.length && runs[runs.length - 1][0] === n) runs[runs.length - 1].push(n);
      else runs.push([n]);
    }
    let increasing = 0, decreasing = 0;
    for (let i = 1; i < 4; i++) {
      increasing += Math.max(0, line[i] ** 4 - line[i - 1] ** 4);
      decreasing += Math.max(0, line[i - 1] ** 4 - line[i] ** 4);
    }
    return total + 200000 + 270 * (4 - nonzero.length)
      + 700 * runs.reduce((n, run) => n + (run.length > 1 ? run.length : 0), 0)
      - 47 * Math.min(increasing, decreasing)
      - 11 * line.reduce((n, r) => n + r ** 3.5, 0);
  }, 0);
}

function referenceSearch(board, depth, cutoff) {
  const win = 1e9, loss = -1e9;
  function chance(position, remaining, probability) {
    if (position.some(v => v >= 32768)) return win;
    if (remaining <= 0 || probability < cutoff) return referenceEvaluation(position);
    const empty = [];
    position.forEach((v, i) => { if (v === 0) empty.push(i); });
    if (!empty.length) return player(position, remaining - 1, probability);
    let result = 0;
    for (const i of empty) {
      for (const [tile, weight] of [[2, 0.9], [4, 0.1]]) {
        const next = position.slice();
        next[i] = tile;
        result += weight * player(next, remaining - 1, probability * weight / empty.length);
      }
    }
    return result / empty.length;
  }
  function player(position, remaining, probability) {
    let best = -Infinity;
    for (let direction = 0; direction < 4; direction++) {
      const next = referenceMove(position, direction);
      if (next.moved) best = Math.max(best, chance(next.board, remaining, probability));
    }
    return best === -Infinity ? loss : best;
  }
  let direction = null, value = -Infinity;
  const values = new Map();
  for (let d = 0; d < 4; d++) {
    const next = referenceMove(board, d);
    if (!next.moved) continue;
    const candidate = chance(next.board, depth, 1);
    values.set(d, candidate);
    if (candidate > value) { direction = d; value = candidate; }
  }
  return { direction, value, values };
}

function boardFromRowCode(code) {
  const row = [];
  for (let shift = 0; shift < 16; shift += 4) {
    const exponent = (code >>> shift) & 15;
    row.push(exponent === 0 ? 0 : 2 ** exponent);
  }
  return [...row, ...Array(12).fill(0)];
}

function assertPackedMove(board, direction, expected, context) {
  if (board.some(x => x > 32768) || expected.board.some(x => x > 32768)) return;
  const packed = _internals.pack(board);
  const result = _internals.movePacked(packed[0], packed[1], direction);
  assert.deepEqual(_internals.unpack(result[0], result[1]), expected.board, `${context}: packed move`);
}

test('exports and fresh empty boards', () => {
  for (const key of ['Solver', 'move', 'spawn', 'createRng', 'emptyBoard', 'initialBoard']) {
    assert.equal(typeof api[key], 'function', key);
  }
  for (const key of ['pack', 'unpack', 'movePacked', 'evaluatePacked', 'initTables']) {
    assert.equal(typeof _internals[key], 'function', `_internals.${key}`);
  }
  const a = emptyBoard(), b = emptyBoard();
  assert.deepEqual(a, Array(16).fill(0));
  a[0] = 2;
  assert.equal(b[0], 0);
  _internals.initTables();
  _internals.initTables();
});

test('merge rules, directions, score, and unsigned packing', () => {
  const rows = [
    [[2, 2, 2, 2], [4, 4, 0, 0], 8],
    [[2, 2, 4, 0], [4, 4, 0, 0], 4],
    [[4, 4, 8, 8], [8, 16, 0, 0], 24],
    [[0, 2, 0, 2], [4, 0, 0, 0], 4],
    [[2, 2, 2, 0], [4, 2, 0, 0], 4],
    [[2, 4, 4, 2], [2, 8, 2, 0], 8],
    [[32768, 32768, 0, 0], [65536, 0, 0, 0], 65536],
    [[65536, 65536, 65536, 65536], [131072, 131072, 0, 0], 262144],
  ];
  for (const [row, expected, score] of rows) {
    const board = [...row, ...Array(12).fill(0)];
    const result = move(board, 'left');
    assert.deepEqual(result.board.slice(0, 4), expected);
    assert.equal(result.score, score);
    for (let direction = 0; direction < 4; direction++) {
      assert.deepEqual(move(board, names[direction]), move(board, direction));
      assertMove(board, direction, `row ${row}, ${names[direction]}`);
    }
  }
  const highBits = [0, 2, 4, 8, 16, 32, 64, 32768, 128, 256, 512, 1024, 2048, 4096, 8192, 32768];
  const packed = _internals.pack(highBits);
  assert.deepEqual(_internals.unpack(packed[0], packed[1]), highBits);
});

test('all 65,536 rows, left and right, against independent merge logic', () => {
  for (let code = 0; code < 65536; code++) {
    const board = boardFromRowCode(code);
    for (const direction of [1, 3]) {
      const context = `row 0x${code.toString(16)}, ${names[direction]}`;
      const expected = assertMove(board, direction, context);
      assertPackedMove(board, direction, expected, context);
    }
  }
});

test('10,000 random boards in all directions, public and packed', () => {
  const random = seededRandom(0x20481234);
  for (let sample = 0; sample < 10000; sample++) {
    const board = Array.from({ length: 16 }, () => {
      const x = random();
      return x < 0.3 ? 0 : 2 ** (1 + Math.floor(random() * 15));
    });
    const snapshot = board.slice();
    const packed = _internals.pack(board);
    assert.deepEqual(_internals.unpack(packed[0], packed[1]), board, `pack ${sample}`);
    for (let direction = 0; direction < 4; direction++) {
      const expected = assertMove(board, direction, `random ${sample}/${direction}`);
      assertPackedMove(board, direction, expected, `random ${sample}/${direction}`);
    }
    assert.deepEqual(board, snapshot, `input mutation ${sample}`);
  }
});

test('spawn geometry, immutability, reproducibility, and distribution', () => {
  const original = [2, 0, 4, 8, 0, 16, 32, 64, 128, 256, 512, 0, 1024, 2048, 4096, 0];
  const frozen = Object.freeze(original.slice());
  const rngA = createRng(20248), rngB = createRng(20248);
  for (let i = 0; i < 1000; i++) {
    const a = rngA(), b = rngB();
    assert.equal(a, b);
    assert.ok(Number.isFinite(a) && a >= 0 && a < 1);
  }
  const count = new Map([[1, 0], [4, 0], [11, 0], [15, 0]]);
  const random = seededRandom(0x7e57);
  let fours = 0;
  for (let i = 0; i < 50000; i++) {
    const result = spawn(frozen, random);
    assert.ok(count.has(result.index), `spawn index ${result.index}`);
    assert.ok(result.value === 2 || result.value === 4);
    assert.equal(result.board[result.index], result.value);
    assert.notEqual(result.board, frozen);
    assert.equal(result.board.filter((v, k) => v !== original[k]).length, 1);
    count.set(result.index, count.get(result.index) + 1);
    if (result.value === 4) fours++;
  }
  assert.deepEqual(frozen, original);
  for (const [index, n] of count) assert.ok(n > 11800 && n < 13200, `uniform empty ${index}: ${n}`);
  assert.ok(fours > 4500 && fours < 5500, `10% fours: ${fours}/50000`);
  assert.equal(spawn(Array(16).fill(2), () => { throw new Error('RNG called without an empty cell'); }), null);
  assert.deepEqual(initialBoard(createRng(813)), initialBoard(createRng(813)));
  const initial = initialBoard(createRng(900));
  assert.equal(initial.filter(Boolean).length, 2);
  assert.ok(initial.every(x => x === 0 || x === 2 || x === 4));
});

test('public functions do not mutate frozen input boards', () => {
  const board = Object.freeze([2, 2, 4, 4, 8, 16, 32, 64, 0, 0, 0, 0, 0, 0, 0, 0]);
  for (let direction = 0; direction < 4; direction++) assertMove(board, direction, 'frozen input');
  const solver = new Solver({ profile: 'fast', maxDepth: 1, probabilityCutoff: 0, nodeBudget: 500000, timeBudgetMs: 10000 });
  const answer = solver.chooseMove(board);
  assert.ok(Number.isInteger(answer.direction));
  assert.ok(referenceMove(board, answer.direction).moved);
});

test('invalid boards and directions are rejected', () => {
  const badBoards = [null, undefined, [], Array(15).fill(0), Array(17).fill(0),
    [3, ...Array(15).fill(0)], [1, ...Array(15).fill(0)], [-2, ...Array(15).fill(0)],
    [NaN, ...Array(15).fill(0)], [Infinity, ...Array(15).fill(0)], [2.5, ...Array(15).fill(0)],
    ['2', ...Array(15).fill(0)], [2 ** 50 + 1, ...Array(15).fill(0)],
    [2 ** 52 - 1, ...Array(15).fill(0)], [Number.MAX_SAFE_INTEGER, ...Array(15).fill(0)]];
  for (const board of badBoards) assert.throws(() => move(board, 'left'), `board ${String(board)}`);
  for (const direction of [-1, 4, 1.5, 'diagonal', null, NaN]) {
    assert.throws(() => move(emptyBoard(), direction), `direction ${String(direction)}`);
  }
});

test('solver returns legal finite decisions and honors target / terminal states', () => {
  const opts = { profile: 'fast', maxDepth: 2, probabilityCutoff: 0, nodeBudget: 1000000, timeBudgetMs: 10000 };
  const solver = new Solver(opts);
  const terminal = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2];
  const terminalResult = solver.chooseMove(terminal);
  assert.equal(terminalResult.direction, null);
  const emptyResult = solver.chooseMove(emptyBoard());
  assert.equal(emptyResult.direction, null);
  const reached = [32768, ...Array(15).fill(0)];
  const reachedResult = solver.chooseMove(reached);
  assert.equal(reachedResult.direction, null);
  assert.equal(reachedResult.targetReached, true);
  const beyondTarget = solver.chooseMove([65536, ...Array(15).fill(0)]);
  assert.equal(beyondTarget.direction, null);
  assert.equal(beyondTarget.targetReached, true);
  const customTarget = new Solver({ ...opts, target: 2048 });
  assert.equal(customTarget.chooseMove([2048, ...Array(15).fill(0)]).targetReached, true);
  const customWin = customTarget.chooseMove([1024, 1024, ...Array(14).fill(0)]);
  assert.ok(customWin.direction === 1 || customWin.direction === 3);
  const immediateWin = [16384, 16384, 4, 8, 2, 4, 8, 16, 4, 8, 16, 32, 8, 16, 32, 64];
  const winning = new Solver({ ...opts, maxDepth: 1 }).chooseMove(immediateWin);
  assert.ok(winning.direction === 1 || winning.direction === 3, `depth-one immediate win chose ${winning.name}`);
  assert.ok(referenceMove(immediateWin, winning.direction).board.includes(32768));
  const random = seededRandom(991827);
  for (let sample = 0; sample < 100; sample++) {
    const board = Array.from({ length: 16 }, () => random() < 0.25 ? 0 : 2 ** (1 + Math.floor(random() * 9)));
    const result = solver.chooseMove(board);
    const legal = names.map((_, direction) => direction).filter(d => referenceMove(board, d).moved);
    assert.ok(legal.length === 0 ? result.direction === null : legal.includes(result.direction), `decision ${sample}`);
    if (result.direction !== null) {
      assert.equal(result.name, names[result.direction]);
      assert.ok(Number.isFinite(result.value));
      assert.ok(result.depth >= 1);
      assert.ok(result.nodes >= 0 && result.cacheHits >= 0 && result.elapsedMs >= 0);
    }
  }
});

test('negative heuristics never make certain death preferable to survival', () => {
  const board = [4, 2048, 4, 4, 1024, 8192, 4096, 1024, 8192, 8, 4, 2, 128, 64, 8192, 8];
  const solver = new Solver({ profile: 'fast', maxDepth: 1, iterative: false, adaptiveDepth: false,
    probabilityCutoff: 0, tableBits: 0, nodeBudget: 1000000, timeBudgetMs: 10000 });
  // Left loses on either spawn; right can continue after a 2 (90% probability).
  assert.equal(solver.chooseMove(board).direction, 1);
});

test('tiny search budgets still yield legal fallback moves', () => {
  const board = [2, 2, 4, 8, 16, 32, 0, 0, 2, 4, 8, 16, 32, 64, 128, 0];
  for (const nodeBudget of [1, 10, 100]) {
    const solver = new Solver({ profile: 'strong', maxDepth: 9, nodeBudget, timeBudgetMs: 0.001 });
    const result = solver.chooseMove(board);
    assert.ok(referenceMove(board, result.direction).moved, `fallback ${nodeBudget}`);
    assert.ok(Number.isFinite(result.value));
  }
});

test('a forced root move skips search without changing its legal direction', () => {
  const board = Object.freeze([
    8192, 4096, 2048, 1024,
    512, 256, 128, 64,
    32, 16, 8, 4,
    0, 0, 0, 0,
  ]);
  const original = Array.from(board);
  const legal = names.map((_, direction) => direction)
    .filter(direction => referenceMove(board, direction).moved);
  assert.deepEqual(legal, [2]);
  const result = new Solver({ profile: 'strong' }).chooseMove(board);
  assert.equal(result.direction, 2);
  assert.equal(result.name, 'down');
  assert.equal(result.nodes, 0);
  assert.equal(result.depth, 0);
  assert.equal(result.complete, true);
  assert.equal(result.targetReached, false);
  assert.ok(Number.isFinite(result.value));
  assert.deepEqual(Array.from(board), original);
});

test('transposition table size does not alter completed depth-three search', () => {
  const boards = [
    [2, 2, 4, 8, 16, 32, 64, 128, 2, 4, 8, 16, 32, 64, 128, 0],
    [0, 2, 2, 4, 4, 8, 16, 32, 64, 128, 256, 512, 2, 4, 8, 16],
    [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 8, 4, 2, 8, 0],
  ];
  for (const probabilityCutoff of [0, 0.01]) {
    const opts = { profile: 'fast', maxDepth: 3, probabilityCutoff, nodeBudget: 10000000, timeBudgetMs: 30000, iterative: false, adaptiveDepth: false };
    const uncached = new Solver({ ...opts, tableBits: 0 });
    const small = new Solver({ ...opts, tableBits: 10 });
    const large = new Solver({ ...opts, tableBits: 20 });
    for (const board of boards) {
      const a = small.chooseMove(board), b = large.chooseMove(board);
      const c = uncached.chooseMove(board);
      assert.equal(a.depth, 3);
      assert.equal(b.depth, 3);
      assert.equal(a.complete, true);
      assert.equal(b.complete, true);
      assert.equal(a.direction, b.direction);
      assert.ok(Math.abs(a.value - b.value) < 1e-8 * Math.max(1, Math.abs(a.value)), `cache value ${a.value} vs ${b.value}`);
      assert.equal(b.direction, c.direction);
      assert.equal(c.cacheHits, 0);
      assert.equal(c.depth, 3);
      assert.equal(c.complete, true);
      assert.ok(Math.abs(b.value - c.value) < 1e-8 * Math.max(1, Math.abs(c.value)), `uncached value ${c.value} vs ${b.value}`);
    }
  }
});

test('heuristic tables match a direct row-and-column formula', () => {
  const rng = seededRandom(55741);
  for (let sample = 0; sample < 1000; sample++) {
    const board = Array.from({ length: 16 }, () => {
      const rank = Math.floor(rng() * 16);
      return rank ? 2 ** rank : 0;
    });
    const [lo, hi] = _internals.pack(board);
    const actual = _internals.evaluatePacked(lo, hi), expected = referenceEvaluation(board);
    assert.ok(Math.abs(actual - expected) < 1e-8 * Math.max(1, Math.abs(expected)), `heuristic ${sample}: ${actual} vs ${expected}`);
  }
});

test('expectimax matches independent spawn enumeration and max-node oracle', () => {
  const boards = [
    [2, 2, 4, 8, 16, 32, 64, 128, 2, 4, 8, 16, 32, 64, 128, 0],
    [0, 2, 2, 4, 4, 8, 16, 32, 64, 128, 256, 512, 2, 4, 8, 16],
    [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 8, 4, 2, 8, 0],
    [4, 2048, 4, 4, 1024, 8192, 4096, 1024, 8192, 8, 4, 2, 128, 64, 8192, 8],
  ];
  for (const depth of [1, 2, 3]) {
    for (const probabilityCutoff of [0, 0.01]) {
      const solver = new Solver({ profile: 'fast', maxDepth: depth, iterative: false, adaptiveDepth: false,
        probabilityCutoff, tableBits: 12, nodeBudget: 10000000, timeBudgetMs: 30000 });
      for (const board of boards) {
        const actual = solver.chooseMove(board), expected = referenceSearch(board, depth, probabilityCutoff);
        assert.equal(actual.complete, true);
        // Independent summation orders can break mathematically equal direction ties
        // by a few floating-point ulps. The chosen direction must still be optimal.
        const chosenValue = expected.values.get(actual.direction);
        assert.ok(Number.isFinite(chosenValue) && Math.abs(chosenValue - expected.value) < 1e-8 * Math.max(1, Math.abs(expected.value)),
          `oracle direction depth ${depth}, cutoff ${probabilityCutoff}: ${chosenValue} vs ${expected.value}`);
        assert.ok(Math.abs(actual.value - expected.value) < 1e-8 * Math.max(1, Math.abs(expected.value)),
          `oracle depth ${depth}, cutoff ${probabilityCutoff}: ${actual.value} vs ${expected.value}`);
      }
    }
  }
});

test('UMD browser global and native ESM default import work', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('./expectimax2048.js'), 'utf8'), context);
  assert.equal(typeof context.Expectimax2048.Solver, 'function');
  const browserResult = context.Expectimax2048.move([2, 2, ...Array(14).fill(0)], 'left');
  assert.equal(browserResult.board[0], 4);
  const { spawnSync } = require('node:child_process');
  const esm = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import api from './expectimax2048.js'; if (typeof api.Solver !== 'function') process.exit(1);"],
  { cwd: __dirname, encoding: 'utf8' });
  assert.equal(esm.status, 0, esm.stderr);
});

console.log(`\n${checks} independent test groups passed in ${(performance.now() - started).toFixed(1)} ms.`);
