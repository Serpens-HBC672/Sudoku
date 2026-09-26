import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  instantiateCore,
  loadPosition,
  runDynamicNishioFinder,
  runDynamicUnaryFinder,
} from "../bridge/assembly-core.mjs";
import { loadOracle } from "../tests/load-oracle.mjs";
import { loadBenchmarkCorpus } from "../tests/benchmark-corpus.mjs";

const WASM_URL = new URL("../build/sudoku-techniques.wasm", import.meta.url);
const BUDGET = 6790;

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function parseIds(raw) {
  return (raw || "22").split(",").map(Number).filter(Number.isFinite);
}

function gridStringToArray(text) {
  return Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => Number(text[r * 9 + c])),
  );
}

function hostClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function percentile(values, p) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const ids = parseIds(argValue("--ids"));
const outDir = resolve(argValue("--out") || "benchmark-results");
await mkdir(outDir, { recursive: true });

const oracle = await loadOracle();
const corpus = await loadBenchmarkCorpus();
const core = await instantiateCore(WASM_URL);
const report = {
  schema: "sudoku-wasm-dfc-benchmark/v1",
  budget: BUDGET,
  note: "Diagnostic same-runner benchmark. JS is already JIT-warmed by trace generation; WASM gets one untimed warm-up on each measured state.",
  cases: [],
};

for (const id of ids) {
  const testCase = corpus.find((entry) => entry.id === id);
  if (!testCase) throw new Error("Unknown benchmark id #" + id);

  const traceStart = performance.now();
  const trace = oracle.tracePuzzle(testCase.puzzle, testCase.solution, 512, true);
  const traceMs = performance.now() - traceStart;
  if (trace.soundnessProblem) {
    throw new Error("#" + id + " JS oracle soundness failure: " + JSON.stringify(trace.soundnessProblem));
  }

  const dynamicSteps = trace.trace.filter((step) =>
    step.finding.technique === "dynamicNishioChain" ||
    step.finding.technique === "dynamicUnaryChain"
  );
  if (!dynamicSteps.length) {
    throw new Error("#" + id + " contains no Dynamic Nishio/Unary step in the current JS oracle trace");
  }

  // Measure the first real DFC state. This is intentionally not every DFC step:
  // trace generation has already paid the full-board JS cost, and repeating all
  // heavy states would turn a diagnostic benchmark into a several-minute CI tax.
  const step = dynamicSteps[0];
  const grid = gridStringToArray(step.beforeGrid);
  const masks = Array.from(step.beforeMasks, Number);
  loadPosition(core, grid, masks);

  const jsRunner = step.finding.technique === "dynamicNishioChain"
    ? () => oracle.findDynamicNishioFromMasks(grid, masks, BUDGET)
    : () => oracle.findDynamicUnaryFromMasks(grid, masks, BUDGET);
  const wasmRunner = step.finding.technique === "dynamicNishioChain"
    ? () => runDynamicNishioFinder(core, BUDGET)
    : () => runDynamicUnaryFinder(core, BUDGET);

  // One WASM warm-up removes first-call instantiation/tiering noise. The JS
  // implementation has already run this technique while generating the trace.
  const warm = wasmRunner();
  assert.deepEqual(warm.finding, hostClone(step.finding), "#" + id + " WASM warm-up Finding mismatch");

  const jsStart = performance.now();
  const js = jsRunner();
  const jsMs = performance.now() - jsStart;

  const wasmSamples = [];
  let wasm = null;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    wasm = wasmRunner();
    wasmSamples.push(performance.now() - t0);
  }
  const wasmMedianMs = percentile(wasmSamples, 0.5);

  assert.deepEqual(wasm.finding, hostClone(js.finding), "#" + id + " JS-WASM Finding mismatch");
  assert.equal(wasm.budgetCalls, js.budgetCalls, "#" + id + " JS-WASM budget-call mismatch");
  assert.deepEqual(wasm.finding, hostClone(step.finding), "#" + id + " measured Finding differs from trace");

  const speedup = jsMs / wasmMedianMs;
  const entry = {
    id,
    source: testCase.source,
    recordedWholePuzzleJsMs: testCase.recordedMs,
    oracleTraceMs: traceMs,
    oracleSteps: trace.trace.length,
    dynamicStepCount: dynamicSteps.length,
    measuredStepIndex: step.step,
    technique: step.finding.technique,
    budgetCalls: js.budgetCalls,
    jsMs,
    wasmSamplesMs: wasmSamples,
    wasmMedianMs,
    speedup,
  };
  report.cases.push(entry);

  console.log(
    "#" + id + " " + entry.technique +
    " step=" + entry.measuredStepIndex +
    " calls=" + entry.budgetCalls +
    " JS=" + jsMs.toFixed(2) + "ms" +
    " WASM(median)=" + wasmMedianMs.toFixed(2) + "ms" +
    " speedup=" + speedup.toFixed(2) + "x",
  );
}

await writeFile(resolve(outDir, "dfc-benchmark.json"), JSON.stringify(report, null, 2) + "\n");

const rows = report.cases.map((entry) =>
  "| #" + entry.id +
  " | " + entry.technique +
  " | " + entry.budgetCalls +
  " | " + entry.jsMs.toFixed(2) +
  " | " + entry.wasmMedianMs.toFixed(2) +
  " | " + entry.speedup.toFixed(2) + "x |"
);
const md = [
  "# DFC hotspot benchmark",
  "",
  "Same GitHub runner, full DFC budget 6790. JS is JIT-warmed by oracle trace generation; WASM receives one untimed warm-up per measured state. This is a diagnostic hotspot result, not yet the final whole-application benchmark.",
  "",
  "| Case | Technique | propagate calls | JS ms | WASM median ms | Speedup |",
  "|---:|---|---:|---:|---:|---:|",
  ...rows,
  "",
].join("\n");
await writeFile(resolve(outDir, "dfc-benchmark.md"), md);

console.log("Wrote " + resolve(outDir, "dfc-benchmark.json"));
