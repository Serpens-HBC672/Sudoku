import assert from "node:assert/strict";
import { instantiateCore, loadPosition, runDynamicAssumption } from "../bridge/assembly-core.mjs";
import { loadOracle } from "./load-oracle.mjs";
import { factIndex, loadBenchmarkCorpus } from "./benchmark-corpus.mjs";

const WASM_URL = new URL("../build/sudoku-techniques.wasm", import.meta.url);

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

function pickFacts(grid, masks, limit = 2) {
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
  return [facts[0], facts[facts.length - 1]];
}

function compare(meta, jsEnvelope, wasm) {
  const js = jsEnvelope.result;
  assert.equal(wasm.contradiction, !!js.contradiction, meta + ": contradiction mismatch");
  assert.equal(wasm.aborted, !!js.aborted, meta + ": aborted mismatch");
  assert.equal(wasm.budgetCalls, jsEnvelope.budgetCalls, meta + ": shared budget call-count mismatch");
  assert.deepEqual(wasm.trueFacts, oracleFactOrder(js.trueSet), meta + ": trueSet insertion-order mismatch");
  assert.deepEqual(wasm.falseFacts, oracleFactOrder(js.falseSet), meta + ": falseSet insertion-order mismatch");

  if (!js.contradiction && js.grid) {
    assert.deepEqual(flattenGrid(wasm.grid), flattenGrid(js.grid), meta + ": propagated grid mismatch");
  }
}

const oracle = await loadOracle();
const corpus = await loadBenchmarkCorpus();
const core = await instantiateCore(WASM_URL);

let comparisons = 0;
const budgetLimit = 64;

for (const testCase of corpus) {
  const masks = Array.from(oracle.candidateMasksForGrid(testCase.puzzle), Number);
  loadPosition(core, testCase.puzzle, masks);

  for (const { r, c, d } of pickFacts(testCase.puzzle, masks)) {
    for (const startTrue of [true, false]) {
      const js = oracle.propagateDynamicFromMasks(
        testCase.puzzle,
        masks,
        r,
        c,
        d,
        startTrue,
        budgetLimit,
      );
      const wasm = runDynamicAssumption(core, r, c, d, startTrue, budgetLimit);
      compare(
        "#" + testCase.id + " r" + (r + 1) + "c" + (c + 1) + "=" + d +
          " startTrue=" + startTrue + " budget=" + budgetLimit,
        js,
        wasm,
      );
      comparisons++;
    }
  }
}

console.log(
  "PASS dynamic propagation differential: " + comparisons +
    " JS↔WASM cases across " + corpus.length +
    " benchmark boards with shared budget limit " + budgetLimit + ".",
);
