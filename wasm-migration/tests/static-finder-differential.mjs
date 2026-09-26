import assert from "node:assert/strict";
import {
  instantiateCore,
  loadPosition,
  runStaticNishioFinder,
  runStaticUnaryFinder,
  runStaticMultipleFinder,
} from "../bridge/assembly-core.mjs";
import { loadOracle } from "./load-oracle.mjs";
import { loadBenchmarkCorpus } from "./benchmark-corpus.mjs";

const WASM_URL = new URL("../build/sudoku-techniques.wasm", import.meta.url);
const RUNNERS = [
  ["unaryChain", runStaticUnaryFinder],
  ["nishioChain", runStaticNishioFinder],
  ["multipleChain", runStaticMultipleFinder],
];

function hostClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

const oracle = await loadOracle();
const corpus = await loadBenchmarkCorpus();
const core = await instantiateCore(WASM_URL);
const positive = Object.fromEntries(RUNNERS.map(([key]) => [key, 0]));
let comparisons = 0;

for (const testCase of corpus) {
  const masks = Array.from(oracle.candidateMasksForGrid(testCase.puzzle), Number);
  loadPosition(core, testCase.puzzle, masks);
  for (const [key, runner] of RUNNERS) {
    const jsFinding = oracle.findTechniqueFromMasks(
      key, testCase.puzzle, masks, testCase.puzzle, testCase.solution,
    );
    const wasmFinding = runner(core);
    assert.deepEqual(
      wasmFinding,
      hostClone(jsFinding),
      "#" + testCase.id + " " + key + ": raw Finding mismatch",
    );
    if (jsFinding) positive[key]++;
    comparisons++;
  }
}

console.log(
  "PASS static forcing finder differential: " + comparisons +
  " JS↔WASM comparisons across " + corpus.length +
  " benchmark starts; positive findings=" + JSON.stringify(positive) + ".",
);
