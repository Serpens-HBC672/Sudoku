import { readFile } from "node:fs/promises";
import {
  instantiateCore,
  loadPosition,
  loadGivenGrid,
  runStandaloneTechniqueFinder,
  findNextStepWasm,
} from "../bridge/sudoku-wasm-adapter.js";
import { loadOracle } from "./load-oracle.mjs";
import { loadBenchmarkCorpus } from "./benchmark-corpus.mjs";

const wasmArg = process.argv[2] || "../build/sudoku-techniques.wasm";
const wasmBytes = new Uint8Array(await readFile(new URL(wasmArg, import.meta.url)));
const core = await instantiateCore(wasmBytes);
const oracle = await loadOracle();
const corpus = await loadBenchmarkCorpus();
const testCase = corpus.find((entry) => entry.id === 22) || corpus[0];
const masks = Array.from(oracle.candidateMasksForGrid(testCase.puzzle), Number);

function memory() {
  const bytes = core.memory.buffer.byteLength;
  return { bytes, pages: bytes / 65536 };
}

loadPosition(core, testCase.puzzle, masks);
loadGivenGrid(core, testCase.puzzle);

const standaloneIds = [0, 1, 2, 28, 35, 40, 41, 46, 47, 48, 49];
const standalone = [];
for (const id of standaloneIds) {
  let finding = null;
  let error = null;
  try {
    finding = runStandaloneTechniqueFinder(core, id);
  } catch (e) {
    error = { name:e?.name ?? null, message:String(e?.message || e), stack:String(e?.stack || "") };
  }
  standalone.push({ id, finding, error, memory:memory() });
  if (error) break;
}

let result = null;
let error = null;
try {
  result = findNextStepWasm(core, { budgetLimit:64 });
} catch (e) {
  error = {
    name:e?.name ?? null,
    message:String(e?.message || e),
    stack:String(e?.stack || ""),
  };
}

const out = {
  caseId:testCase.id,
  standaloneIds,
  standalone,
  findNextResult:result,
  findNextError:error,
  lastTechniqueSearchId:typeof core.debugLastTechniqueSearchId === "function"
    ? core.debugLastTechniqueSearchId()
    : null,
  memory:memory(),
};
console.log("WORKER_FINDNEXT_DIAG " + JSON.stringify(out));
process.exit(error ? 2 : 0);
