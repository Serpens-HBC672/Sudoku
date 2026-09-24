import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  instantiateCore,
  loadPosition,
  loadGivenGrid,
  findNextStepWasm,
  runStandaloneTechniqueFinder,
  runStaticUnaryFinder,
  runStaticNishioFinder,
  runStaticMultipleFinder,
  setStandaloneDiagnosticHook,
} from "../bridge/assembly-core.mjs";
import { loadOracle } from "./load-oracle.mjs";
import { loadBenchmarkCorpus } from "./benchmark-corpus.mjs";

const TARGET_GRID = "000000039000010005003005800008009006070020000100400000009008050020000600400700000";
const TARGET_MASKS = [80,185,123,162,232,106,11,0,0,482,424,106,422,0,110,74,106,0,354,297,0,290,360,0,0,107,75,22,28,0,21,84,0,95,75,0,308,0,56,181,0,37,285,393,141,0,308,50,0,244,100,342,450,198,100,37,0,39,44,0,79,0,75,212,0,81,277,284,13,0,457,205,0,181,49,0,308,39,263,387,135];
const TARGET_STATE_ID = "bb8d5eee4b435209";
const TARGET_STEP = 5;
const TARGET_TECHNIQUE_ID = 47;
const TARGET_TECHNIQUE_KEY = "msls";
const EXPECTED_STANDALONE_ORDINAL = 278;
const WASM_URL = new URL("../build/sudoku-techniques.wasm", import.meta.url);
const OUT_DIR = resolve("runtime-history-ab-results");

function gridFromString(text) {
  return Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => Number(text[r * 9 + c])),
  );
}

function hostClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function memory(core) {
  const bytes = core.memory.buffer.byteLength;
  return { bytes, pages: bytes / 65536 };
}

function isRuntimeUnreachable(error) {
  return (
    (error instanceof WebAssembly.RuntimeError || error?.name === "RuntimeError") &&
    /unreachable/i.test(String(error?.message || error))
  );
}

function summarizeFinding(finding) {
  if (finding == null) return { returned: "null" };
  return {
    returned: "finding",
    technique: finding.technique ?? null,
    actionType: finding.actionType ?? null,
    eliminationCount: Array.isArray(finding.eliminations) ? finding.eliminations.length : null,
  };
}

function writeResult(name, value) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, name), JSON.stringify(value, null, 2) + "\n", "utf8");
  console.log("AB_RESULT " + JSON.stringify(value));
}

function exactStateEqual(step) {
  return (
    step.beforeGrid === TARGET_GRID &&
    Array.isArray(step.beforeMasks) &&
    step.beforeMasks.length === 81 &&
    Array.from(step.beforeMasks, Number).every((value, i) => value === TARGET_MASKS[i])
  );
}

function runHistoricalTechniqueBefore47(core, techniqueId) {
  if (techniqueId >= 0 && techniqueId <= 41) {
    return runStandaloneTechniqueFinder(core, techniqueId);
  }
  if (techniqueId === 42) return runStaticUnaryFinder(core);
  if (techniqueId === 43) return runStaticNishioFinder(core);
  if (techniqueId === 44) return runStaticMultipleFinder(core);
  if (techniqueId === 45 || techniqueId === 46) {
    return runStandaloneTechniqueFinder(core, techniqueId);
  }
  throw new RangeError("Unexpected pre-target technique id: " + techniqueId);
}

const arm = process.argv[2];
if (arm !== "A" && arm !== "B") {
  throw new Error("Usage: node tests/benchmark-22-runtime-history-ab.mjs A|B");
}

const oracle = await loadOracle();
const corpus = await loadBenchmarkCorpus();
const case22 = corpus.find((entry) => entry.id === 22);
if (!case22) throw new Error("Benchmark #22 not found");

if (arm === "A") {
  const core = await instantiateCore(WASM_URL);
  const beforeLoad = memory(core);

  loadPosition(core, gridFromString(TARGET_GRID), [...TARGET_MASKS]);
  loadGivenGrid(core, case22.puzzle);

  const afterLoad = memory(core);
  const beforeMsls = memory(core);

  let finding = null;
  let trapped = null;
  let afterMsls = null;
  try {
    finding = runStandaloneTechniqueFinder(core, TARGET_TECHNIQUE_ID);
    afterMsls = memory(core);
  } catch (error) {
    trapped = {
      name: error?.name ?? null,
      message: String(error?.message || error),
      isRuntimeUnreachable: isRuntimeUnreachable(error),
      memoryWhenCaught: memory(core),
    };
  }

  writeResult("A-fresh-core.json", {
    arm: "A",
    historicalImplementation: "3fb98015986848e20025f8d1b1881f28fa6978e4",
    core: "fresh",
    stateId: TARGET_STATE_ID,
    solverStep: TARGET_STEP,
    techniqueId: TARGET_TECHNIQUE_ID,
    techniqueKey: TARGET_TECHNIQUE_KEY,
    input: {
      beforeGrid: TARGET_GRID,
      beforeMasks: TARGET_MASKS,
    },
    memoryBeforeLoad: beforeLoad,
    memoryAfterLoad: afterLoad,
    memoryImmediatelyBeforeMsls: beforeMsls,
    memoryImmediatelyAfterMsls: afterMsls,
    outcome: trapped
      ? { status: "trap", ...trapped }
      : { status: "returned", ...summarizeFinding(finding) },
  });
  process.exit(0);
}

// Arm B: exact historical shared-instance warm-up, then only enough #22 work to
// reach the saved state and the target standalone call.
const core = await instantiateCore(WASM_URL);
const cases = corpus.filter((entry) => entry.id >= 1 && entry.id <= 21);
assert.equal(cases.length, 21);

let totalWarmupSteps = 0;
for (const testCase of cases) {
  const trace = oracle.tracePuzzle(testCase.puzzle, testCase.solution);
  if (trace.soundnessProblem) {
    throw new Error(
      "#" + testCase.id + " JS oracle soundness failure: " +
      JSON.stringify(trace.soundnessProblem),
    );
  }

  for (const step of trace.trace) {
    const grid = gridFromString(step.beforeGrid);
    const masks = Array.from(step.beforeMasks, Number);
    loadPosition(core, grid, masks);
    loadGivenGrid(core, testCase.puzzle);
    const finding = findNextStepWasm(core, {
      budgetLimit: 6790,
      validator: (candidate) =>
        !!oracle.validateFindingAgainstSolution(candidate, testCase.solution),
    });
    assert.deepEqual(
      finding,
      hostClone(step.finding),
      "#" + testCase.id + " step " + step.step + " selected Finding mismatch",
    );
    totalWarmupSteps++;
  }
}

const memoryAfter21 = memory(core);
const trace22 = oracle.tracePuzzle(case22.puzzle, case22.solution);
if (trace22.soundnessProblem) {
  throw new Error("#22 JS oracle soundness failure: " + JSON.stringify(trace22.soundnessProblem));
}

const targetStep = trace22.trace.find((step) => step.step === TARGET_STEP);
if (!targetStep) throw new Error("Target #22 step 5 not found in oracle trace");
assert.equal(targetStep.beforeGrid, TARGET_GRID, "target beforeGrid mismatch");
assert.deepEqual(Array.from(targetStep.beforeMasks, Number), TARGET_MASKS, "target beforeMasks mismatch");

let currentStep = null;
let standaloneOrdinal = 0;
let targetHookSeen = false;
setStandaloneDiagnosticHook(({ techniqueId, technique }) => {
  standaloneOrdinal++;
  if (currentStep === TARGET_STEP && techniqueId === TARGET_TECHNIQUE_ID) {
    assert.equal(technique, TARGET_TECHNIQUE_KEY);
    assert.equal(standaloneOrdinal, EXPECTED_STANDALONE_ORDINAL);
    targetHookSeen = true;
    console.log(
      "B_TARGET_PRECALL " +
      JSON.stringify({
        solverStep: currentStep,
        standaloneCallOrdinal: standaloneOrdinal,
        techniqueId,
        techniqueKey: technique,
        stateId: TARGET_STATE_ID,
        memory: memory(core),
      }),
    );
  }
});

let passed22StepsBeforeTarget = 0;
for (const step of trace22.trace) {
  if (step.step >= TARGET_STEP) break;
  currentStep = step.step;
  const grid = gridFromString(step.beforeGrid);
  const masks = Array.from(step.beforeMasks, Number);
  loadPosition(core, grid, masks);
  loadGivenGrid(core, case22.puzzle);
  const finding = findNextStepWasm(core, {
    budgetLimit: 6790,
    validator: (candidate) =>
      !!oracle.validateFindingAgainstSolution(candidate, case22.solution),
  });
  assert.deepEqual(
    finding,
    hostClone(step.finding),
    "#22 step " + step.step + " selected Finding mismatch before target",
  );
  passed22StepsBeforeTarget++;
}

currentStep = TARGET_STEP;
const beforeTargetLoad = memory(core);

// Explicit equality checks immediately before loading the target state.
assert.equal(targetStep.beforeGrid, TARGET_GRID);
assert.deepEqual(Array.from(targetStep.beforeMasks, Number), TARGET_MASKS);

loadPosition(core, gridFromString(TARGET_GRID), [...TARGET_MASKS]);
loadGivenGrid(core, case22.puzzle);
const afterTargetLoad = memory(core);

// Reproduce the exact technique traversal before id 47 for this same state.
const validator = (candidate) =>
  !!oracle.validateFindingAgainstSolution(candidate, case22.solution);

for (let techniqueId = 0; techniqueId < TARGET_TECHNIQUE_ID; techniqueId++) {
  const finding = runHistoricalTechniqueBefore47(core, techniqueId);
  if (!finding) continue;
  if (!validator(finding)) continue;
  throw new Error(
    "Historical control flow would have selected technique " + techniqueId +
    " before target 47 at saved state",
  );
}

assert.equal(TARGET_TECHNIQUE_ID, 47);
assert.equal(standaloneOrdinal, EXPECTED_STANDALONE_ORDINAL - 1);
const beforeMsls = memory(core);

let targetFinding = null;
let targetTrap = null;
let afterMsls = null;
try {
  targetFinding = runStandaloneTechniqueFinder(core, TARGET_TECHNIQUE_ID);
  afterMsls = memory(core);
} catch (error) {
  targetTrap = {
    name: error?.name ?? null,
    message: String(error?.message || error),
    isRuntimeUnreachable: isRuntimeUnreachable(error),
    memoryWhenCaught: memory(core),
  };
} finally {
  setStandaloneDiagnosticHook(null);
}

assert.equal(targetHookSeen, true, "target pre-call hook was not observed");
assert.equal(standaloneOrdinal, EXPECTED_STANDALONE_ORDINAL);

writeResult("B-accumulated-core.json", {
  arm: "B",
  historicalImplementation: "3fb98015986848e20025f8d1b1881f28fa6978e4",
  core: "single accumulated core",
  warmup: {
    puzzles: "1-21",
    totalPassedSteps: totalWarmupSteps,
    memoryAfter21,
    passed22StepsBeforeTarget,
  },
  verifiedInputEquality: {
    beforeGrid: targetStep.beforeGrid === TARGET_GRID,
    beforeMasks:
      Array.from(targetStep.beforeMasks, Number).length === TARGET_MASKS.length &&
      Array.from(targetStep.beforeMasks, Number).every((value, i) => value === TARGET_MASKS[i]),
    techniqueId: TARGET_TECHNIQUE_ID === 47,
    standaloneOrdinalBeforeCall: standaloneOrdinal === EXPECTED_STANDALONE_ORDINAL,
  },
  stateId: TARGET_STATE_ID,
  solverStep: TARGET_STEP,
  standaloneCallOrdinal: EXPECTED_STANDALONE_ORDINAL,
  techniqueId: TARGET_TECHNIQUE_ID,
  techniqueKey: TARGET_TECHNIQUE_KEY,
  input: {
    beforeGrid: TARGET_GRID,
    beforeMasks: TARGET_MASKS,
  },
  memoryBeforeLoad: beforeTargetLoad,
  memoryAfterLoad: afterTargetLoad,
  memoryImmediatelyBeforeMsls: beforeMsls,
  memoryImmediatelyAfterMsls: afterMsls,
  outcome: targetTrap
    ? { status: "trap", ...targetTrap }
    : { status: "returned", ...summarizeFinding(targetFinding) },
});
