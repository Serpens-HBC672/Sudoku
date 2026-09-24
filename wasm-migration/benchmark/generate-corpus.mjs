import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadBenchmarkCorpus, BENCHMARK_FILENAME } from "../tests/benchmark-corpus.mjs";

const outArg = process.argv.indexOf("--out");
const outPath = resolve(outArg >= 0 ? process.argv[outArg + 1] : "benchmark/corpus.json");
const corpus = await loadBenchmarkCorpus();
await mkdir(dirname(outPath), { recursive: true });

const payload = {
  schema: "sudoku-benchmark-corpus/v1",
  source: {
    filename: BENCHMARK_FILENAME,
    sha256: corpus[0]?.benchmarkSha256 || null,
  },
  count: corpus.length,
  cases: corpus.map((entry) => ({
    id: entry.id,
    name: entry.name,
    metadata: entry.metadata,
    puzzle: entry.puzzleString,
    solution: entry.solutionString,
    recordedMs: entry.recordedMs,
    recordedHighestTechnique: entry.recordedHighestTechnique,
    difficulty: entry.difficulty,
  })),
};

await writeFile(outPath, JSON.stringify(payload, null, 2) + "\n");
console.log(`Wrote ${outPath} with ${payload.count} validated benchmark cases.`);
