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
const wasmPath = new URL("../build/sudoku-techniques.wasm", import.meta.url);
const outDir = resolve("senior-exocet-prefix-results");
await mkdir(outDir, { recursive: true });

const oracle = await loadOracle();
const corpus = await loadBenchmarkCorpus();
const target = corpus.find((x) => x.id === TARGET_CASE);
const targetMasks = Array.from(oracle.candidateMasksForGrid(target.puzzle), Number);
const expected = oracle.findTechniqueFromMasks(
  "seniorExocet", target.puzzle, targetMasks, target.puzzle, target.solution,
);

function hostClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
function normalize(key, raw, solution) {
  return key === "juniorExocet" || key === "seniorExocet"
    ? hostClone(oracle.validateFindingAgainstSolution(raw, solution))
    : raw;
}
function mem(core) {
  const bytes = core.memory.buffer.byteLength;
  return { bytes, pages: bytes / 65536 };
}
function errData(error, core) {
  return {
    name:error?.name ?? null,
    message:String(error?.message || error),
    stack:String(error?.stack || ""),
    memory:mem(core),
  };
}

async function runPrefix(label, prefixCount, immediateJuniorOnly = false) {
  const core = await instantiateCore(wasmPath);
  let ordinal = 0;

  if (immediateJuniorOnly) {
    loadPosition(core, target.puzzle, targetMasks);
    loadGivenGrid(core, target.puzzle);
    const jr = runStandaloneTechniqueFinder(core, 48);
    assert.deepEqual(
      normalize("juniorExocet", jr, target.solution),
      hostClone(oracle.findTechniqueFromMasks(
        "juniorExocet", target.puzzle, targetMasks, target.puzzle, target.solution,
      )),
      "junior-only pre-call parity mismatch",
    );
    ordinal = 187;
  } else {
    outer:
    for (const testCase of corpus) {
      if (testCase.id > TARGET_CASE) break;
      const masks = Array.from(oracle.candidateMasksForGrid(testCase.puzzle), Number);
      loadPosition(core, testCase.puzzle, masks);
      loadGivenGrid(core, testCase.puzzle);

      for (const [id,key] of TECHNIQUES) {
        if (testCase.id === TARGET_CASE && id === TARGET_ID) break outer;
        if (ordinal >= prefixCount) break outer;

        ordinal++;
        const raw = runStandaloneTechniqueFinder(core, id);
        const normalized = normalize(key, raw, testCase.solution);
        const jsFinding = oracle.findTechniqueFromMasks(
          key, testCase.puzzle, masks, testCase.puzzle, testCase.solution,
        );
        assert.deepEqual(
          normalized,
          hostClone(jsFinding),
          "prefix parity mismatch at ordinal " + ordinal + " #" + testCase.id + " " + key,
        );
      }
    }

    assert.equal(ordinal, prefixCount, label + " prefix ordinal mismatch");

    // Ensure the exact target state is loaded before the one Senior call.
    loadPosition(core, target.puzzle, targetMasks);
    loadGivenGrid(core, target.puzzle);
  }

  const before = mem(core);
  let raw = null, error = null, after = null;
  try {
    raw = runStandaloneTechniqueFinder(core, TARGET_ID);
    after = mem(core);
  } catch (e) {
    error = errData(e, core);
  }
  const normalized = error ? null : normalize("seniorExocet", raw, target.solution);
  let parity = false;
  if (!error) {
    try {
      assert.deepEqual(normalized, hostClone(expected));
      parity = true;
    } catch {}
  }

  return {
    label,
    prefixCount,
    immediateJuniorOnly,
    memoryBeforeSenior:before,
    memoryAfterSenior:after,
    rawFinding:hostClone(raw),
    normalizedFinding:hostClone(normalized),
    exactOracleParity:parity,
    error,
  };
}

const results = [];
results.push(await runPrefix("fresh", 0));
results.push(await runPrefix("through-case3", 141));
results.push(await runPrefix("through-case4-msls", 186));
results.push(await runPrefix("through-case4-junior", 187));
results.push(await runPrefix("same-state-junior-then-senior", 0, true));

const out = {
  schema:"incremental-senior-exocet-prefix-isolation/v1",
  target:{
    caseId:4,
    techniqueId:49,
    grid:target.puzzle.flat().join(""),
    masks:targetMasks,
    jsOracleFinding:hostClone(expected),
  },
  results,
};
await writeFile(resolve(outDir, "prefix-isolation.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
console.log("PREFIX_ISOLATION " + JSON.stringify(out));
