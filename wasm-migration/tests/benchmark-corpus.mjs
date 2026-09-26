import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const BENCHMARK_URL = new URL("../../求解器的数独基准测试盘面参考.txt", import.meta.url);
export const BENCHMARK_FILENAME = "求解器的数独基准测试盘面参考.txt";

function gridStringToArray(text, kind) {
  const compact = text.replace(/\s+/g, "");
  const pattern = kind === "solution" ? /^[1-9]{81}$/ : /^[0-9]{81}$/;
  if (!pattern.test(compact)) {
    throw new Error(
      kind === "solution"
        ? "Expected solution to contain exactly 81 digits in 1..9"
        : "Expected puzzle to contain exactly 81 cells in 0..9",
    );
  }
  return Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => Number(compact[r * 9 + c])),
  );
}

function parseDifficulty(block) {
  const line = block.split("\n").find((entry) => entry.startsWith("»")) || "";
  const peak = line.match(/峰值\s*([0-9.]+)/);
  const cumulative = line.match(/累加\s*([0-9.]+)/);
  const classification = line.match(/定性为([^。\n]+)/);
  const highest = line.match(/最高技巧是([^,，\n]+)[,，]/);
  return {
    raw: line || null,
    peakSe: peak ? Number(peak[1]) : null,
    cumulativeSe: cumulative ? Number(cumulative[1]) : null,
    classification: classification ? classification[1].trim() : null,
    highestTechnique: highest ? highest[1].trim() : null,
  };
}

export async function loadBenchmarkCorpus() {
  const raw = await readFile(fileURLToPath(BENCHMARK_URL), "utf8");
  const sourceSha256 = createHash("sha256").update(raw, "utf8").digest("hex");
  const text = raw.replace(/\r\n/g, "\n");
  const blocks = text.split(/\n(?=#\d+\n)/).filter((block) => /^#\d+\n/.test(block));
  if (blocks.length === 0) throw new Error("Benchmark corpus contains no #N blocks");

  const cases = [];
  const seenIds = new Set();

  for (const block of blocks) {
    const idMatch = block.match(/^#(\d+)/);
    const gridMatches = [...block.matchAll(/(?:^|\n)((?:[0-9]{9}\n){8}[0-9]{9})(?=\n|$)/g)];
    if (!idMatch || gridMatches.length !== 2) {
      throw new Error(`Malformed benchmark block: ${block.slice(0, 120)}`);
    }

    const id = Number(idMatch[1]);
    if (seenIds.has(id)) throw new Error(`Duplicate benchmark id #${id}`);
    seenIds.add(id);

    const metadataLine = block.split("\n").find((line) => line.startsWith("-")) || "";
    const metadata = metadataLine ? metadataLine.slice(1).trim() : null;
    const puzzleText = gridMatches[0][1];
    const solutionText = gridMatches[1][1];
    const puzzle = gridStringToArray(puzzleText, "puzzle");
    const solution = gridStringToArray(solutionText, "solution");
    const elapsed = block.match(/本次耗时\s*([0-9.]+)ms/);
    const difficulty = parseDifficulty(block);

    cases.push({
      id,
      name: metadata,
      metadata,
      source: metadata,
      puzzleString: puzzleText.replace(/\n/g, ""),
      solutionString: solutionText.replace(/\n/g, ""),
      puzzle,
      solution,
      recordedMs: elapsed ? Number(elapsed[1]) : null,
      recordedHighestTechnique: difficulty.highestTechnique,
      difficulty,
      benchmarkFilename: BENCHMARK_FILENAME,
      benchmarkSha256: sourceSha256,
    });
  }

  for (let i = 1; i < cases.length; i++) {
    if (cases[i].id <= cases[i - 1].id) {
      throw new Error("Benchmark ids must be strictly increasing");
    }
  }
  return cases;
}

export function factIndex(r, c, d) {
  return r * 81 + c * 9 + (d - 1);
}
