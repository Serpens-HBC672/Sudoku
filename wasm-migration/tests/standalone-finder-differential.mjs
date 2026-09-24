import assert from "node:assert/strict";
import {
  instantiateCore,
  loadPosition,
  runStandaloneTechniqueFinder,
} from "../bridge/assembly-core.mjs";
import { loadOracle } from "./load-oracle.mjs";
import { loadBenchmarkCorpus } from "./benchmark-corpus.mjs";

const WASM_URL = new URL("../build/sudoku-techniques.wasm", import.meta.url);
const TECHNIQUES = [
  [0, "nakedSingle"],
  [1, "hiddenSingle"],
  [2, "lockedCandidate"],
  [4, "nakedPair"],
  [5, "hiddenPair"],
  [6, "nakedTriple"],
  [7, "hiddenTriple"],
  [8, "nakedQuad"],
  [9, "hiddenQuad"],
  [10, "xWing"],
  [11, "swordfish"],
  [12, "skyscraper"],
  [13, "twoStringKite"],
  [14, "emptyRectangle"],
  [15, "jellyfish"],
  [16, "squirmbagFish"],
  [17, "finnedXWing"],
  [18, "finnedSwordfish"],
  [19, "finnedJellyfish"],
  [20, "uniqueRectangleType1"],
  [21, "uniqueRectangleType2"],
  [22, "hiddenUniqueRectangle"],
  [23, "bugPlusOne"],
  [24, "xyzWing"],
  [25, "wWing"],
  [26, "wxyzWing"],
];

function hostClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

const oracle = await loadOracle();
const corpus = await loadBenchmarkCorpus();
const core = await instantiateCore(WASM_URL);
const positive = new Map(TECHNIQUES.map(([, key]) => [key, 0]));
let comparisons = 0;

for (const testCase of corpus) {
  const masks = Array.from(oracle.candidateMasksForGrid(testCase.puzzle), Number);
  loadPosition(core, testCase.puzzle, masks);
  for (const [id, key] of TECHNIQUES) {
    const jsFinding = oracle.findTechniqueFromMasks(
      key, testCase.puzzle, masks, testCase.puzzle, testCase.solution,
    );
    const wasmFinding = runStandaloneTechniqueFinder(core, id);
    assert.deepEqual(
      wasmFinding,
      hostClone(jsFinding),
      "#" + testCase.id + " " + key + ": raw Finding mismatch",
    );
    if (jsFinding) positive.set(key, positive.get(key) + 1);
    comparisons++;
  }
}

console.log(
  "PASS standalone finder differential: " + comparisons +
    " JS↔WASM comparisons across " + corpus.length +
    " benchmark starts; positive findings=" + JSON.stringify(Object.fromEntries(positive)) + ".",
);
