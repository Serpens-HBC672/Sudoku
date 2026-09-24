import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function gridFromString(text) {
  return Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => Number(text[r * 9 + c])),
  );
}

const root = resolve("target");
const bridge = await import(pathToFileURL(resolve(root, "wasm-migration/bridge/assembly-core.mjs")).href);
const { loadOracle } = await import(pathToFileURL(resolve(root, "wasm-migration/tests/load-oracle.mjs")).href);
const { loadBenchmarkCorpus } = await import(pathToFileURL(resolve(root, "wasm-migration/tests/benchmark-corpus.mjs")).href);

const { instantiateCore, loadPosition, loadGivenGrid, runStandaloneTechniqueFinder } = bridge;
const oracle = await loadOracle();
const corpus = await loadBenchmarkCorpus();
const testCase = corpus.find((entry) => entry.id === 22);
if (!testCase) throw new Error("Benchmark #22 not found");

// Bounded location only: stop as soon as the frozen oracle reaches its first DFC state.
const trace = oracle.tracePuzzle(testCase.puzzle, testCase.solution, 512, true);
if (trace.soundnessProblem) throw new Error("Oracle soundness failure: " + JSON.stringify(trace.soundnessProblem));

const state = trace.trace.find((step) =>
  step.finding.technique === "dynamicNishioChain" ||
  step.finding.technique === "dynamicUnaryChain"
);
if (!state) throw new Error("No first DFC state found in bounded #22 oracle trace");

const grid = gridFromString(state.beforeGrid);
const masks = Array.from(state.beforeMasks, Number);

console.log("ONE_STATE", JSON.stringify({
  caseId: 22,
  step: state.step,
  expectedTechnique: state.finding.technique,
  beforeGrid: state.beforeGrid,
  beforeMasks: masks,
}));

const core = await instantiateCore(pathToFileURL(resolve(root, "wasm-migration/build/sudoku-techniques.wasm")));
loadPosition(core, grid, masks);
loadGivenGrid(core, testCase.puzzle);

// Exactly one historical WASM technique call.
let finding;
try {
  finding = runStandaloneTechniqueFinder(core, 47);
} catch (error) {
  console.error("ONE_CALL_TRAP", JSON.stringify({
    caseId: 22,
    step: state.step,
    techniqueId: 47,
    error: String(error),
  }));
  throw error;
}

console.log("ONE_CALL_RESULT", JSON.stringify({
  caseId: 22,
  step: state.step,
  techniqueId: 47,
  returnedNull: finding == null,
  technique: finding?.technique ?? null,
  actionType: finding?.actionType ?? null,
  eliminationCount: finding?.eliminations?.length ?? 0,
}));
