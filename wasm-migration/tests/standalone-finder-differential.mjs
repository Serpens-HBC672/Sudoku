import assert from "node:assert/strict";
import {
  instantiateCore,
  loadPosition,
  loadGivenGrid,
  runStandaloneTechniqueFinder,
} from "../bridge/assembly-core.mjs";
import { loadOracle } from "./load-oracle.mjs";
import { loadBenchmarkCorpus } from "./benchmark-corpus.mjs";

const WASM_URL = new URL("../build/sudoku-techniques.wasm", import.meta.url);
const TECHNIQUES = [
  [0, "nakedSingle"],
  [1, "hiddenSingle"],
  [2, "lockedCandidate"],
  [3, "gsp"],
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
  [27, "xyChain"],
  [28, "aic"],
  [29, "niceLoop"],
  [30, "sueDeCoq"],
  [31, "fireworkTriple"],
  [32, "fireworkQuadruple"],
  [33, "fireworkWWing"],
  [34, "fireworkAlp"],
  [35, "pom"],
  [36, "alsXZ"],
  [37, "ahsXZ"],
  [38, "alsChain"],
  [39, "deathBlossom"],
  [40, "medusa3D"],
  [41, "tridagon"],
  [45, "tridagonForce"],
  [46, "skLoop"],
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
  loadGivenGrid(core, testCase.puzzle);
  for (const [id, key] of TECHNIQUES) {
    const jsFinding = oracle.findTechniqueFromMasks(
      key, testCase.puzzle, masks, testCase.puzzle, testCase.solution,
    );
    const wasmFinding = runStandaloneTechniqueFinder(core, id);
    if (key === "medusa3D" && jsFinding && !wasmFinding) {
      const diag = jsFinding.context.coloring.map(({ r, c, d }) => {
        const k = r * 81 + c * 9 + (d - 1);
        const degree = core.medusaFinderDebugAdjCount(k);
        const neighbors = Array.from({ length: Math.max(0, degree) }, (_, i) => core.medusaFinderDebugAdjAt(k, i));
        return { r, c, d, k, degree, neighbors };
      });
      console.error("MEDUSA_DIAG", JSON.stringify({ caseId: testCase.id, diag }));
    }
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
