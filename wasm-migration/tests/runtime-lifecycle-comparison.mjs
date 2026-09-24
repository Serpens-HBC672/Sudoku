import assert from "node:assert/strict";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  instantiateCore,
  loadPosition,
  loadGivenGrid,
  findNextStepWasm,
} from "../bridge/assembly-core.mjs";
import { loadOracle } from "./load-oracle.mjs";
import { loadBenchmarkCorpus } from "./benchmark-corpus.mjs";

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
function hasArg(name) {
  return process.argv.includes(name);
}
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

const runtime = argValue("--runtime");
const wasmPath = resolve(argValue("--wasm"));
const outDir = resolve(argValue("--out"));
const collectAtPuzzleBoundary = hasArg("--collect-at-puzzle-boundary");

if (!runtime || !wasmPath || !outDir) {
  throw new Error("usage: --runtime <label> --wasm <path> --out <dir> [--collect-at-puzzle-boundary]");
}

await mkdir(outDir, { recursive: true });

const binarySizeBytes = (await stat(wasmPath)).size;
const oracle = await loadOracle();
const corpus = await loadBenchmarkCorpus();
const cases = corpus.filter((entry) => entry.id >= 1 && entry.id <= 22);
if (cases.length !== 22) throw new Error("Expected benchmark cases #1-#22");

const started = performance.now();
const core = await instantiateCore(wasmPath);

if (collectAtPuzzleBoundary && typeof core.__collect !== "function") {
  throw new Error("Boundary collection requested but __collect is not exported");
}

let peak = memory(core);
let totalSteps = 0;
let passedSteps = 0;
let completedPuzzles = 0;
let parityOk = true;
let stop = null;
let boundaryCollectCalls = 0;
const puzzleMemory = [];

function observeMemory() {
  const current = memory(core);
  if (current.bytes > peak.bytes) peak = current;
  return current;
}

try {
  outer:
  for (const testCase of cases) {
    const trace = oracle.tracePuzzle(testCase.puzzle, testCase.solution);
    if (trace.soundnessProblem) {
      parityOk = false;
      stop = {
        kind: "oracle-soundness",
        puzzleId: testCase.id,
        detail: trace.soundnessProblem,
        memory: observeMemory(),
      };
      break;
    }

    let passed = 0;
    for (const step of trace.trace) {
      totalSteps++;
      try {
        const grid = gridFromString(step.beforeGrid);
        loadPosition(core, grid, Array.from(step.beforeMasks, Number));
        loadGivenGrid(core, testCase.puzzle);
        observeMemory();

        const finding = findNextStepWasm(core, {
          budgetLimit: 6790,
          validator: (candidate) =>
            !!oracle.validateFindingAgainstSolution(candidate, testCase.solution),
        });
        observeMemory();

        assert.deepEqual(
          finding,
          hostClone(step.finding),
          "#" + testCase.id + " step " + step.step + " selected Finding mismatch",
        );

        passed++;
        passedSteps++;
      } catch (error) {
        const current = observeMemory();
        if (error instanceof assert.AssertionError) parityOk = false;
        stop = {
          kind: error?.name === "RuntimeError" ? "runtime-error" : "exception",
          puzzleId: testCase.id,
          solverStep: step.step,
          errorName: error?.name ?? null,
          errorMessage: String(error?.message || error),
          memory: current,
        };
        break outer;
      }
    }

    const beforeCollect = observeMemory();
    let afterCollect = beforeCollect;

    if (collectAtPuzzleBoundary) {
      try {
        core.__collect();
        boundaryCollectCalls++;
        afterCollect = observeMemory();
      } catch (error) {
        stop = {
          kind: "boundary-collect-error",
          puzzleId: testCase.id,
          errorName: error?.name ?? null,
          errorMessage: String(error?.message || error),
          memory: observeMemory(),
        };
        break;
      }
    }

    completedPuzzles++;
    puzzleMemory.push({
      puzzleId: testCase.id,
      passedSteps: passed,
      traceSteps: trace.trace.length,
      beforeBoundaryCollect: beforeCollect,
      afterBoundaryCollect: afterCollect,
      recordedAfterPuzzle: afterCollect,
    });

    console.log(
      "RUNTIME_PUZZLE_MEMORY " +
      JSON.stringify({
        runtime,
        puzzleId: testCase.id,
        passedSteps: passed,
        traceSteps: trace.trace.length,
        beforeBoundaryCollect: beforeCollect,
        afterBoundaryCollect: afterCollect,
      }),
    );

    if (testCase.id === 22) break;
  }
} catch (error) {
  stop = stop || {
    kind: "unexpected-exception",
    errorName: error?.name ?? null,
    errorMessage: String(error?.message || error),
    memory: observeMemory(),
  };
}

const elapsedMs = performance.now() - started;
const finalMemory = observeMemory();
const completed22 = completedPuzzles === 22 && stop == null;
const selected = {};
for (const id of [1, 7, 14, 21, 22]) {
  const entry = puzzleMemory.find((x) => x.puzzleId === id);
  selected[id] = entry ? entry.recordedAfterPuzzle : null;
}

const result = {
  schema: "sudoku-wasm-runtime-lifecycle-comparison/v1",
  historicalImplementation: "3fb98015986848e20025f8d1b1881f28fa6978e4",
  runtime,
  collectAtPuzzleBoundary,
  boundaryCollectorExported: typeof core.__collect === "function",
  boundaryCollectCalls,
  oneSharedCore: true,
  puzzleRange: "1-22",
  exactSelectedFindingParity: parityOk && completed22,
  parityOkUntilStop: parityOk,
  completed22,
  completedPuzzles,
  totalStepsAttempted: totalSteps,
  passedSteps,
  selectedPuzzleMemory: selected,
  puzzleMemory,
  peakLinearMemory: peak,
  finalLinearMemory: finalMemory,
  elapsedMs,
  binarySizeBytes,
  stop,
};

await writeFile(
  resolve(outDir, runtime + ".json"),
  JSON.stringify(result, null, 2) + "\n",
  "utf8",
);
console.log("RUNTIME_RESULT " + JSON.stringify(result));
