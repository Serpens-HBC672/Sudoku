import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, writeFileSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import {
  instantiateCore,
  loadPosition,
  loadGivenGrid,
  findNextStepWasm,
  setStandaloneDiagnosticHook,
} from "../bridge/assembly-core.mjs";
import { loadOracle } from "./load-oracle.mjs";
import { loadBenchmarkCorpus } from "./benchmark-corpus.mjs";

const WASM_URL = new URL("../build/sudoku-techniques.wasm", import.meta.url);
const OUT_DIR = resolve("accumulated-runtime-results");
const BREADCRUMB_PATH = resolve(OUT_DIR, "benchmark-22-precall-breadcrumbs.jsonl");
const RESULT_PATH = resolve(OUT_DIR, "benchmark-22-accumulated-result.json");
const PRECALL_STATE_PATH = resolve(OUT_DIR, "benchmark-22-failing-precall-state.json");

function gridFromString(text) {
  return Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => Number(text[r * 9 + c])),
  );
}

function hostClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stateId(beforeGrid, beforeMasks) {
  return createHash("sha256")
    .update(beforeGrid + ":" + beforeMasks.join(","), "utf8")
    .digest("hex")
    .slice(0, 16);
}

function memorySnapshot(core) {
  const bytes = core.memory.buffer.byteLength;
  return { bytes, pages: bytes / 65536 };
}

function writeJsonLine(fd, prefix, value) {
  const line = JSON.stringify(value) + "\n";
  writeSync(fd, line, null, "utf8");
  process.stderr.write(prefix + line);
}

mkdirSync(OUT_DIR, { recursive: true });
const breadcrumbFd = openSync(BREADCRUMB_PATH, "w");

const oracle = await loadOracle();
const corpus = await loadBenchmarkCorpus();
const cases = corpus.filter((entry) => entry.id >= 1 && entry.id <= 22);
if (cases.length !== 22) {
  throw new Error("Expected benchmark cases #1-#22");
}

const core = await instantiateCore(WASM_URL);
const initialMemory = memorySnapshot(core);
console.log("ACCUMULATED_INITIAL_MEMORY " + JSON.stringify(initialMemory));

const completedPuzzleMemory = [];
const boundary = {
  after21: null,
  before22FirstLoadPosition: null,
  after22FirstLoadPosition: null,
  before22FirstStandalone: null,
};

let currentPuzzleId = null;
let currentState = null;
let standaloneCallOrdinal = 0;
let lastStandaloneBreadcrumb = null;
let lastObserved22MemoryBytes = null;
let mostRecentGrowthEvent = null;
let first22LoadPositionDone = false;
const growthEvents22 = [];

setStandaloneDiagnosticHook(({ core: hookCore, techniqueId, technique }) => {
  if (currentPuzzleId !== 22) return;

  standaloneCallOrdinal++;
  const memory = memorySnapshot(hookCore);
  const record = {
    puzzleId: 22,
    solverStep: currentState?.step ?? null,
    standaloneCallOrdinal,
    techniqueId,
    techniqueKey: technique,
    stateId: currentState?.stateId ?? null,
  };

  if (boundary.before22FirstStandalone == null) {
    boundary.before22FirstStandalone = { ...memory };
    console.log(
      "BOUNDARY_D_BEFORE_22_FIRST_STANDALONE " +
      JSON.stringify({ ...memory, ...record }),
    );
  }

  if (lastObserved22MemoryBytes == null || memory.bytes !== lastObserved22MemoryBytes) {
    const event = {
      ...record,
      memoryBytes: memory.bytes,
      memoryPages: memory.pages,
      previousBytes: lastObserved22MemoryBytes,
    };
    growthEvents22.push(event);
    mostRecentGrowthEvent = event;
    lastObserved22MemoryBytes = memory.bytes;
    console.log("WASM_22_MEMORY_CHANGE " + JSON.stringify(event));
  }

  lastStandaloneBreadcrumb = {
    ...record,
    memoryBytes: memory.bytes,
    memoryPages: memory.pages,
  };

  // Persist identity synchronously before entering the finder.
  writeJsonLine(breadcrumbFd, "WASM_STANDALONE_PRE ", lastStandaloneBreadcrumb);
});

let trapped = null;
let totalPassedSteps = 0;

try {
  outer:
  for (const testCase of cases) {
    currentPuzzleId = testCase.id;
    const trace = oracle.tracePuzzle(testCase.puzzle, testCase.solution);
    if (trace.soundnessProblem) {
      throw new Error(
        "#" + testCase.id + " JS oracle soundness failure: " +
        JSON.stringify(trace.soundnessProblem),
      );
    }

    let passed = 0;
    for (const step of trace.trace) {
      const beforeMasks = Array.from(step.beforeMasks, Number);
      currentState = {
        step: step.step,
        beforeGrid: step.beforeGrid,
        beforeMasks,
        stateId: stateId(step.beforeGrid, beforeMasks),
      };

      if (testCase.id === 22 && !first22LoadPositionDone) {
        boundary.before22FirstLoadPosition = memorySnapshot(core);
        console.log(
          "BOUNDARY_B_BEFORE_22_FIRST_LOAD_POSITION " +
          JSON.stringify(boundary.before22FirstLoadPosition),
        );
      }

      const grid = gridFromString(step.beforeGrid);
      loadPosition(core, grid, beforeMasks);

      if (testCase.id === 22 && !first22LoadPositionDone) {
        boundary.after22FirstLoadPosition = memorySnapshot(core);
        first22LoadPositionDone = true;
        lastObserved22MemoryBytes = boundary.after22FirstLoadPosition.bytes;
        console.log(
          "BOUNDARY_C_AFTER_22_FIRST_LOAD_POSITION " +
          JSON.stringify(boundary.after22FirstLoadPosition),
        );
      }

      loadGivenGrid(core, testCase.puzzle);

      let finding;
      try {
        finding = findNextStepWasm(core, {
          budgetLimit: 6790,
          validator: (candidate) =>
            !!oracle.validateFindingAgainstSolution(candidate, testCase.solution),
        });
      } catch (error) {
        const isUnreachable =
          (error instanceof WebAssembly.RuntimeError || error?.name === "RuntimeError") &&
          /unreachable/i.test(String(error?.message || error));

        if (!isUnreachable || testCase.id !== 22) throw error;

        const memoryBeforeTrapReport = memorySnapshot(core);
        trapped = {
          status: "trap",
          errorName: error?.name ?? null,
          errorMessage: String(error?.message || error),
          puzzleId: 22,
          solverStep: currentState.step,
          standaloneCallOrdinal: lastStandaloneBreadcrumb?.standaloneCallOrdinal ?? null,
          techniqueId: lastStandaloneBreadcrumb?.techniqueId ?? null,
          techniqueKey: lastStandaloneBreadcrumb?.techniqueKey ?? null,
          stateId: currentState.stateId,
          memoryImmediatelyBeforeFailingCall: lastStandaloneBreadcrumb
            ? {
                bytes: lastStandaloneBreadcrumb.memoryBytes,
                pages: lastStandaloneBreadcrumb.memoryPages,
              }
            : null,
          memoryWhenCaught: memoryBeforeTrapReport,
          mostRecentMemoryGrowthEvent: mostRecentGrowthEvent,
          preCallState: {
            beforeGrid: currentState.beforeGrid,
            beforeMasks: currentState.beforeMasks,
          },
          passedStepsIn22BeforeTrap: passed,
          totalPassedStepsBeforeTrap: totalPassedSteps,
        };
        writeFileSync(
          PRECALL_STATE_PATH,
          JSON.stringify({
            puzzleId: 22,
            solverStep: currentState.step,
            standaloneCallOrdinal: lastStandaloneBreadcrumb?.standaloneCallOrdinal ?? null,
            techniqueId: lastStandaloneBreadcrumb?.techniqueId ?? null,
            techniqueKey: lastStandaloneBreadcrumb?.techniqueKey ?? null,
            stateId: currentState.stateId,
            beforeGrid: currentState.beforeGrid,
            beforeMasks: currentState.beforeMasks,
          }, null, 2) + "\n",
          "utf8",
        );
        break outer;
      }

      assert.deepEqual(
        finding,
        hostClone(step.finding),
        "#" + testCase.id + " step " + step.step + " selected Finding mismatch",
      );
      passed++;
      totalPassedSteps++;
    }

    const memory = memorySnapshot(core);
    completedPuzzleMemory.push({
      puzzleId: testCase.id,
      bytes: memory.bytes,
      pages: memory.pages,
      passedSteps: passed,
    });
    console.log(
      "PUZZLE_MEMORY " +
      JSON.stringify({
        puzzleId: testCase.id,
        bytes: memory.bytes,
        pages: memory.pages,
      }),
    );

    if (testCase.id === 21) {
      boundary.after21 = { ...memory };
      console.log("BOUNDARY_A_AFTER_21 " + JSON.stringify(boundary.after21));
    }

    if (testCase.id === 22) break;
  }
} finally {
  setStandaloneDiagnosticHook(null);
  closeSync(breadcrumbFd);
}

const finalMemory = memorySnapshot(core);
const result = trapped || {
  status: "no-trap",
  completedThroughPuzzle: 22,
  final22Memory: finalMemory,
  standaloneCallsIn22: standaloneCallOrdinal,
  lastStandaloneCall: lastStandaloneBreadcrumb,
  growthEvents22,
};

const output = {
  schema: "sudoku-wasm-accumulated-runtime-22/v1",
  historicalImplementation: "3fb98015986848e20025f8d1b1881f28fa6978e4",
  initialMemory,
  completedPuzzleMemory,
  boundary,
  result,
};

writeFileSync(RESULT_PATH, JSON.stringify(output, null, 2) + "\n", "utf8");
console.log("ACCUMULATED_RUNTIME_RESULT " + JSON.stringify(output));

if (trapped) {
  console.log(
    "STOP first #22 RuntimeError: unreachable at step " + trapped.solverStep +
    ", standalone call " + trapped.standaloneCallOrdinal +
    ", technique " + trapped.techniqueId + "/" + trapped.techniqueKey +
    ", state " + trapped.stateId,
  );
} else {
  console.log("NO_TRAP accumulated #1-#22 run completed; stopping after #22.");
}
