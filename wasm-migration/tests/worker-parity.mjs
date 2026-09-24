import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import {
  instantiateCore,
  loadPosition,
  loadGivenGrid,
  runStandaloneTechniqueFinder,
  runDynamicNishioFinder,
  runDynamicUnaryFinder,
  runDynamicMultipleFinder,
  findNextStepWasm,
  findAllAvailableStepsWasm,
} from "../bridge/sudoku-wasm-adapter.js";
import { loadOracle } from "./load-oracle.mjs";
import { loadBenchmarkCorpus } from "./benchmark-corpus.mjs";

const wasmBytes = new Uint8Array(await readFile(new URL("../build/sudoku-techniques.wasm", import.meta.url)));
const mainCore = await instantiateCore(wasmBytes);
const oracle = await loadOracle();
const corpus = await loadBenchmarkCorpus();
const testCase = corpus.find((entry) => entry.id === 22) || corpus[0];
const masks = Array.from(oracle.candidateMasksForGrid(testCase.puzzle), Number);
loadPosition(mainCore, testCase.puzzle, masks);
loadGivenGrid(mainCore, testCase.puzzle);

const worker = new Worker(new URL("./worker-adapter-node.mjs", import.meta.url), { type: "module" });
let seq = 0;
function call(message, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const handler = (reply) => {
      if (reply.id !== id) return;
      worker.off("message", handler);
      if (!reply.ok) reject(new Error(reply.error));
      else resolve(reply.result);
    };
    worker.on("message", handler);
    worker.postMessage({ id, ...message }, transfer);
  });
}

const copy = wasmBytes.slice();
await call({ type: "init", wasm: copy.buffer }, [copy.buffer]);
await call({ type: "load", grid: testCase.puzzle, masks, givenGrid: testCase.puzzle });

for (const id of [0, 1, 2, 28, 35, 40, 41, 46, 47, 48, 49]) {
  const main = runStandaloneTechniqueFinder(mainCore, id);
  const threaded = await call({ type: "standalone", techniqueId: id });
  assert.deepEqual(threaded, main, "main/Worker mismatch for standalone technique id " + id);
}
const mainNext = findNextStepWasm(mainCore, { budgetLimit: 64 });
const workerNext = await call({ type: "findNext", budgetLimit: 64 });
assert.deepEqual(workerNext, mainNext, "main/Worker mismatch for coarse findNext");

const mainAll = findAllAvailableStepsWasm(mainCore, { budgetLimit: 64 });
const workerAll = await call({ type: "findAll", budgetLimit: 64 });
assert.deepEqual(workerAll, mainAll, "main/Worker mismatch for coarse findAll");

for (const [type, runner] of [
  ["dynamicNishio", runDynamicNishioFinder],
  ["dynamicUnary", runDynamicUnaryFinder],
  ["dynamicMultiple", runDynamicMultipleFinder],
]) {
  const main = runner(mainCore, 64);
  const threaded = await call({ type, budgetLimit: 64 });
  assert.deepEqual(threaded, main, "main/Worker mismatch for " + type);
}
await worker.terminate();
console.log("PASS shared main-thread/Worker WASM adapter parity on benchmark #" + testCase.id + ".");
