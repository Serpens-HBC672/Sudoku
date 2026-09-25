import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  instantiateCore,
  loadPosition,
  loadGivenGrid,
  findNextStepWasm,
} from "../bridge/assembly-core.mjs";
import { loadOracle } from "./load-oracle.mjs";
import { loadBenchmarkCorpus } from "./benchmark-corpus.mjs";

const WASM_URL = new URL("../build/sudoku-techniques.wasm", import.meta.url);

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
function parseIds(raw, allIds) {
  if (!raw || raw === "all") return allIds;
  const wanted = new Set(raw.split(",").flatMap((part) => {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (!m) return [Number(part)];
    const a = Number(m[1]), b = Number(m[2]);
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }));
  return allIds.filter((id) => wanted.has(id));
}
function gridFromString(text) {
  return Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => Number(text[r * 9 + c])),
  );
}
function hostClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

const oracle = await loadOracle();
const corpus = await loadBenchmarkCorpus();
const ids = parseIds(argValue("--ids") || "11,22,23,25,42,56,57", corpus.map((x) => x.id));
const outDir = resolve(argValue("--out") || "full-differential-results");
await mkdir(outDir, { recursive: true });

const core = await instantiateCore(WASM_URL);
const hash = data => createHash('sha256').update(data).digest('hex');
const identity = {
  wasm: hash(await readFile(WASM_URL)),
  oracle: hash(await readFile(new URL('../../Sudoku v3.23.3-rc.3 - DevVer.html',import.meta.url))),
  bridge: hash(await readFile(new URL('../bridge/assembly-core.mjs',import.meta.url))),
  corpus: hash(await readFile(new URL('../../求解器的数独基准测试盘面参考.txt',import.meta.url))),
  budget:6790,
};
const report = {
  schema: "sudoku-js-wasm-full-trace-differential/v1",
  ids,
  cases: [],
  totalSteps: 0,
  passedSteps: 0,
};

for (const testCase of corpus.filter((x) => ids.includes(x.id))) {
  const casePath = resolve(outDir, 'case-' + testCase.id + '.json');
  try {
    const prior = JSON.parse(await readFile(casePath,'utf8'));
    assert.deepEqual(prior.identity,identity);
    if (prior.status === 'PASS') {
      report.cases.push(prior.summary);
      report.totalSteps += prior.summary.steps;
      report.passedSteps += prior.summary.passed;
      console.log('#' + testCase.id + ' reused hash-matched PASS');
      continue;
    }
  } catch (error) { if(error.code !== 'ENOENT') throw error; }
  const started = performance.now();
  const trace = oracle.tracePuzzle(testCase.puzzle, testCase.solution);
  await writeFile(resolve(outDir,'oracle-' + testCase.id + '.json'),JSON.stringify({identity,trace}));
  if (trace.soundnessProblem) {
    throw new Error("#" + testCase.id + " JS oracle soundness failure: " + JSON.stringify(trace.soundnessProblem));
  }
  let passed = 0;
  for (const step of trace.trace) {
    const grid = gridFromString(step.beforeGrid);
    loadPosition(core, grid, Array.from(step.beforeMasks, Number));
    loadGivenGrid(core, testCase.puzzle);
    let finding;
    try {
      finding = findNextStepWasm(core, {
        budgetLimit: 6790,
        validator: (candidate) => !!oracle.validateFindingAgainstSolution(candidate, testCase.solution),
      });
    } catch (error) {
      console.error("FULL_TRACE_CRASH", JSON.stringify({
        caseId: testCase.id,
        step: step.step,
        expectedTechnique: step.finding.technique,
        lastTechniqueId: typeof core.debugLastTechniqueSearchId === "function" ? core.debugLastTechniqueSearchId() : null,
      }));
      throw error;
    }
    try { assert.deepEqual(
      finding,
      hostClone(step.finding),
      "#" + testCase.id + " step " + step.step + " selected Finding mismatch",
    ); } catch(error) {
      await writeFile(resolve(outDir,'failure-' + testCase.id + '.json'),JSON.stringify({identity,caseId:testCase.id,step,actual:finding,error:String(error)},null,2));
      throw error;
    }
    assert.equal(step.soundnessProblem,null);
    assert.ok(step.beforeMasks.every(mask => (mask & ~511) === 0));
    assert.ok(step.afterMasks.every(mask => (mask & ~511) === 0));
    passed++;
    report.totalSteps++;
    report.passedSteps++;
  }
  const elapsedMs = performance.now() - started;
  assert.equal(trace.complete,true,'trace must finish');
  report.cases.push({
    id: testCase.id,
    name: testCase.name,
    steps: trace.trace.length,
    passed,
    complete: trace.complete,
    stalled: trace.stalled,
    elapsedMs,
  });
  await writeFile(casePath,JSON.stringify({identity,status:'PASS',summary:report.cases.at(-1)},null,2));
  await writeFile(resolve(outDir, "full-differential.json"), JSON.stringify(report,null,2));
  console.log(
    "#" + testCase.id + " full trace PASS " + passed + "/" + trace.trace.length +
    " steps in " + elapsedMs.toFixed(1) + "ms",
  );
}

await writeFile(resolve(outDir, "full-differential.json"), JSON.stringify(report, null, 2) + "\n");
console.log("PASS full selected-finding differential: " + report.passedSteps + "/" + report.totalSteps + " trace steps.");
