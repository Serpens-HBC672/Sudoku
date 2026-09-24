import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
function gridFromString(text) {
  return Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => Number(text[r * 9 + c])),
  );
}
function hostClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

const root = resolve(argValue("--root") || "target");
const expected = argValue("--expect") || "pass";
const maxMs = Number(argValue("--max-ms") || 240000);
if (!["pass", "trap"].includes(expected)) throw new Error("Invalid --expect value");

const bridge = await import(pathToFileURL(resolve(root, "wasm-migration/bridge/assembly-core.mjs")).href);
const { loadOracle } = await import(pathToFileURL(resolve(root, "wasm-migration/tests/load-oracle.mjs")).href);
const { loadBenchmarkCorpus } = await import(pathToFileURL(resolve(root, "wasm-migration/tests/benchmark-corpus.mjs")).href);

const {
  instantiateCore,
  loadPosition,
  loadGivenGrid,
  runStandaloneTechniqueFinder,
} = bridge;

const oracle = await loadOracle();
const corpus = await loadBenchmarkCorpus();
const testCase = corpus.find((entry) => entry.id === 22);
if (!testCase) throw new Error("Benchmark #22 not found");

const started = performance.now();
const trace = oracle.tracePuzzle(testCase.puzzle, testCase.solution);
if (trace.soundnessProblem) throw new Error("JS oracle soundness failure: " + JSON.stringify(trace.soundnessProblem));

const wasmUrl = pathToFileURL(resolve(root, "wasm-migration/build/sudoku-techniques.wasm"));
const core = await instantiateCore(wasmUrl);
const reachesMsls = new Set([
  "msls",
  "juniorExocet",
  "seniorExocet",
  "dynamicNishioChain",
  "dynamicUnaryChain",
  "multipleChain",
]);

let exercised = 0;
for (const step of trace.trace) {
  if (!reachesMsls.has(step.finding.technique)) continue;
  if (performance.now() - started > maxMs) {
    throw new Error("Focused #22 MSLS reproduction exceeded " + maxMs + "ms before step " + step.step);
  }

  const grid = gridFromString(step.beforeGrid);
  const masks = Array.from(step.beforeMasks, Number);
  loadPosition(core, grid, masks);
  loadGivenGrid(core, testCase.puzzle);

  const jsFinding = oracle.findTechniqueFromMasks(
    "msls",
    grid,
    masks,
    testCase.puzzle,
    testCase.solution,
  );

  let wasmFinding;
  try {
    wasmFinding = runStandaloneTechniqueFinder(core, 47);
  } catch (error) {
    console.error("MSLS_CASE22_TRAP", JSON.stringify({
      caseId: 22,
      step: step.step,
      expectedTechnique: step.finding.technique,
      exercised,
      elapsedMs: performance.now() - started,
      error: String(error),
    }));
    if (expected === "trap") {
      console.log("PASS expected historical MSLS trap reproduced.");
      process.exit(0);
    }
    throw error;
  }

  assert.deepEqual(
    hostClone(wasmFinding),
    hostClone(jsFinding),
    "#22 step " + step.step + " MSLS standalone Finding mismatch",
  );
  exercised++;
}

if (expected === "trap") {
  throw new Error("Historical MSLS trap was not reproduced across " + exercised + " focused #22 states.");
}
if (exercised === 0) throw new Error("Focused #22 trace did not reach MSLS-or-later states.");

console.log(
  "PASS focused #22 MSLS standalone regression: " + exercised +
  " states; elapsed=" + (performance.now() - started).toFixed(1) + "ms.",
);
