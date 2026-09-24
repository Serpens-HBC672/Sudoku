import { readFile } from "node:fs/promises";

function makeAbort(memory) {
  return (messagePtr, filePtr, line, column) => {
    throw new Error(`AssemblyScript abort at ${line}:${column} (message=${messagePtr}, file=${filePtr})`);
  };
}

export async function instantiateCore(source) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(await readFile(source));
  const imports = { env: { abort: makeAbort() } };
  const { instance } = await WebAssembly.instantiate(bytes, imports);
  return instance.exports;
}

export function loadPosition(core, grid, masks) {
  if (!Array.isArray(grid) || grid.length !== 9 || !grid.every((row) => Array.isArray(row) && row.length === 9)) {
    throw new Error("grid must be a 9x9 array");
  }
  if (!Array.isArray(masks) || masks.length !== 81) {
    throw new Error("masks must contain exactly 81 entries");
  }

  core.resetInput();
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const index = r * 9 + c;
      core.setInputCell(index, grid[r][c] | 0);
      core.setInputMask(index, masks[index] & 0x1ff);
    }
  }
}

export function decodeFact(k) {
  const digit = (k % 9) + 1;
  const q = (k - (digit - 1)) / 9;
  const c = q % 9;
  const r = (q - c) / 9;
  return { r, c, digit };
}

export function runStaticAssumption(core, r, c, digit, startTrue) {
  const contradiction = !!core.runStaticAssumption(r, c, digit, startTrue ? 1 : 0);
  const trueFacts = [];
  const falseFacts = [];
  for (let i = 0; i < core.resultTrueCount(); i++) trueFacts.push(core.resultTrueFactAt(i));
  for (let i = 0; i < core.resultFalseCount(); i++) falseFacts.push(core.resultFalseFactAt(i));

  const grid = Array.from({ length: 9 }, (_, rr) =>
    Array.from({ length: 9 }, (_, cc) => core.resultGridCell(rr * 9 + cc)),
  );

  return {
    contradiction,
    guardIterations: core.resultGuardIterations(),
    trueFacts,
    falseFacts,
    grid,
  };
}
