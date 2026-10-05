/*
 * expectimax2048.js — dependency-free standard 4x4 2048 solver.
 * MIT License. Copyright (c) 2026.
 * Row heuristic and bitboard/table approach derived from nneonneo/2048-ai,
 * Copyright (c) 2014-2019 Robert Xiao and contributors (MIT; see LICENSE).
 * Direction contract: 0=up, 1=right, 2=down, 3=left. Board: 16 tile values.
 * The search is terminal on reaching its target (default 32768).
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Expectimax2048 = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DIRECTIONS = Object.freeze(['up', 'right', 'down', 'left']);
  const PROFILES = Object.freeze({
    fast: Object.freeze({maxDepth: 5, probabilityCutoff: 0.001, nodeBudget: 100000}),
    balanced: Object.freeze({maxDepth: 8, probabilityCutoff: 0.0001, nodeBudget: 1000000}),
    strong: Object.freeze({maxDepth: 10, probabilityCutoff: 0.00005, nodeBudget: 8000000})
  });
  let ready = false;
  let LEFT, RIGHT, UP_LO, UP_HI, DOWN_LO, DOWN_HI, HEUR, EMPTY, RANKS, MAX;
  let outLo = 0, outHi = 0;
  const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
  const ABORT = Object.freeze({budgetExceeded: true});
  const WIN = 1000000000;
  const LOSS = -1000000000;

  function reverseRow(row) {
    return ((row & 15) << 12) | ((row & 240) << 4) | ((row >>> 4) & 240) | (row >>> 12);
  }
  function initTables() {
    if (ready) return;
    LEFT = new Uint16Array(65536); RIGHT = new Uint16Array(65536);
    UP_LO = new Uint32Array(65536); UP_HI = new Uint32Array(65536);
    DOWN_LO = new Uint32Array(65536); DOWN_HI = new Uint32Array(65536);
    HEUR = new Float64Array(65536); EMPTY = new Uint8Array(65536);
    RANKS = new Uint16Array(65536); MAX = new Uint8Array(65536);
    const pow4 = Array.from({length: 16}, (_, i) => i ** 4);
    const pow35 = Array.from({length: 16}, (_, i) => i ** 3.5);
    for (let row = 0; row < 65536; row++) {
      const a = [row & 15, (row >>> 4) & 15, (row >>> 8) & 15, row >>> 12];
      let empty = 0, sum = 0, ranks = 0, max = 0, merges = 0, prev = 0, count = 0;
      let inc = 0, dec = 0;
      for (let i = 0; i < 4; i++) {
        const v = a[i]; sum += pow35[v]; ranks |= 1 << v; max = Math.max(max, v);
        if (!v) empty++;
        else {
          if (v === prev) count++;
          else if (count) { merges += count + 1; count = 0; }
          prev = v;
        }
        if (i) {
          const delta = pow4[a[i - 1]] - pow4[v];
          if (delta > 0) dec += delta; else inc -= delta;
        }
      }
      if (count) merges += count + 1;
      HEUR[row] = 200000 + 270 * empty + 700 * merges - 47 * Math.min(inc, dec) - 11 * sum;
      EMPTY[row] = empty; RANKS[row] = ranks; MAX[row] = max;
      const compact = a.filter(Boolean), result = [];
      for (let i = 0; i < compact.length; i++) {
        // Rank 15 is search-terminal; it will never be expanded by Solver.
        if (compact[i] === compact[i + 1] && compact[i] < 15) result.push(compact[i++] + 1);
        else result.push(compact[i]);
      }
      while (result.length < 4) result.push(0);
      const left = result[0] | (result[1] << 4) | (result[2] << 8) | (result[3] << 12);
      LEFT[row] = left;
      RIGHT[reverseRow(row)] = reverseRow(left);
    }
    for (let row = 0; row < 65536; row++) {
      let delta = row ^ LEFT[row];
      UP_LO[row] = (delta & 15) | ((delta & 240) << 12);
      UP_HI[row] = ((delta >>> 8) & 15) | ((delta & 61440) << 4);
      delta = row ^ RIGHT[row];
      DOWN_LO[row] = (delta & 15) | ((delta & 240) << 12);
      DOWN_HI[row] = ((delta >>> 8) & 15) | ((delta & 61440) << 4);
    }
    ready = true;
  }
  function validate(board) {
    if (!Array.isArray(board) && !ArrayBuffer.isView(board)) throw new TypeError('Board must be a row-major array of 16 tile values.');
    if (board.length !== 16) throw new RangeError('Board must contain exactly 16 cells.');
    for (const v of board) {
      if (!Number.isSafeInteger(v) || v < 0 || (v !== 0 && (v < 2 || !Number.isInteger(Math.log2(v)) || 2 ** Math.log2(v) !== v)))
        throw new RangeError('Tiles must be zero or exact powers of two from 2 through 2^52.');
    }
  }
  function directionNumber(direction) {
    const d = typeof direction === 'string' ? DIRECTIONS.indexOf(direction.toLowerCase()) : direction;
    if (!Number.isInteger(d) || d < 0 || d > 3) throw new RangeError('Direction must be 0..3 or up/right/down/left.');
    return d;
  }
  function pack(board) {
    validate(board); let lo = 0, hi = 0;
    for (let i = 0; i < 16; i++) {
      const rank = board[i] === 0 ? 0 : Math.log2(board[i]);
      if (rank > 15) throw new RangeError('Packed search supports tiles through 32768; larger boards are already target-terminal.');
      if (i < 8) lo |= rank << (i * 4); else hi |= rank << ((i - 8) * 4);
    }
    return [lo >>> 0, hi >>> 0];
  }
  function unpack(lo, hi) {
    const board = new Array(16);
    for (let i = 0; i < 16; i++) {
      const rank = (i < 8 ? lo >>> (i * 4) : hi >>> ((i - 8) * 4)) & 15;
      board[i] = rank ? 2 ** rank : 0;
    }
    return board;
  }
  // Allocation-free hot path. Outputs must be copied before recursive calls.
  function fastMove(lo, hi, d) {
    if (d === 1 || d === 3) {
      const t = d === 3 ? LEFT : RIGHT;
      outLo = (t[lo & 65535] | (t[lo >>> 16] << 16)) >>> 0;
      outHi = (t[hi & 65535] | (t[hi >>> 16] << 16)) >>> 0;
    } else {
      const c0 = (lo & 15) | ((lo >>> 12) & 240) | ((hi << 8) & 3840) | ((hi >>> 4) & 61440);
      const c1 = ((lo >>> 4) & 15) | ((lo >>> 16) & 240) | ((hi << 4) & 3840) | ((hi >>> 8) & 61440);
      const c2 = ((lo >>> 8) & 15) | ((lo >>> 20) & 240) | (hi & 3840) | ((hi >>> 12) & 61440);
      const c3 = ((lo >>> 12) & 15) | ((lo >>> 24) & 240) | ((hi >>> 4) & 3840) | ((hi >>> 16) & 61440);
      const tl = d === 0 ? UP_LO : DOWN_LO, th = d === 0 ? UP_HI : DOWN_HI;
      outLo = (lo ^ tl[c0] ^ (tl[c1] << 4) ^ (tl[c2] << 8) ^ (tl[c3] << 12)) >>> 0;
      outHi = (hi ^ th[c0] ^ (th[c1] << 4) ^ (th[c2] << 8) ^ (th[c3] << 12)) >>> 0;
    }
  }
  function movePacked(lo, hi, d) { initTables(); fastMove(lo >>> 0, hi >>> 0, directionNumber(d)); return [outLo, outHi]; }
  function evaluatePacked(lo, hi) {
    const c0 = (lo & 15) | ((lo >>> 12) & 240) | ((hi << 8) & 3840) | ((hi >>> 4) & 61440);
    const c1 = ((lo >>> 4) & 15) | ((lo >>> 16) & 240) | ((hi << 4) & 3840) | ((hi >>> 8) & 61440);
    const c2 = ((lo >>> 8) & 15) | ((lo >>> 20) & 240) | (hi & 3840) | ((hi >>> 12) & 61440);
    const c3 = ((lo >>> 12) & 15) | ((lo >>> 24) & 240) | ((hi >>> 4) & 3840) | ((hi >>> 16) & 61440);
    return HEUR[lo & 65535] + HEUR[lo >>> 16] + HEUR[hi & 65535] + HEUR[hi >>> 16] + HEUR[c0] + HEUR[c1] + HEUR[c2] + HEUR[c3];
  }
  function emptyCount(lo, hi) { return EMPTY[lo & 65535] + EMPTY[lo >>> 16] + EMPTY[hi & 65535] + EMPTY[hi >>> 16]; }
  function maxRank(lo, hi) { return Math.max(MAX[lo & 65535], MAX[lo >>> 16], MAX[hi & 65535], MAX[hi >>> 16]); }

  class Solver {
    constructor(options = {}) {
      const profile = options.profile || 'balanced';
      if (!PROFILES[profile]) throw new RangeError('Unknown profile: ' + profile);
      this.options = Object.assign({profile, tableBits: 18, target: 32768, timeBudgetMs: 0, iterative: true, adaptiveDepth: true}, PROFILES[profile], options);
      const o = this.options;
      for (const key of ['maxDepth', 'nodeBudget', 'tableBits']) if (!Number.isInteger(o[key])) throw new RangeError(key + ' must be an integer.');
      if (o.maxDepth < 1 || o.maxDepth > 16) throw new RangeError('maxDepth must be 1..16.');
      if (o.nodeBudget < 1) throw new RangeError('nodeBudget must be positive.');
      if (o.tableBits < 0 || o.tableBits > 24) throw new RangeError('tableBits must be 0..24; zero disables caching.');
      if (!Number.isFinite(o.probabilityCutoff) || o.probabilityCutoff < 0 || o.probabilityCutoff >= 1) throw new RangeError('probabilityCutoff must be in [0,1).');
      if (!Number.isFinite(o.timeBudgetMs) || o.timeBudgetMs < 0) throw new RangeError('timeBudgetMs must be nonnegative.');
      if (!Number.isInteger(Math.log2(o.target)) || o.target < 4 || o.target > 32768) throw new RangeError('target must be a power of two from 4 through 32768.');
      initTables(); this.targetRank = Math.log2(o.target);
      const n = o.tableBits ? 2 ** o.tableBits : 0; this.mask = n - 1;
      // Direct-mapped exact-key cache: collisions replace entries, never invent hits.
      this.ttLo = new Uint32Array(n); this.ttHi = new Uint32Array(n); this.ttGeneration = new Uint32Array(n);
      this.ttDepth = new Uint8Array(n); this.ttProbability = new Float64Array(n); this.ttValue = new Float64Array(n);
      this.generation = 0;
    }
    _touch() {
      if (++this.nodes > this.options.nodeBudget) throw ABORT;
      if (this.deadline && (this.nodes & 2047) === 0 && now() >= this.deadline) throw ABORT;
    }
    _chance(lo, hi, depth, probability) {
      this._touch();
      if (maxRank(lo, hi) >= this.targetRank) return WIN;
      if (depth <= 0 || probability < this.options.probabilityCutoff) return evaluatePacked(lo, hi);
      // At depth one all children end at depth zero; after the cutoff check,
      // their value is independent of path probability. This is an exact reuse.
      const cacheProbability = depth === 1 ? 1 : probability;
      let slot = -1;
      if (this.mask >= 0) {
        slot = (Math.imul(lo ^ (hi >>> 16), 0x9e3779b1) ^ Math.imul(hi ^ (lo >>> 16), 0x85ebca6b) ^ depth) & this.mask;
        // Probability affects pruning, so it is part of the exact cache key.
        if (this.ttGeneration[slot] === this.generation && this.ttLo[slot] === lo && this.ttHi[slot] === hi && this.ttDepth[slot] === depth && this.ttProbability[slot] === cacheProbability) {
          this.cacheHits++; return this.ttValue[slot];
        }
      }
      const count = emptyCount(lo, hi);
      if (!count) return this._max(lo, hi, depth - 1, probability);
      const p2 = 0.9 * probability / count, p4 = 0.1 * probability / count;
      let sum = 0;
      for (let i = 0; i < 8; i++) {
        const shift = i * 4;
        if (((lo >>> shift) & 15) === 0) {
          sum += 0.9 * this._max((lo | (1 << shift)) >>> 0, hi, depth - 1, p2);
          sum += 0.1 * this._max((lo | (2 << shift)) >>> 0, hi, depth - 1, p4);
        }
        if (((hi >>> shift) & 15) === 0) {
          sum += 0.9 * this._max(lo, (hi | (1 << shift)) >>> 0, depth - 1, p2);
          sum += 0.1 * this._max(lo, (hi | (2 << shift)) >>> 0, depth - 1, p4);
        }
      }
      const value = sum / count;
      if (slot >= 0) {
        this.ttLo[slot] = lo; this.ttHi[slot] = hi; this.ttDepth[slot] = depth;
        this.ttProbability[slot] = cacheProbability; this.ttValue[slot] = value; this.ttGeneration[slot] = this.generation;
      }
      return value;
    }
    _max(lo, hi, depth, probability) {
      this._touch(); let best = -Infinity;
      // Even at a truncated horizon check all legal moves: a dead board has value zero.
      for (let d = 0; d < 4; d++) {
        fastMove(lo, hi, d); const nl = outLo, nh = outHi;
        if (nl === lo && nh === hi) continue;
        const value = this._chance(nl, nh, depth, probability);
        if (value > best) best = value;
        if (best === WIN) break; // No child can exceed the terminal target utility.
      }
      return best === -Infinity ? LOSS : best;
    }
    chooseMove(board) {
      validate(board); const start = now();
      if (board.some(v => v >= this.options.target)) return {direction: null, name: null, value: WIN, depth: 0, nodes: 0, cacheHits: 0, elapsedMs: now() - start, complete: true, targetReached: true};
      const [lo, hi] = pack(board);
      this.nodes = 0; this.cacheHits = 0; this.deadline = this.options.timeBudgetMs ? start + this.options.timeBudgetMs : 0;
      this.generation = (this.generation + 1) >>> 0;
      if (!this.generation) { this.ttGeneration.fill(0); this.generation = 1; }
      const candidates = [];
      for (let d = 0; d < 4; d++) {
        fastMove(lo, hi, d); const nl = outLo, nh = outHi;
        if (nl !== lo || nh !== hi) candidates.push({direction: d, lo: nl, hi: nh, value: maxRank(nl, nh) >= this.targetRank ? WIN : evaluatePacked(nl, nh)});
      }
      if (!candidates.length) return {direction: null, name: null, value: 0, depth: 0, nodes: 0, cacheHits: 0, elapsedMs: now() - start, complete: true, targetReached: false};
      if (candidates.length === 1) {
        const only = candidates[0];
        return {direction: only.direction, name: DIRECTIONS[only.direction], value: only.value, depth: 0, nodes: 0, cacheHits: 0, elapsedMs: now() - start, complete: true, targetReached: false};
      }
      candidates.sort((a, b) => b.value - a.value || a.direction - b.direction);
      let best = candidates[0], bestValue = best.value, completedDepth = 0, complete = true;
      let limit = this.options.maxDepth;
      if (this.options.adaptiveDepth) {
        let bits = (RANKS[lo & 65535] | RANKS[lo >>> 16] | RANKS[hi & 65535] | RANKS[hi >>> 16]) >>> 1, distinct = 0;
        while (bits) { bits &= bits - 1; distinct++; }
        limit = Math.min(limit, Math.max(3, distinct - 2));
      }
      const firstDepth = this.options.iterative ? 1 : limit;
      if (bestValue !== WIN) {
        for (let depth = firstDepth; depth <= limit; depth++) {
          let iterationBest = null, iterationValue = -Infinity;
          const values = [];
          try {
            for (const candidate of candidates) {
              const value = this._chance(candidate.lo, candidate.hi, depth, 1);
              values.push(value);
              if (value > iterationValue || (value === iterationValue && candidate.direction < iterationBest.direction)) {
                iterationValue = value; iterationBest = candidate;
              }
            }
          } catch (error) {
            if (error !== ABORT) throw error;
            complete = false; break; // Never compare differently searched roots.
          }
          best = iterationBest; bestValue = iterationValue; completedDepth = depth;
          for (let i = 0; i < candidates.length; i++) candidates[i].value = values[i];
          candidates.sort((a, b) => b.value - a.value || a.direction - b.direction);
          if (bestValue === WIN) break;
        }
      }
      return {direction: best.direction, name: DIRECTIONS[best.direction], value: bestValue, depth: completedDepth, nodes: this.nodes, cacheHits: this.cacheHits, elapsedMs: now() - start, complete, targetReached: false};
    }
  }
  // Public game engine: exact numeric moves, deliberately independent of packed search.
  function move(board, direction) {
    validate(board); const d = directionNumber(direction), result = Array.from(board); let score = 0;
    for (let lane = 0; lane < 4; lane++) {
      const ids = [];
      for (let k = 0; k < 4; k++) ids.push(d === 0 ? k * 4 + lane : d === 1 ? lane * 4 + 3 - k : d === 2 ? (3 - k) * 4 + lane : lane * 4 + k);
      const values = ids.map(i => board[i]).filter(Boolean), line = [];
      for (let i = 0; i < values.length; i++) {
        if (values[i] === values[i + 1]) {
          const merged = values[i] * 2;
          if (!Number.isSafeInteger(merged)) throw new RangeError('Merged tile exceeds safe integer range.');
          line.push(merged); score += merged; i++;
        } else line.push(values[i]);
      }
      for (let k = 0; k < 4; k++) result[ids[k]] = line[k] || 0;
    }
    return {board: result, moved: result.some((v, i) => v !== board[i]), score};
  }
  function createRng(seed) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Seed must be a uint32 integer.');
    let state = seed >>> 0;
    return function () {
      state = (state + 0x6D2B79F5) >>> 0;
      let x = Math.imul(state ^ (state >>> 15), state | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  function spawn(board, rng = Math.random) {
    validate(board); const empty = [];
    for (let i = 0; i < 16; i++) if (!board[i]) empty.push(i);
    if (!empty.length) return null;
    const rPosition = rng(), rValue = rng();
    if (!Number.isFinite(rPosition) || rPosition < 0 || rPosition >= 1 || !Number.isFinite(rValue) || rValue < 0 || rValue >= 1) throw new RangeError('RNG must return numbers in [0,1).');
    const index = empty[Math.floor(rPosition * empty.length)], value = rValue < 0.9 ? 2 : 4;
    const result = Array.from(board); result[index] = value;
    return {board: result, index, value};
  }
  function emptyBoard() { return new Array(16).fill(0); }
  function initialBoard(rng = Math.random) { return spawn(spawn(emptyBoard(), rng).board, rng).board; }
  return Object.freeze({Solver, move, spawn, createRng, emptyBoard, initialBoard, DIRECTIONS, PROFILES,
    _internals: Object.freeze({pack, unpack, movePacked, evaluatePacked: (lo, hi) => {initTables(); return evaluatePacked(lo, hi);}, initTables})});
});
