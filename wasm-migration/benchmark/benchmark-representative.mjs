import assert from "node:assert/strict";
import os from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  instantiateCore,
  loadPosition,
  loadGivenGrid,
  materializeTechniqueFinding,
} from "../bridge/assembly-core.mjs";
import { loadOracle } from "../tests/load-oracle.mjs";
import { loadBenchmarkCorpus } from "../tests/benchmark-corpus.mjs";

const WASM_URL = new URL("../build/sudoku-techniques.wasm", import.meta.url);
const DEFAULT_IDS = [57, 11, 22, 23, 56, 27, 42];
const BUDGET = 6790;

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
function parseIds(raw) {
  if (!raw) return DEFAULT_IDS;
  return raw.split(",").map(Number).filter(Number.isFinite);
}
function gridFromString(text) {
  return Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => Number(text[r * 9 + c])),
  );
}
function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
function median(values) {
  if (!values.length) return null;
  const a = values.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function stats(samples) {
  return {
    samples,
    median: median(samples),
    min: Math.min(...samples),
    max: Math.max(...samples),
  };
}

const ids = parseIds(argValue("--ids"));
const outDir = resolve(argValue("--out") || "benchmark-results");
await mkdir(outDir, { recursive: true });

const oracle = await loadOracle();
const corpus = await loadBenchmarkCorpus();

const initStart = performance.now();
const core = await instantiateCore(WASM_URL);
const moduleInitializationMs = performance.now() - initStart;

const report = {
  schema: "sudoku-wasm-representative-benchmark/v1",
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().map((cpu) => cpu.model),
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
  },
  wasm: {
    moduleInitializationMs,
    budget: BUDGET,
    language: "AssemblyScript",
  },
  methodology: {
    ids,
    jsRepetitions: "3 for easy/medium (#57/#11), 1 for expensive cases",
    wasmRepetitions: 3,
    warmup: "one untimed complete WASM replay of recorded oracle states per case",
    correctness: "every WASM selected Finding is deep-compared to the frozen JS oracle trace before timing is accepted",
    boundary: "input preparation, WASM search execution, and WASM->JS Finding materialization are timed separately",
  },
  cases: [],
};

for (const id of ids) {
  const testCase = corpus.find((entry) => entry.id === id);
  if (!testCase) throw new Error("Unknown benchmark id #" + id);

  const jsReps = id === 57 || id === 11 ? 3 : 1;
  const jsSamples = [];
  let trace = null;
  for (let rep = 0; rep < jsReps; rep++) {
    const t0 = performance.now();
    trace = oracle.tracePuzzle(testCase.puzzle, testCase.solution);
    jsSamples.push(performance.now() - t0);
    if (trace.soundnessProblem) throw new Error("#" + id + " JS soundness failure");
    if (!trace.complete) throw new Error("#" + id + " JS trace did not complete");
  }

  function runWasmReplay(measure) {
    let inputPrepMs = 0;
    let executionMs = 0;
    let conversionMs = 0;
    let validatorMs = 0;
    const totalStart = performance.now();

    for (const step of trace.trace) {
      const grid = gridFromString(step.beforeGrid);
      const masks = Array.from(step.beforeMasks, Number);

      let t0 = performance.now();
      loadPosition(core, grid, masks);
      loadGivenGrid(core, testCase.puzzle);
      if (measure) inputPrepMs += performance.now() - t0;

      let startId = 0;
      let finding = null;
      while (startId < 53) {
        t0 = performance.now();
        const idFound = core.runFindNextTechniqueIdFrom(startId, BUDGET);
        if (measure) executionMs += performance.now() - t0;
        if (idFound < 0) break;

        t0 = performance.now();
        const candidate = materializeTechniqueFinding(core, idFound, BUDGET);
        if (measure) conversionMs += performance.now() - t0;

        t0 = performance.now();
        const accepted = !!oracle.validateFindingAgainstSolution(candidate, testCase.solution);
        if (measure) validatorMs += performance.now() - t0;
        if (accepted) {
          finding = candidate;
          break;
        }
        startId = idFound + 1;
      }

      assert.deepEqual(
        clone(finding),
        clone(step.finding),
        "#" + id + " step " + step.step + " WASM selected Finding mismatch",
      );
    }
    return {
      inputPrepMs,
      executionMs,
      conversionMs,
      validatorMs,
      totalMs: performance.now() - totalStart,
    };
  }

  runWasmReplay(false);
  const wasmSamples = [];
  for (let rep = 0; rep < 3; rep++) wasmSamples.push(runWasmReplay(true));

  const entry = {
    id,
    name: testCase.name,
    recordedHistoricalJsMs: testCase.recordedMs,
    steps: trace.trace.length,
    jsBaselineMs: stats(jsSamples),
    wasmInputPreparationMs: stats(wasmSamples.map((x) => x.inputPrepMs)),
    wasmExecutionMs: stats(wasmSamples.map((x) => x.executionMs)),
    wasmFindingConversionMs: stats(wasmSamples.map((x) => x.conversionMs)),
    validatorMs: stats(wasmSamples.map((x) => x.validatorMs)),
    wasmEndToEndMs: stats(wasmSamples.map((x) => x.totalMs)),
  };
  entry.speedup = entry.jsBaselineMs.median / entry.wasmEndToEndMs.median;
  report.cases.push(entry);
  console.log(
    "#" + id + " steps=" + entry.steps +
    " JS=" + entry.jsBaselineMs.median.toFixed(2) + "ms" +
    " WASM e2e=" + entry.wasmEndToEndMs.median.toFixed(2) + "ms" +
    " search=" + entry.wasmExecutionMs.median.toFixed(2) + "ms" +
    " speedup=" + entry.speedup.toFixed(2) + "x",
  );
}

await writeFile(resolve(outDir, "results.json"), JSON.stringify(report, null, 2) + "\n");
const rows = report.cases.map((x) =>
  "| #" + x.id + " | " + x.name.replace(/\|/g, "/") + " | " + x.steps +
  " | " + x.jsBaselineMs.median.toFixed(2) +
  " | " + x.wasmInputPreparationMs.median.toFixed(2) +
  " | " + x.wasmExecutionMs.median.toFixed(2) +
  " | " + x.wasmFindingConversionMs.median.toFixed(2) +
  " | " + x.wasmEndToEndMs.median.toFixed(2) +
  " | " + x.speedup.toFixed(2) + "x |"
);
const md = [
  "# Representative JS → WASM benchmark",
  "",
  "All measurements are from the same GitHub Actions runner and Node process. Historical corpus times are retained as metadata only and are not used for speedup ratios.",
  "",
  "- Node: " + report.runtime.node,
  "- Platform: " + report.runtime.platform + " " + report.runtime.arch,
  "- CPU: " + report.runtime.cpus[0],
  "- WASM initialization: " + moduleInitializationMs.toFixed(2) + " ms",
  "- DFC budget: " + BUDGET,
  "",
  "| Case | Workload | Steps | JS baseline ms | input prep ms | WASM search ms | Finding conversion ms | WASM end-to-end ms | Speedup |",
  "|---:|---|---:|---:|---:|---:|---:|---:|---:|",
  ...rows,
  "",
  "The JS baseline is a complete frozen-oracle solve. WASM replays the exact same recorded pre-step states and must reproduce every selected Finding before a timing sample is accepted.",
  "",
].join("\n");
await writeFile(resolve(outDir, "BENCHMARK.generated.md"), md + "\n");
console.log("Wrote representative benchmark results for " + report.cases.length + " cases.");
