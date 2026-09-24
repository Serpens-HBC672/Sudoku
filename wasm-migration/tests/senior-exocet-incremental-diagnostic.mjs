import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  instantiateCore,
  loadPosition,
  loadGivenGrid,
  runStandaloneTechniqueFinder,
} from "../bridge/assembly-core.mjs";
import { loadOracle } from "./load-oracle.mjs";
import { loadBenchmarkCorpus } from "./benchmark-corpus.mjs";

const TECHNIQUES = [
  [0,"nakedSingle"],[1,"hiddenSingle"],[2,"lockedCandidate"],[3,"gsp"],
  [4,"nakedPair"],[5,"hiddenPair"],[6,"nakedTriple"],[7,"hiddenTriple"],
  [8,"nakedQuad"],[9,"hiddenQuad"],[10,"xWing"],[11,"swordfish"],
  [12,"skyscraper"],[13,"twoStringKite"],[14,"emptyRectangle"],[15,"jellyfish"],
  [16,"squirmbagFish"],[17,"finnedXWing"],[18,"finnedSwordfish"],[19,"finnedJellyfish"],
  [20,"uniqueRectangleType1"],[21,"uniqueRectangleType2"],[22,"hiddenUniqueRectangle"],
  [23,"bugPlusOne"],[24,"xyzWing"],[25,"wWing"],[26,"wxyzWing"],[27,"xyChain"],
  [28,"aic"],[29,"niceLoop"],[30,"sueDeCoq"],[31,"fireworkTriple"],
  [32,"fireworkQuadruple"],[33,"fireworkWWing"],[34,"fireworkAlp"],[35,"pom"],
  [36,"alsXZ"],[37,"ahsXZ"],[38,"alsChain"],[39,"deathBlossom"],[40,"medusa3D"],
  [41,"tridagon"],[45,"tridagonForce"],[46,"skLoop"],[47,"msls"],
  [48,"juniorExocet"],[49,"seniorExocet"],
];
const TARGET_CASE = 4;
const TARGET_ID = 49;
const TARGET_KEY = "seniorExocet";
const EXPECTED_ORDINAL = TECHNIQUES.length * TARGET_CASE; // 188, 1-based
const mode = process.argv[2];
const wasmArg = process.argv[3] || "../build/sudoku-techniques.wasm";
if (!["capture","fresh","accumulated"].includes(mode)) {
  throw new Error("usage: node tests/senior-exocet-incremental-diagnostic.mjs capture|fresh|accumulated [wasm]");
}

const wasmPath = new URL(wasmArg, import.meta.url);
const outDir = resolve("senior-exocet-diagnostic-results");
await mkdir(outDir, { recursive: true });

const oracle = await loadOracle();
const corpus = await loadBenchmarkCorpus();
const target = corpus.find((x) => x.id === TARGET_CASE);
if (!target) throw new Error("benchmark #4 missing");
const targetMasks = Array.from(oracle.candidateMasksForGrid(target.puzzle), Number);
const targetJsFinding = oracle.findTechniqueFromMasks(
  TARGET_KEY, target.puzzle, targetMasks, target.puzzle, target.solution,
);

function memory(core) {
  const bytes = core.memory.buffer.byteLength;
  return { bytes, pages: bytes / 65536 };
}
function hostClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
function normalizeForSuite(key, raw, solution) {
  return key === "juniorExocet" || key === "seniorExocet"
    ? hostClone(oracle.validateFindingAgainstSolution(raw, solution))
    : raw;
}
function summarizeError(error, core) {
  return {
    name: error?.name ?? null,
    message: String(error?.message || error),
    stack: String(error?.stack || ""),
    memoryWhenCaught: core ? memory(core) : null,
  };
}
async function emit(name, data) {
  await writeFile(resolve(outDir, name), JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log("SENIOR_EXOCET_DIAG " + JSON.stringify(data));
}

const captured = {
  caseId: target.id,
  caseName: target.name,
  grid: target.puzzle.flat().join(""),
  givens: target.puzzle,
  beforeMasks: targetMasks,
  solution: target.solution.flat().join(""),
  techniqueId: TARGET_ID,
  techniqueKey: TARGET_KEY,
  expectedInvocationOrdinal: EXPECTED_ORDINAL,
  jsOracleFinding: hostClone(targetJsFinding),
};

if (mode === "capture") {
  await emit("capture.json", captured);
  process.exit(0);
}

if (mode === "fresh") {
  const core = await instantiateCore(wasmPath);
  const beforeLoad = memory(core);
  loadPosition(core, target.puzzle, targetMasks);
  loadGivenGrid(core, target.puzzle);
  const afterLoad = memory(core);
  const beforeCall = memory(core);
  let raw = null, error = null, afterCall = null;
  try {
    raw = runStandaloneTechniqueFinder(core, TARGET_ID);
    afterCall = memory(core);
  } catch (e) {
    error = summarizeError(e, core);
  }
  const normalized = error ? null : normalizeForSuite(TARGET_KEY, raw, target.solution);
  const result = {
    ...captured,
    mode:"fresh",
    memoryBeforeLoad:beforeLoad,
    memoryAfterLoad:afterLoad,
    memoryBeforeCall:beforeCall,
    memoryAfterCall:afterCall,
    rawWasmFinding:hostClone(raw),
    normalizedWasmFinding:hostClone(normalized),
    exactOracleParity:error ? false : (()=>{ try { assert.deepEqual(normalized, hostClone(targetJsFinding)); return true; } catch { return false; } })(),
    error,
  };
  await emit("fresh.json", result);
  process.exit(error ? 2 : 0);
}

const core = await instantiateCore(wasmPath);
let ordinal = 0;
let targetBefore = null;
let targetRaw = null;
let targetError = null;
let targetAfter = null;

outer:
for (const testCase of corpus) {
  if (testCase.id > TARGET_CASE) break;
  const masks = Array.from(oracle.candidateMasksForGrid(testCase.puzzle), Number);
  loadPosition(core, testCase.puzzle, masks);
  loadGivenGrid(core, testCase.puzzle);

  for (const [id,key] of TECHNIQUES) {
    ordinal++;
    const jsFinding = oracle.findTechniqueFromMasks(
      key, testCase.puzzle, masks, testCase.puzzle, testCase.solution,
    );

    if (testCase.id === TARGET_CASE && id === TARGET_ID) {
      assert.equal(ordinal, EXPECTED_ORDINAL);
      assert.deepEqual(masks, targetMasks);
      targetBefore = memory(core);
      try {
        targetRaw = runStandaloneTechniqueFinder(core, id);
        targetAfter = memory(core);
      } catch (e) {
        targetError = summarizeError(e, core);
      }
      break outer;
    }

    const raw = runStandaloneTechniqueFinder(core, id);
    const normalized = normalizeForSuite(key, raw, testCase.solution);
    assert.deepEqual(
      normalized,
      hostClone(jsFinding),
      "#" + testCase.id + " " + key + " mismatch before target ordinal " + ordinal,
    );
  }
}

assert.equal(ordinal, EXPECTED_ORDINAL, "target invocation ordinal mismatch");
const targetNormalized = targetError ? null : normalizeForSuite(TARGET_KEY, targetRaw, target.solution);
const exactOracleParity = targetError ? false : (()=> {
  try { assert.deepEqual(targetNormalized, hostClone(targetJsFinding)); return true; } catch { return false; }
})();

await emit("accumulated.json", {
  ...captured,
  mode:"accumulated",
  exactPrecedingStandaloneSuiteHistory:true,
  invocationOrdinal:ordinal,
  memoryBeforeCall:targetBefore,
  memoryAfterCall:targetAfter,
  rawWasmFinding:hostClone(targetRaw),
  normalizedWasmFinding:hostClone(targetNormalized),
  exactOracleParity,
  error:targetError,
});
process.exit(targetError ? 2 : 0);
