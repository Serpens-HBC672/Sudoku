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

function readPropagationResult(core, contradiction) {
  const trueFacts = [];
  const falseFacts = [];
  for (let i = 0; i < core.resultTrueCount(); i++) trueFacts.push(core.resultTrueFactAt(i));
  for (let i = 0; i < core.resultFalseCount(); i++) falseFacts.push(core.resultFalseFactAt(i));

  const grid = Array.from({ length: 9 }, (_, rr) =>
    Array.from({ length: 9 }, (_, cc) => core.resultGridCell(rr * 9 + cc)),
  );

  return {
    contradiction: !!contradiction,
    aborted: typeof core.resultAborted === "function" ? !!core.resultAborted() : false,
    budgetCalls: typeof core.resultBudgetCalls === "function" ? core.resultBudgetCalls() : null,
    guardIterations: core.resultGuardIterations(),
    trueFacts,
    falseFacts,
    grid,
  };
}

export function runStaticAssumption(core, r, c, digit, startTrue) {
  return readPropagationResult(
    core,
    core.runStaticAssumption(r, c, digit, startTrue ? 1 : 0),
  );
}

export function runDynamicAssumption(core, r, c, digit, startTrue, budgetLimit = 6790) {
  return readPropagationResult(
    core,
    core.runDynamicAssumption(r, c, digit, startTrue ? 1 : 0, budgetLimit),
  );
}


function readFinderEliminations(core) {
  const eliminations = [];
  for (let i = 0; i < core.finderResultEliminationCount(); i++) {
    const fact = decodeFact(core.finderResultEliminationFactAt(i));
    eliminations.push({ r: fact.r, c: fact.c, digit: fact.digit });
  }
  return eliminations;
}

export function runDynamicNishioFinder(core, budgetLimit = 6790) {
  core.runDynamicNishioFinder(budgetLimit);
  const actionType = core.finderResultActionType();
  const budgetCalls = core.resultBudgetCalls();
  if (actionType === 0) return { finding: null, budgetCalls, budgetLimit };

  const r = core.finderResultStartR();
  const c = core.finderResultStartC();
  const d = core.finderResultStartDigit();
  return {
    finding: {
      actionType: "eliminate",
      technique: "dynamicNishioChain",
      patternCells: [[r, c]],
      eliminations: readFinderEliminations(core),
      context: { r, c, d, branches: null },
    },
    budgetCalls,
    budgetLimit,
  };
}

export function runDynamicUnaryFinder(core, budgetLimit = 6790) {
  core.runDynamicUnaryFinder(budgetLimit);
  const actionType = core.finderResultActionType();
  const budgetCalls = core.resultBudgetCalls();
  if (actionType === 0) return { finding: null, budgetCalls, budgetLimit };

  const startR = core.finderResultStartR();
  const startC = core.finderResultStartC();
  const startDigit = core.finderResultStartDigit();

  if (actionType === 1) {
    const r = core.finderResultR();
    const c = core.finderResultC();
    const digit = core.finderResultDigit();
    return {
      finding: {
        actionType: "fill",
        technique: "dynamicUnaryChain",
        r,
        c,
        digit,
        patternCells: [[startR, startC]],
        context: {
          startCell: [startR, startC],
          startDigit,
          concludeCell: [r, c],
          concludeDigit: digit,
          concludeValue: true,
          branches: null,
        },
      },
      budgetCalls,
      budgetLimit,
    };
  }

  const eliminations = readFinderEliminations(core);
  return {
    finding: {
      actionType: "eliminate",
      technique: "dynamicUnaryChain",
      patternCells: [[startR, startC]],
      eliminations,
      context: {
        startCell: [startR, startC],
        startDigit,
        concludeValue: false,
        eliminationCount: eliminations.length,
        branches: null,
      },
    },
    budgetCalls,
    budgetLimit,
  };
}


function maskToDigits(mask) {
  const digits = [];
  for (let d = 1; d <= 9; d++) if (mask & (1 << (d - 1))) digits.push(d);
  return digits;
}

function readFinderPatternCells(core) {
  const cells = [];
  for (let i = 0; i < core.finderResultPatternCellCount(); i++) {
    const index = core.finderResultPatternCellAt(i);
    cells.push([Math.floor(index / 9), index % 9]);
  }
  return cells;
}

export function runDynamicMultipleFinder(core, budgetLimit = 6790) {
  core.runDynamicMultipleFinder(budgetLimit);
  const actionType = core.finderResultActionType();
  const budgetCalls = core.resultBudgetCalls();
  if (actionType === 0) return { finding: null, budgetCalls, budgetLimit };

  const kindCode = core.finderResultKind();
  const patternCells = readFinderPatternCells(core);
  const eliminations = actionType === 2 ? readFinderEliminations(core) : null;
  const resultR = core.finderResultR();
  const resultC = core.finderResultC();
  const resultDigit = core.finderResultDigit();

  let context;
  if (kindCode === 1) {
    const startR = core.finderResultStartR();
    const startC = core.finderResultStartC();
    const startDigits = maskToDigits(core.getInputMask(startR * 9 + startC) & 0x1ff);
    context = actionType === 1
      ? {
          kind: "cell",
          startCell: [startR, startC],
          startDigits,
          concludeCell: [resultR, resultC],
          concludeDigit: resultDigit,
          branches: null,
        }
      : {
          kind: "cell",
          startCell: [startR, startC],
          startDigits,
          eliminationCount: eliminations.length,
          branches: null,
        };
  } else if (kindCode === 2) {
    const unitTypeCode = core.finderResultUnitType();
    const unitType = unitTypeCode === 0 ? "row" : unitTypeCode === 1 ? "col" : "box";
    const unitIdx = core.finderResultUnitIdx();
    const digit = core.finderResultStartDigit();
    context = actionType === 1
      ? {
          kind: "region",
          unitType,
          unitIdx,
          digit,
          startCells: patternCells.map((cell) => [...cell]),
          concludeCell: [resultR, resultC],
          concludeDigit: resultDigit,
          branches: null,
        }
      : {
          kind: "region",
          unitType,
          unitIdx,
          digit,
          startCells: patternCells.map((cell) => [...cell]),
          eliminationCount: eliminations.length,
          branches: null,
        };
  } else {
    throw new Error("Unexpected Dynamic Multiple finder kind: " + kindCode);
  }

  if (actionType === 1) {
    return {
      finding: {
        actionType: "fill",
        technique: "dynamicMultipleChain",
        r: resultR,
        c: resultC,
        digit: resultDigit,
        patternCells,
        context,
      },
      budgetCalls,
      budgetLimit,
    };
  }

  return {
    finding: {
      actionType: "eliminate",
      technique: "dynamicMultipleChain",
      patternCells,
      eliminations,
      context,
    },
    budgetCalls,
    budgetLimit,
  };
}


const STANDALONE_TECHNIQUE_KEYS = new Map([
  [0, "nakedSingle"],
  [1, "hiddenSingle"],
  [2, "lockedCandidate"],
  [4, "nakedPair"],
  [5, "hiddenPair"],
  [6, "nakedTriple"],
  [7, "hiddenTriple"],
  [8, "nakedQuad"],
  [9, "hiddenQuad"],
]);

function readStandalonePatternCells(core) {
  const cells = [];
  for (let i = 0; i < core.standaloneResultPatternCount(); i++) {
    const index = core.standaloneResultPatternAt(i);
    cells.push([Math.floor(index / 9), index % 9]);
  }
  return cells;
}

function readStandaloneEliminations(core) {
  const out = [];
  for (let i = 0; i < core.standaloneResultEliminationCount(); i++) {
    out.push(decodeFact(core.standaloneResultEliminationAt(i)));
  }
  return out;
}

export function runStandaloneTechniqueFinder(core, techniqueId) {
  core.runStandaloneTechniqueFinder(techniqueId);
  const actionType = core.standaloneResultActionType();
  if (actionType === 0) return null;
  const technique = STANDALONE_TECHNIQUE_KEYS.get(techniqueId);
  if (!technique) throw new Error("Unsupported standalone technique id: " + techniqueId);

  const r = core.standaloneResultR();
  const c = core.standaloneResultC();
  const digit = core.standaloneResultDigit();

  if (techniqueId === 0) {
    return { actionType: "fill", technique, r, c, digit };
  }

  if (techniqueId === 1) {
    const unitTypeCode = core.standaloneResultMeta(0);
    return {
      actionType: "fill",
      technique,
      r,
      c,
      digit,
      unitType: unitTypeCode === 0 ? "row" : unitTypeCode === 1 ? "col" : "box",
      idx: core.standaloneResultMeta(1),
    };
  }

  if (techniqueId === 2) {
    const subtypeCode = core.standaloneResultSubtype();
    const subtype = ["pointingRow", "pointingCol", "claimingRow", "claimingCol"][subtypeCode];
    const box = core.standaloneResultMeta(0);
    const line = core.standaloneResultMeta(1);
    const lineType = core.standaloneResultMeta(2) === 0 ? "row" : "col";
    const lockedDigit = core.standaloneResultMeta(3);
    return {
      actionType: "eliminate",
      technique,
      subtype,
      patternCells: readStandalonePatternCells(core),
      eliminations: readStandaloneEliminations(core),
      context: { box, line, lineType, digit: lockedDigit },
    };
  }

  const unitTypeCode = core.standaloneResultMeta(0);
  const unitType = unitTypeCode === 0 ? "row" : unitTypeCode === 1 ? "col" : "box";
  const digitMask = core.standaloneResultMeta(2) & 0x1ff;
  return {
    actionType: "eliminate",
    technique,
    subtype: unitType,
    patternCells: readStandalonePatternCells(core),
    eliminations: readStandaloneEliminations(core),
    context: {
      unitType,
      idx: core.standaloneResultMeta(1),
      digits: maskToDigits(digitMask),
    },
  };
}
