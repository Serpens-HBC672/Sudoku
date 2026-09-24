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
const OUT_DIR = resolve("diagnostic-results");
const BREADCRUMB_PATH = resolve(OUT_DIR, "benchmark-22-standalone-breadcrumbs.jsonl");
const RESULT_PATH = resolve(OUT_DIR, "benchmark-22-trap-result.json");

function gridFromString(text) {
  return Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => Number(text[r * 9 + c])),
  );
}

function hostClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function fingerprint(beforeGrid, beforeMasks) {
  return createHash("sha256")
    .update(beforeGrid + ":" + beforeMasks.join(","), "utf8")
    .digest("hex")
    .slice(0, 16);
}

function memoryBytes(core) {
  const memory = core?.memory;
  return memory && memory.buffer ? memory.buffer.byteLength : null;
}

function memorySummary(records) {
  const values = records.map((x) => x.wasmMemoryBytes).filter(Number.isFinite);
  if (values.length === 0) {
    return {
      firstBytes: null,
      lastBytes: null,
      minBytes: null,
      maxBytes: null,
      deltaBytes: null,
      growthEvents: null,
    };
  }
  let growthEvents = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[i - 1]) growthEvents++;
  }
  return {
    firstBytes: values[0],
    lastBytes: values[values.length - 1],
    minBytes: Math.min(...values),
    maxBytes: Math.max(...values),
    deltaBytes: values[values.length - 1] - values[0],
    growthEvents,
  };
}

mkdirSync(OUT_DIR, { recursive: true });
const breadcrumbFd = openSync(BREADCRUMB_PATH, "w");

const oracle = await loadOracle();
const corpus = await loadBenchmarkCorpus();
const testCase = corpus.find((x) => x.id === 22);
if (!testCase) throw new Error("Benchmark #22 not found");

const trace = oracle.tracePuzzle(testCase.puzzle, testCase.solution);
if (trace.soundnessProblem) {
  throw new Error("#22 JS oracle soundness failure: " + JSON.stringify(trace.soundnessProblem));
}

const core = await instantiateCore(WASM_URL);
let currentState = null;
let standaloneCallOrdinal = 0;
let lastBreadcrumb = null;
const breadcrumbRecords = [];

setStandaloneDiagnosticHook(({ core: hookCore, techniqueId, technique }) => {
  standaloneCallOrdinal++;
  const bytes = memoryBytes(hookCore);
  const record = {
    puzzleId: 22,
    solverStep: currentState?.step ?? null,
    standaloneCallOrdinal,
    techniqueId,
    techniqueKey: technique,
    stateId: currentState?.stateId ?? null,
    wasmMemoryBytes: bytes,
    wasmMemoryPages: Number.isFinite(bytes) ? bytes / 65536 : null,
  };
  lastBreadcrumb = record;
  breadcrumbRecords.push(record);

  // Synchronous file write happens before the finder call. A catchable WASM trap
  // therefore cannot erase the identity of the invocation that was entered.
  const line = JSON.stringify(record) + "\n";
  writeSync(breadcrumbFd, line, null, "utf8");
  process.stderr.write("WASM_STANDALONE_PRE " + line);
});

let passed = 0;
let trapped = null;

try {
  for (const step of trace.trace) {
    const beforeMasks = Array.from(step.beforeMasks, Number);
    currentState = {
      step: step.step,
      beforeGrid: step.beforeGrid,
      beforeMasks,
      stateId: fingerprint(step.beforeGrid, beforeMasks),
    };

    const grid = gridFromString(step.beforeGrid);
    loadPosition(core, grid, beforeMasks);
    loadGivenGrid(core, testCase.puzzle);

    let finding;
    try {
      finding = findNextStepWasm(core, {
        budgetLimit: 6790,
        validator: (candidate) => !!oracle.validateFindingAgainstSolution(candidate, testCase.solution),
      });
    } catch (error) {
      const isUnreachable =
        (error instanceof WebAssembly.RuntimeError || error?.name === "RuntimeError") &&
        /unreachable/i.test(String(error?.message || error));
      if (!isUnreachable) throw error;

      trapped = {
        status: "trap",
        errorName: error?.name ?? null,
        errorMessage: String(error?.message || error),
        puzzleId: 22,
        solverStep: currentState.step,
        standaloneCallOrdinal: lastBreadcrumb?.standaloneCallOrdinal ?? null,
        techniqueId: lastBreadcrumb?.techniqueId ?? null,
        techniqueKey: lastBreadcrumb?.techniqueKey ?? null,
        stateId: currentState.stateId,
        beforeGrid: currentState.beforeGrid,
        beforeMasks: currentState.beforeMasks,
        memoryAtPreCall: lastBreadcrumb
          ? {
              wasmMemoryBytes: lastBreadcrumb.wasmMemoryBytes,
              wasmMemoryPages: lastBreadcrumb.wasmMemoryPages,
            }
          : null,
        memoryAcrossStandaloneCalls: memorySummary(breadcrumbRecords),
        passedStepsBeforeTrap: passed,
        oracleTraceSteps: trace.trace.length,
      };
      break;
    }

    assert.deepEqual(
      finding,
      hostClone(step.finding),
      "#22 step " + step.step + " selected Finding mismatch",
    );
    passed++;
  }
} finally {
  setStandaloneDiagnosticHook(null);
  closeSync(breadcrumbFd);
}

const result = trapped || {
  status: "no-trap",
  puzzleId: 22,
  passedSteps: passed,
  oracleTraceSteps: trace.trace.length,
  standaloneCalls: standaloneCallOrdinal,
  lastStandaloneCall: lastBreadcrumb,
  memoryAcrossStandaloneCalls: memorySummary(breadcrumbRecords),
};

writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2) + "\n", "utf8");
console.log("BENCHMARK_22_DIAGNOSTIC_RESULT " + JSON.stringify(result));

if (trapped) {
  console.log(
    "STOP first RuntimeError: unreachable at #22 step " + trapped.solverStep +
    ", standalone call " + trapped.standaloneCallOrdinal +
    ", technique " + trapped.techniqueId + "/" + trapped.techniqueKey +
    ", state " + trapped.stateId,
  );
} else {
  console.log("NO_TRAP benchmark #22 completed under the isolated historical implementation.");
}
