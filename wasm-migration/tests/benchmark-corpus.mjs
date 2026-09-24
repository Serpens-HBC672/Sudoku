import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const BENCHMARK_URL = new URL("../../求解器的数独基准测试盘面参考.txt", import.meta.url);

function gridStringToArray(text) {
  const compact = text.replace(/\s+/g, "");
  if (!/^[0-9]{81}$/.test(compact)) throw new Error("Expected an 81-digit grid string");
  return Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => Number(compact[r * 9 + c])),
  );
}

export async function loadBenchmarkCorpus() {
  const text = await readFile(fileURLToPath(BENCHMARK_URL), "utf8");
  const blocks = text.split(/\n(?=#\d+\n)/).filter((block) => /^#\d+\n/.test(block));
  const cases = [];

  for (const block of blocks) {
    const idMatch = block.match(/^#(\d+)/);
    const gridMatches = [...block.matchAll(/(?:^|\n)((?:[0-9]{9}\n){8}[0-9]{9})(?=\n|$)/g)];
    if (!idMatch || gridMatches.length < 2) {
      throw new Error(`Malformed benchmark block: ${block.slice(0, 80)}`);
    }
    const puzzleText = gridMatches[0][1];
    const solutionText = gridMatches[1][1];
    const elapsed = block.match(/本次耗时\s*([0-9.]+)ms/);
    const highest = block.match(/最高技巧是([^,，\n]+)[,，]/);
    const sourceLine = block.split("\n").find((line) => line.startsWith("-")) || "";

    cases.push({
      id: Number(idMatch[1]),
      source: sourceLine.slice(1),
      puzzleString: puzzleText.replace(/\n/g, ""),
      solutionString: solutionText.replace(/\n/g, ""),
      puzzle: gridStringToArray(puzzleText),
      solution: gridStringToArray(solutionText),
      recordedMs: elapsed ? Number(elapsed[1]) : null,
      recordedHighestTechnique: highest ? highest[1] : null,
    });
  }

  if (cases.length !== 57) throw new Error(`Expected 57 benchmark cases, found ${cases.length}`);
  return cases;
}

export function factIndex(r, c, d) {
  return r * 81 + c * 9 + (d - 1);
}
