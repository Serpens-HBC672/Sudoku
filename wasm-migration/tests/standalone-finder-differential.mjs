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
  [47, "msls"],
  [48, "juniorExocet"],
  [49, "seniorExocet"],
];

function firstSemanticDifference(a, b, path = "$") {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b) return { path, actual: a, expected: b, kind: "type" };
  if (a == null || b == null || typeof a !== "object") {
    return { path, actual: a, expected: b, kind: "value", actualIsNegativeZero: Object.is(a, -0), expectedIsNegativeZero: Object.is(b, -0) };
  }
  const ak = Reflect.ownKeys(a);
  const bk = Reflect.ownKeys(b);
  if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) {
    return { path, actualKeys: ak, expectedKeys: bk, kind: "keys" };
  }
  for (const k of ak) {
    const diff = firstSemanticDifference(a[k], b[k], path + "." + String(k));
    if (diff) return diff;
  }
  return { path, kind: "prototype", actualPrototype: Object.getPrototypeOf(a)?.constructor?.name, expectedPrototype: Object.getPrototypeOf(b)?.constructor?.name };
}

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
  loadPosition(core, testCase.puzzle, masks, testCase.puzzle);
  for (const [id, key] of TECHNIQUES) {
    const jsFinding = oracle.findTechniqueFromMasks(
      key, testCase.puzzle, masks, testCase.puzzle, testCase.solution,
    );
    let rawWasmFinding;
    try {
      rawWasmFinding = runStandaloneTechniqueFinder(core, id);
    } catch (error) {
      console.error("STANDALONE_CRASH", JSON.stringify({ caseId: testCase.id, id, key }));
      throw error;
    }
    const wasmFinding =
      key === "juniorExocet" || key === "seniorExocet"
        ? hostClone(oracle.validateFindingAgainstSolution(rawWasmFinding, testCase.solution))
        : rawWasmFinding;
    const expectedFinding = hostClone(jsFinding);
    try {
      assert.deepEqual(
        wasmFinding,
        expectedFinding,
        "#" + testCase.id + " " + key + ": raw Finding mismatch",
      );
    } catch (error) {
      console.error("FINDING_DIFF", JSON.stringify(firstSemanticDifference(wasmFinding, expectedFinding)));
      throw error;
    }
    if (jsFinding) positive.set(key, positive.get(key) + 1);
    comparisons++;
  }
}

console.log(
  "PASS standalone finder differential: " + comparisons +
    " JS↔WASM comparisons across " + corpus.length +
    " benchmark starts; positive findings=" + JSON.stringify(Object.fromEntries(positive)) + ".",
);
