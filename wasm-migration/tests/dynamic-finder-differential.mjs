import assert from "node:assert/strict";
import {
  instantiateCore,
  loadPosition,
  runDynamicNishioFinder,
  runDynamicUnaryFinder,
} from "../bridge/assembly-core.mjs";
import { loadOracle } from "./load-oracle.mjs";
import { loadBenchmarkCorpus } from "./benchmark-corpus.mjs";

const WASM_URL = new URL("../build/sudoku-techniques.wasm", import.meta.url);

function hostClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function compareEnvelope(meta, jsEnvelope, wasmEnvelope) {
  assert.equal(
    wasmEnvelope.budgetCalls,
    jsEnvelope.budgetCalls,
    meta + ": shared budget call-count mismatch",
  );
  assert.deepEqual(
    wasmEnvelope.finding,
    hostClone(jsEnvelope.finding),
    meta + ": raw Finding mismatch",
  );
}

const oracle = await loadOracle();
const corpus = await loadBenchmarkCorpus();
const core = await instantiateCore(WASM_URL);
const budgetLimit = 64;

let comparisons = 0;
for (const testCase of corpus) {
  const masks = Array.from(oracle.candidateMasksForGrid(testCase.puzzle), Number);
  loadPosition(core, testCase.puzzle, masks);

  const jsNishio = oracle.findDynamicNishioFromMasks(testCase.puzzle, masks, budgetLimit);
  const wasmNishio = runDynamicNishioFinder(core, budgetLimit);
  compareEnvelope("#" + testCase.id + " Dynamic Nishio budget=" + budgetLimit, jsNishio, wasmNishio);
  comparisons++;

  const jsUnary = oracle.findDynamicUnaryFromMasks(testCase.puzzle, masks, budgetLimit);
  const wasmUnary = runDynamicUnaryFinder(core, budgetLimit);
  compareEnvelope("#" + testCase.id + " Dynamic Unary budget=" + budgetLimit, jsUnary, wasmUnary);
  comparisons++;
}

console.log(
  "PASS dynamic finder differential: " + comparisons +
    " JS↔WASM Dynamic Nishio/Unary first-match cases across " +
    corpus.length + " benchmark boards with shared budget limit " + budgetLimit + ".",
);
