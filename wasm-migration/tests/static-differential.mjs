import assert from "node:assert/strict";
import { instantiateCore, loadPosition, runStaticAssumption } from "../bridge/assembly-core.mjs";
import { loadOracle } from "./load-oracle.mjs";
import { factIndex, loadBenchmarkCorpus } from "./benchmark-corpus.mjs";

const WASM_URL = new URL("../build/sudoku-techniques.wasm", import.meta.url);

function popcount9(mask) {
  let x = mask & 0x1ff;
  let n = 0;
  while (x) {
    x &= x - 1;
    n++;
  }
  return n;
}

function oracleFactOrder(setLike) {
  const values = setLike?.values || [];
  return Array.from(values, (key) => {
    const [r, c, d] = String(key).split(",").map(Number);
    return factIndex(r, c, d);
  });
}

function flattenGrid(grid) {
  const out = [];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) out.push(Number(grid[r][c]));
  }
  return out;
}

function pickFacts(grid, masks, limit = 5) {
  const facts = [];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (grid[r][c] !== 0) continue;
      const mask = masks[r * 9 + c] & 0x1ff;
      for (let d = 1; d <= 9; d++) {
        if (mask & (1 << (d - 1))) facts.push({ r, c, d });
      }
    }
  }
  if (facts.length <= limit) return facts;

  const indexes = new Set([0, facts.length - 1]);
  for (let i = 1; i < limit - 1; i++) {
    indexes.add(Math.floor((i * (facts.length - 1)) / (limit - 1)));
  }
  return [...indexes].sort((a, b) => a - b).slice(0, limit).map((i) => facts[i]);
}

function makeTrimmedMasks(grid, solution, masks) {
  const out = masks.slice();
  for (let index = 0; index < 81; index++) {
    if (grid[Math.floor(index / 9)][index % 9] !== 0) continue;
    const mask = out[index] & 0x1ff;
    if (popcount9(mask) <= 1) continue;
    const correct = solution[Math.floor(index / 9)][index % 9];
    for (let d = 1; d <= 9; d++) {
      const bit = 1 << (d - 1);
      if (d !== correct && (mask & bit)) {
        out[index] = mask & ~bit;
        break;
      }
    }
    // Only trim a sparse deterministic subset. This exercises the
    // getCandsBase restriction without turning every case into an artificial
    // near-solved candidate state.
    index += 10;
  }
  return out;
}

function compareResult(meta, jsResult, wasmResult) {
  assert.equal(
    wasmResult.contradiction,
    !!jsResult.contradiction,
    `${meta}: contradiction mismatch`,
  );

  assert.deepEqual(
    wasmResult.trueFacts,
    oracleFactOrder(jsResult.trueSet),
    `${meta}: trueSet insertion order mismatch`,
  );
  assert.deepEqual(
    wasmResult.falseFacts,
    oracleFactOrder(jsResult.falseSet),
    `${meta}: falseSet insertion order mismatch`,
  );

  if (!jsResult.contradiction && jsResult.grid) {
    assert.deepEqual(
      flattenGrid(wasmResult.grid),
      flattenGrid(jsResult.grid),
      `${meta}: propagated grid mismatch`,
    );
  }
}

const oracle = await loadOracle();
const techniqueKeys = oracle.techniqueKeys();
assert.equal(techniqueKeys.length, 53, "DevVer migration oracle must expose exactly 53 techniques");

const corpus = await loadBenchmarkCorpus();
const core = await instantiateCore(WASM_URL);

let comparisons = 0;
for (const testCase of corpus) {
  const baselineMasks = Array.from(oracle.candidateMasksForGrid(testCase.puzzle), Number);
  for (const mask of baselineMasks) {
    assert.equal(mask & ~0x1ff, 0, `#${testCase.id}: candidate mask escaped 9 bits`);
  }

  const variants = [
    ["baseline", baselineMasks],
    ["trimmed", makeTrimmedMasks(testCase.puzzle, testCase.solution, baselineMasks)],
  ];

  for (const [variantName, masks] of variants) {
    loadPosition(core, testCase.puzzle, masks);
    for (const { r, c, d } of pickFacts(testCase.puzzle, masks)) {
      for (const startTrue of [true, false]) {
        const jsResult = oracle.propagateStaticFromMasks(
          testCase.puzzle,
          masks,
          r,
          c,
          d,
          startTrue,
        );
        const wasmResult = runStaticAssumption(core, r, c, d, startTrue);
        compareResult(
          `#${testCase.id} ${variantName} r${r + 1}c${c + 1}=${d} startTrue=${startTrue}`,
          jsResult,
          wasmResult,
        );
        comparisons++;
      }
    }
  }
}

console.log(
  `PASS static propagation differential: ${comparisons} JS↔WASM assumption cases across ${corpus.length} benchmark boards; 53-technique registry confirmed.`,
);
