import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadOracle } from "../tests/load-oracle.mjs";
import { loadBenchmarkCorpus } from "../tests/benchmark-corpus.mjs";

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function parseIds(raw, allIds) {
  if (!raw || raw === "all") return allIds;
  const wanted = new Set(
    raw.split(",").flatMap((part) => {
      const m = part.match(/^(\d+)-(\d+)$/);
      if (!m) return [Number(part)];
      const start = Number(m[1]);
      const end = Number(m[2]);
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }),
  );
  return allIds.filter((id) => wanted.has(id));
}

function gridStringToArray(text) {
  return Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => Number(text[r * 9 + c])),
  );
}

const includeCoverage = process.argv.includes("--coverage");
const coverageStride = Math.max(1, Number(argValue("--coverage-stride") || 1));
const coverageMaxStates = Math.max(1, Number(argValue("--coverage-max-states") || 512));
const outDir = resolve(argValue("--out") || "oracle-traces");

const oracle = await loadOracle();
const corpus = await loadBenchmarkCorpus();
const ids = parseIds(argValue("--ids"), corpus.map((entry) => entry.id));

await mkdir(outDir, { recursive: true });
const globalCoverage = new Set();
const summary = [];

for (const testCase of corpus.filter((entry) => ids.includes(entry.id))) {
  const started = performance.now();
  const trace = oracle.tracePuzzle(testCase.puzzle, testCase.solution);
  if (trace.soundnessProblem) {
    throw new Error("#" + testCase.id + " oracle soundness failure: " + JSON.stringify(trace.soundnessProblem));
  }

  let scannedStates = 0;
  if (includeCoverage) {
    for (let i = 0; i < trace.trace.length && scannedStates < coverageMaxStates; i += coverageStride) {
      const step = trace.trace[i];
      const findings = oracle.enumerateAvailableFromMasks(
        gridStringToArray(step.beforeGrid),
        step.beforeMasks,
        testCase.puzzle,
        testCase.solution,
      );
      step.availableFindings = findings;
      step.availableTechniques = findings.map((finding) => finding.technique);
      for (const technique of step.availableTechniques) globalCoverage.add(technique);
      scannedStates++;
    }
  }

  const selectedTechniques = new Set(trace.trace.map((step) => step.finding.technique));
  for (const technique of selectedTechniques) globalCoverage.add(technique);

  const payload = {
    schema: "sudoku-js-oracle-trace/v1",
    source: {
      devver: "Sudoku v3.23.3-rc.3 - DevVer.html",
      benchmarkId: testCase.id,
      benchmarkSource: testCase.source,
    },
    benchmark: {
      puzzle: testCase.puzzleString,
      solution: testCase.solutionString,
      recordedMs: testCase.recordedMs,
      recordedHighestTechnique: testCase.recordedHighestTechnique,
    },
    coverageScan: includeCoverage
      ? { enabled: true, stride: coverageStride, maxStates: coverageMaxStates, scannedStates }
      : { enabled: false },
    oracle: trace,
  };

  const filename = String(testCase.id).padStart(3, "0") + ".json";
  await writeFile(resolve(outDir, filename), JSON.stringify(payload, null, 2) + "\n");

  const elapsedMs = performance.now() - started;
  summary.push({
    id: testCase.id,
    steps: trace.trace.length,
    complete: trace.complete,
    stalled: trace.stalled,
    elapsedMs: Math.round(elapsedMs),
    selectedTechniques: [...selectedTechniques],
    coverageStates: scannedStates,
  });
  console.log(
    "#" + testCase.id + ": " + trace.trace.length + " steps, complete=" + trace.complete + ", " +
      elapsedMs.toFixed(0) + "ms" + (includeCoverage ? ", coverage states=" + scannedStates : ""),
  );
}

const techniqueKeys = oracle.techniqueKeys();
const coverage = {
  schema: "sudoku-technique-coverage/v1",
  techniqueCount: techniqueKeys.length,
  coveredCount: globalCoverage.size,
  covered: techniqueKeys.filter((key) => globalCoverage.has(key)),
  uncovered: techniqueKeys.filter((key) => !globalCoverage.has(key)),
  cases: summary,
};
await writeFile(resolve(outDir, "coverage-summary.json"), JSON.stringify(coverage, null, 2) + "\n");

console.log(
  "Coverage observed: " + coverage.coveredCount + "/" + coverage.techniqueCount +
    ". Use --coverage to invoke the existing all-techniques scanner on trace states; " +
    "this can be very expensive on DFC-heavy boards.",
);
