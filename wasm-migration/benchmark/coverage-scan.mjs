import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadOracle } from "../tests/load-oracle.mjs";
import { loadBenchmarkCorpus } from "../tests/benchmark-corpus.mjs";

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
function parseIds(raw, defaults) {
  if (!raw || raw === "all") return defaults;
  return raw.split(",").flatMap((part) => {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (!m) return [Number(part)];
    const a = Number(m[1]), b = Number(m[2]);
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }).filter(Number.isFinite);
}
function gridStringToArray(text) {
  return Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => Number(text[r * 9 + c])),
  );
}

const outDir = resolve(argValue("--out") || "coverage-results");
const oracle = await loadOracle();
const corpus = await loadBenchmarkCorpus();
const allIds = corpus.map((entry) => entry.id);
const traceIds = parseIds(argValue("--trace-ids") || "all", allIds);
const allAvailableIds = new Set(parseIds(argValue("--all-available-ids") || "11,34,47,53,57", allIds));
const maxAvailableStates = Math.max(0, Number(argValue("--max-available-states") || 1));

await mkdir(outDir, { recursive: true });

const techniqueKeys = oracle.techniqueKeys();
const firstMatch = new Set();
const allAvailable = new Set();
const cases = [];
let soundnessFailures = 0;

for (const testCase of corpus.filter((entry) => traceIds.includes(entry.id))) {
  const t0 = performance.now();
  const trace = oracle.tracePuzzle(testCase.puzzle, testCase.solution);
  const elapsedMs = performance.now() - t0;
  if (trace.soundnessProblem) {
    soundnessFailures++;
    throw new Error("#" + testCase.id + " soundness failure: " + JSON.stringify(trace.soundnessProblem));
  }
  for (const step of trace.trace) firstMatch.add(step.finding.technique);

  let availableStatesScanned = 0;
  if (allAvailableIds.has(testCase.id) && maxAvailableStates > 0 && trace.trace.length) {
    // Sample stable positions from early/middle/late trace while keeping the
    // all-53 scan bounded. De-duplicate indices if the trace is short.
    const candidates = [
      0,
      Math.floor((trace.trace.length - 1) / 2),
      Math.max(0, trace.trace.length - 1),
    ];
    const indices = [...new Set(candidates)].slice(0, maxAvailableStates);
    for (const stepIndex of indices) {
      const step = trace.trace[stepIndex];
      const findings = oracle.enumerateAvailableFromMasks(
        gridStringToArray(step.beforeGrid),
        step.beforeMasks,
        testCase.puzzle,
        testCase.solution,
      );
      for (const finding of findings) allAvailable.add(finding.technique);
      availableStatesScanned++;
    }
  }

  cases.push({
    id: testCase.id,
    name: testCase.name,
    steps: trace.trace.length,
    complete: trace.complete,
    stalled: trace.stalled,
    elapsedMs,
    selectedTechniques: [...new Set(trace.trace.map((step) => step.finding.technique))],
    allAvailableStatesScanned: availableStatesScanned,
  });
  console.log(
    "#" + testCase.id + " steps=" + trace.trace.length +
    " complete=" + trace.complete + " ms=" + elapsedMs.toFixed(1) +
    " allAvailableStates=" + availableStatesScanned,
  );
}

const union = new Set([...firstMatch, ...allAvailable]);
const report = {
  schema: "sudoku-technique-coverage/v2",
  registryCount: techniqueKeys.length,
  registry: techniqueKeys,
  traceIds,
  firstMatch: {
    count: firstMatch.size,
    techniques: techniqueKeys.filter((key) => firstMatch.has(key)),
    notObserved: techniqueKeys.filter((key) => !firstMatch.has(key)),
  },
  allAvailable: {
    policy: {
      ids: [...allAvailableIds],
      maxStatesPerCase: maxAvailableStates,
      selection: "first/middle/last unique trace states, truncated to maxStatesPerCase",
    },
    scannedStates: cases.reduce((sum, entry) => sum + entry.allAvailableStatesScanned, 0),
    count: allAvailable.size,
    techniques: techniqueKeys.filter((key) => allAvailable.has(key)),
  },
  union: {
    count: union.size,
    techniques: techniqueKeys.filter((key) => union.has(key)),
    notObserved: techniqueKeys.filter((key) => !union.has(key)),
  },
  soundnessFailures,
  cases,
};
await writeFile(resolve(outDir, "coverage-report.json"), JSON.stringify(report, null, 2) + "\n");

const md = [
  "# Technique coverage",
  "",
  "Generated from the frozen JS oracle. First-match tracing and all-available enumeration are reported separately.",
  "",
  "- Registered techniques: " + report.registryCount,
  "- First-match observed: " + report.firstMatch.count + "/" + report.registryCount,
  "- All-available observed in bounded scan: " + report.allAvailable.count + "/" + report.registryCount,
  "- Union observed: " + report.union.count + "/" + report.registryCount,
  "- Soundness failures: " + report.soundnessFailures,
  "- All-available states scanned: " + report.allAvailable.scannedStates,
  "",
  "## First-match observed",
  "",
  report.firstMatch.techniques.join(", ") || "(none)",
  "",
  "## All-available observed",
  "",
  report.allAvailable.techniques.join(", ") || "(none)",
  "",
  "## Not observed by either scan",
  "",
  report.union.notObserved.join(", ") || "(none)",
  "",
  "## Scan policy",
  "",
  "All 57 benchmark cases are traced for first-match coverage. The expensive existing findAllAvailableSteps path is only invoked on the documented bounded state sample: benchmark ids " +
    [...allAvailableIds].join(", ") + ", at up to " + maxAvailableStates + " state(s) per case.",
  "",
].join("\n");
await writeFile(resolve(outDir, "COVERAGE.generated.md"), md + "\n");
console.log("COVERAGE first=" + report.firstMatch.count + "/" + report.registryCount +
  " allAvailable=" + report.allAvailable.count + "/" + report.registryCount +
  " union=" + report.union.count + "/" + report.registryCount);
