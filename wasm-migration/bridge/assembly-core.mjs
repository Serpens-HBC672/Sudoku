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

export function loadGivenGrid(core, grid) {
  if (!Array.isArray(grid) || grid.length !== 9 || !grid.every((row) => Array.isArray(row) && row.length === 9)) {
    throw new Error("given grid must be a 9x9 array");
  }
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      core.setGivenCell(r * 9 + c, grid[r][c] | 0);
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
  [3, "gsp"],
  [4, "nakedPair"],
  [5, "hiddenPair"],
  [6, "nakedTriple"],
  [7, "hiddenTriple"],
  [8, "nakedQuad"],
  [9, "hiddenQuad"],
  [10, "xWing"],
  [11, "swordfish"],
  [12, "skyscraper"],
  [13, "twoStringKite"],
  [14, "emptyRectangle"],
  [15, "jellyfish"],
  [16, "squirmbagFish"],
  [17, "finnedXWing"],
  [18, "finnedSwordfish"],
  [19, "finnedJellyfish"],
  [20, "uniqueRectangleType1"],
  [21, "uniqueRectangleType2"],
  [22, "hiddenUniqueRectangle"],
  [23, "bugPlusOne"],
  [24, "xyzWing"],
  [25, "wWing"],
  [26, "wxyzWing"],
  [27, "xyChain"],
  [28, "aic"],
  [29, "niceLoop"],
  [30, "sueDeCoq"],
  [31, "fireworkTriple"],
  [32, "fireworkQuadruple"],
  [33, "fireworkWWing"],
  [34, "fireworkAlp"],
  [35, "pom"],
  [36, "alsXZ"],
  [37, "ahsXZ"],
  [38, "alsChain"],
  [39, "deathBlossom"],
  [40, "medusa3D"],
  [41, "tridagon"],
  [45, "tridagonForce"],
  [46, "skLoop"],
  [47, "msls"],
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
  const technique = STANDALONE_TECHNIQUE_KEYS.get(techniqueId);
  if (!technique) throw new Error("Unsupported standalone technique id: " + techniqueId);

  if (techniqueId === 47) {
    core.runMslsFinder();
    if (core.mslsFinderResultEliminationCount() === 0) return null;
    const patternCells = [];
    for (let i = 0; i < core.mslsFinderResultPatternCount(); i++) {
      const index = core.mslsFinderResultPatternAt(i);
      patternCells.push([Math.floor(index / 9), index % 9]);
    }
    const eliminations = [];
    for (let i = 0; i < core.mslsFinderResultEliminationCount(); i++) {
      eliminations.push(decodeFact(core.mslsFinderResultEliminationAt(i)));
    }
    const rows = Array.from({ length: core.mslsFinderResultRowCount() }, (_, i) => core.mslsFinderResultRowAt(i));
    const cols = Array.from({ length: core.mslsFinderResultColCount() }, (_, i) => core.mslsFinderResultColAt(i));
    const boxes = Array.from({ length: core.mslsFinderResultBoxCount() }, (_, i) => core.mslsFinderResultBoxAt(i));
    return {
      actionType: "eliminate",
      technique,
      patternCells,
      eliminations,
      context: { rows, cols, boxes, size: [rows.length, cols.length] },
    };
  }

  if (techniqueId === 46) {
    core.runSkLoopFinder();
    if (core.skLoopResultEliminationCount() === 0) return null;
    const patternCells = [];
    for (let i = 0; i < core.skLoopResultPatternCount(); i++) {
      const index = core.skLoopResultPatternAt(i);
      patternCells.push([Math.floor(index / 9), index % 9]);
    }
    const eliminations = [];
    for (let i = 0; i < core.skLoopResultEliminationCount(); i++) {
      eliminations.push(decodeFact(core.skLoopResultEliminationAt(i)));
    }
    return {
      actionType: "eliminate",
      technique,
      patternCells,
      eliminations,
      context: {
        rows: [core.skLoopResultRowAt(0), core.skLoopResultRowAt(1)],
        cols: [core.skLoopResultColAt(0), core.skLoopResultColAt(1)],
        boxes: Array.from({ length: 4 }, (_, i) => core.skLoopResultBoxAt(i)),
      },
    };
  }

  if (techniqueId === 45) {
    core.runTridagonForceFinder();
    const actionType = core.finderResultActionType();
    if (actionType === 0) return null;
    const patternCells = [];
    for (let i = 0; i < core.finderResultPatternCellCount(); i++) {
      const index = core.finderResultPatternCellAt(i);
      patternCells.push([Math.floor(index / 9), index % 9]);
    }
    const guardians = [];
    for (let i = 0; i < core.tridagonForceResultGuardianCount(); i++) {
      const f = decodeFact(core.tridagonForceResultGuardianFactAt(i));
      guardians.push([f.r, f.c, f.digit]);
    }
    const blocks = Array.from({ length: 4 }, (_, i) => core.tridagonForceResultBlockAt(i));
    const digits = maskToDigits(core.tridagonForceResultTripleMask() & 0x1ff);
    if (actionType === 1) {
      const r = core.finderResultR();
      const c = core.finderResultC();
      const digit = core.finderResultDigit();
      return {
        actionType: "fill",
        technique,
        r,
        c,
        digit,
        patternCells,
        context: {
          digits,
          guardians,
          blocks,
          concludeCell: [r, c],
          concludeDigit: digit,
          branches: null,
        },
      };
    }
    const eliminations = readFinderEliminations(core);
    return {
      actionType: "eliminate",
      technique,
      patternCells,
      eliminations,
      context: {
        digits,
        guardians,
        blocks,
        eliminationCount: eliminations.length,
        branches: null,
      },
    };
  }

  if (techniqueId === 40) {
    core.runMedusaFinder();
    if (core.medusaFinderResultActionType() === 0) return null;
    const patternCells = [];
    for (let i = 0; i < core.medusaFinderResultPatternCount(); i++) {
      const index = core.medusaFinderResultPatternAt(i);
      patternCells.push([Math.floor(index / 9), index % 9]);
    }
    const eliminations = [];
    for (let i = 0; i < core.medusaFinderResultEliminationCount(); i++) {
      eliminations.push(decodeFact(core.medusaFinderResultEliminationAt(i)));
    }
    const coloring = [];
    for (let i = 0; i < core.medusaFinderResultColoringCount(); i++) {
      const fact = decodeFact(core.medusaFinderResultColoringNode(i));
      coloring.push({ r: fact.r, c: fact.c, d: fact.digit, color: core.medusaFinderResultColoringColor(i) });
    }
    const rule = core.medusaFinderResultRuleType();
    const reasonCells = [];
    for (let i = 0; i < core.medusaFinderResultReasonCount(); i++) {
      const fact = decodeFact(core.medusaFinderResultReasonNode(i));
      const color = core.medusaFinderResultReasonColor(i);
      const entry = { r: fact.r, c: fact.c, d: fact.digit };
      if (rule === 2 || (rule === 3 && i > 0)) entry.color = color;
      reasonCells.push(entry);
    }
    const ruleType = ["cell", "unit", "twoColorsInCell", "seesTwoColors"][rule];
    const context = { coloring, ruleType, reasonCells };
    if (rule === 0 || rule === 1) context.badColor = core.medusaFinderResultBadColor();
    return {
      actionType: "eliminate",
      technique,
      patternCells,
      eliminations,
      context,
    };
  }

  if (techniqueId === 41) {
    core.runTridagonFinder();
    if (core.tridagonFinderResultActionType() === 0) return null;
    const patternCells = [];
    for (let i = 0; i < core.tridagonFinderResultPatternCount(); i++) {
      const index = core.tridagonFinderResultPatternAt(i);
      patternCells.push([Math.floor(index / 9), index % 9]);
    }
    const eliminations = [];
    for (let i = 0; i < core.tridagonFinderResultEliminationCount(); i++) {
      eliminations.push(decodeFact(core.tridagonFinderResultEliminationAt(i)));
    }
    const guardianCells = [];
    for (let i = 0; i < core.tridagonFinderResultGuardianCount(); i++) {
      const index = core.tridagonFinderResultGuardianAt(i);
      guardianCells.push([Math.floor(index / 9), index % 9]);
    }
    const blocks = Array.from({ length: 4 }, (_, i) => core.tridagonFinderResultBlockAt(i));
    const tripleDigits = maskToDigits(core.tridagonFinderResultMeta(0) & 0x1ff);
    const guardianDigits = maskToDigits(core.tridagonFinderResultMeta(1) & 0x1ff);
    const variant = core.tridagonFinderResultVariant();

    if (variant === 1) {
      const targetIndex = core.tridagonFinderResultMeta(2);
      return {
        actionType: "eliminate",
        technique,
        patternCells,
        eliminations,
        context: {
          variant: 1,
          digits: tripleDigits,
          targetCell: [Math.floor(targetIndex / 9), targetIndex % 9],
          guardianDigits,
          blocks,
        },
      };
    }
    if (variant === 2) {
      return {
        actionType: "eliminate",
        technique,
        patternCells,
        eliminations,
        context: {
          variant: 2,
          digits: tripleDigits,
          guardianCells,
          guardianDigit: core.tridagonFinderResultMeta(3),
          blocks,
        },
      };
    }

    const subsetCells = [];
    for (let i = 0; i < core.tridagonFinderResultSubsetCount(); i++) {
      const index = core.tridagonFinderResultSubsetAt(i);
      subsetCells.push([Math.floor(index / 9), index % 9]);
    }
    const unitTypeCode = core.tridagonFinderResultMeta(4);
    return {
      actionType: "eliminate",
      technique,
      patternCells,
      eliminations,
      context: {
        variant: 3,
        digits: tripleDigits,
        guardianCells,
        guardianDigits,
        houseType: unitTypeCode === 0 ? "row" : unitTypeCode === 1 ? "col" : "box",
        houseIndex: core.tridagonFinderResultMeta(5),
        subsetCells,
        subsetDigits: maskToDigits(core.tridagonFinderResultMeta(6) & 0x1ff),
        blocks,
      },
    };
  }

  if (techniqueId === 38 || techniqueId === 39) {
    core.runAlsAdvancedFinder(techniqueId);
    if (core.alsAdvancedResultKind() === 0) return null;
    const patternCells = [];
    for (let i = 0; i < core.alsAdvancedResultPatternCount(); i++) {
      const index = core.alsAdvancedResultPatternAt(i);
      patternCells.push([Math.floor(index / 9), index % 9]);
    }
    const eliminations = [];
    for (let i = 0; i < core.alsAdvancedResultEliminationCount(); i++) {
      eliminations.push(decodeFact(core.alsAdvancedResultEliminationAt(i)));
    }
    const auxDigits = [];
    for (let i = 0; i < core.alsAdvancedResultExtraDigitCount(); i++) {
      auxDigits.push(core.alsAdvancedResultExtraDigitAt(i));
    }

    if (techniqueId === 38) {
      const s0 = core.alsAdvancedResultMeta(0);
      const s1 = core.alsAdvancedResultMeta(1);
      const s2 = core.alsAdvancedResultMeta(2);
      return {
        actionType: "eliminate",
        technique,
        patternCells,
        eliminations,
        context: {
          chainLength: 3,
          elimDigit: core.alsAdvancedResultMeta(3),
          alsChain: [
            patternCells.slice(0, s0).map((cell) => [...cell]),
            patternCells.slice(s0, s0 + s1).map((cell) => [...cell]),
            patternCells.slice(s0 + s1, s0 + s1 + s2).map((cell) => [...cell]),
          ],
          linkRccDigits: auxDigits,
        },
      };
    }

    const stemCell = [...patternCells[0]];
    const petalCount = core.alsAdvancedResultMeta(2);
    const petals = [];
    let offset = 1;
    for (let p = 0; p < petalCount; p++) {
      const size = core.alsAdvancedResultMeta(4 + p);
      petals.push({
        digit: auxDigits[p],
        cells: patternCells.slice(offset, offset + size).map((cell) => [...cell]),
      });
      offset += size;
    }
    return {
      actionType: "eliminate",
      technique,
      patternCells,
      eliminations,
      context: {
        stemCell,
        stemDigits: maskToDigits(core.alsAdvancedResultMeta(1) & 0x1ff),
        petals,
        elimDigit: core.alsAdvancedResultMeta(3),
      },
    };
  }

  if (techniqueId >= 31 && techniqueId <= 34) {
    core.runFireworkFinder(techniqueId);
    if (core.fireworkFinderResultActionType() === 0) return null;
    const patternCells = [];
    for (let i = 0; i < core.fireworkFinderResultPatternCount(); i++) {
      const index = core.fireworkFinderResultPatternAt(i);
      patternCells.push([Math.floor(index / 9), index % 9]);
    }
    const eliminations = [];
    for (let i = 0; i < core.fireworkFinderResultEliminationCount(); i++) {
      eliminations.push(decodeFact(core.fireworkFinderResultEliminationAt(i)));
    }
    const digits = maskToDigits(core.fireworkFinderResultMeta(0) & 0x1ff);
    if (techniqueId === 31) {
      return {
        actionType: "eliminate",
        technique,
        patternCells,
        eliminations,
        context: {
          stem: [...patternCells[0]],
          leaf: patternCells.slice(1, 3).map((cell) => [...cell]),
          digits,
        },
      };
    }
    if (techniqueId === 32) {
      return {
        actionType: "eliminate",
        technique,
        patternCells,
        eliminations,
        context: {
          stem: patternCells.slice(0, 2).map((cell) => [...cell]),
          leaf: patternCells.slice(2, 4).map((cell) => [...cell]),
          digits,
        },
      };
    }
    if (techniqueId === 33) {
      return {
        actionType: "eliminate",
        technique,
        patternCells,
        eliminations,
        context: {
          stem: [...patternCells[0]],
          leaf: patternCells.slice(1, 3).map((cell) => [...cell]),
          assist: patternCells.slice(3, 5).map((cell) => [...cell]),
          target: [...patternCells[5]],
          digits,
        },
      };
    }
    return {
      actionType: "eliminate",
      technique,
      patternCells,
      eliminations,
      context: {
        stem: [...patternCells[0]],
        rowPartner: [...patternCells[1]],
        colPartner: [...patternCells[2]],
        assist: [...patternCells[3]],
        digits,
      },
    };
  }

  if (techniqueId === 30) {
    core.runSueDeCoqFinder();
    if (core.sdcFinderResultActionType() === 0) return null;
    const patternCells = [];
    for (let i = 0; i < core.sdcFinderResultPatternCount(); i++) {
      const index = core.sdcFinderResultPatternAt(i);
      patternCells.push([Math.floor(index / 9), index % 9]);
    }
    const eliminations = [];
    for (let i = 0; i < core.sdcFinderResultEliminationCount(); i++) {
      eliminations.push(decodeFact(core.sdcFinderResultEliminationAt(i)));
    }
    const irCount = core.sdcFinderResultMeta(3);
    const aSize = core.sdcFinderResultMeta(4);
    const bSize = core.sdcFinderResultMeta(5);
    return {
      actionType: "eliminate",
      technique,
      patternCells,
      eliminations,
      context: {
        box: core.sdcFinderResultMeta(0),
        lineType: core.sdcFinderResultMeta(1) === 0 ? "row" : "col",
        lineIdx: core.sdcFinderResultMeta(2),
        irCells: patternCells.slice(0, irCount).map((cell) => [...cell]),
        aCells: patternCells.slice(irCount, irCount + aSize).map((cell) => [...cell]),
        bCells: patternCells.slice(irCount + aSize, irCount + aSize + bSize).map((cell) => [...cell]),
        digits: maskToDigits(core.sdcFinderResultMeta(6) & 0x1ff),
      },
    };
  }

  if (techniqueId === 28) {
    core.runAicFinder();
    const nodeCount = core.aicFinderResultNodeCount();
    if (nodeCount === 0) return null;
    const chainNodes = [];
    const patternCells = [];
    for (let i = 0; i < nodeCount; i++) {
      const cells = [];
      for (let j = 0; j < core.aicFinderResultNodeCellCount(i); j++) {
        const index = core.aicFinderResultNodeCellAt(i, j);
        const cell = [Math.floor(index / 9), index % 9];
        cells.push(cell);
        patternCells.push([...cell]);
      }
      chainNodes.push({ cells, d: core.aicFinderResultNodeDigit(i) });
    }
    const eliminations = [];
    for (let i = 0; i < core.aicFinderResultEliminationCount(); i++) {
      eliminations.push(decodeFact(core.aicFinderResultEliminationAt(i)));
    }
    return {
      actionType: "eliminate",
      technique,
      subtype: core.aicFinderResultSubtype() === 0 ? "type1" : "type2",
      patternCells,
      chainNodes,
      eliminations,
      context: {
        chainLength: chainNodes.length,
        startDigit: chainNodes[0].d,
        endDigit: chainNodes[chainNodes.length - 1].d,
        grouped: chainNodes.some((node) => node.cells.length > 1),
      },
    };
  }

  if (techniqueId === 29) {
    core.runNiceLoopFinder();
    const nodeCount = core.aicFinderResultNodeCount();
    if (nodeCount === 0) return null;
    const chainNodes = [];
    for (let i = 0; i < nodeCount; i++) {
      const cells = [];
      for (let j = 0; j < core.aicFinderResultNodeCellCount(i); j++) {
        const index = core.aicFinderResultNodeCellAt(i, j);
        cells.push([Math.floor(index / 9), index % 9]);
      }
      chainNodes.push({ cells, d: core.aicFinderResultNodeDigit(i) });
    }
    const start = chainNodes[0];
    const [r, c] = start.cells[0];
    return {
      actionType: "fill",
      technique,
      r,
      c,
      digit: start.d,
      chainNodes,
      context: { chainLength: chainNodes.length },
    };
  }

  core.runStandaloneTechniqueFinder(techniqueId);
  const actionType = core.standaloneResultActionType();
  if (actionType === 0) return null;

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

  if (techniqueId === 3) {
    const symmetry = ["central", "diagonal", "antidiagonal"][core.standaloneResultMeta(0)];
    if (actionType === 1) {
      const pairedIndex = core.standaloneResultMeta(1);
      return {
        actionType: "fill",
        technique,
        r,
        c,
        digit,
        context: {
          symmetry,
          pairedWith: [Math.floor(pairedIndex / 9), pairedIndex % 9],
          pairedDigit: core.standaloneResultMeta(2),
        },
      };
    }
    const kind = core.standaloneResultMeta(3) === 1 ? "axis" : "mirror";
    return {
      actionType: "eliminate",
      technique,
      patternCells: [],
      eliminations: readStandaloneEliminations(core),
      context: { symmetry, kind },
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

  if (techniqueId === 12) {
    const patternCells = readStandalonePatternCells(core);
    const baseType = core.standaloneResultMeta(1) === 0 ? "row" : "col";
    return {
      actionType: "eliminate",
      technique,
      patternCells,
      eliminations: readStandaloneEliminations(core),
      context: {
        digit: core.standaloneResultMeta(0),
        baseType,
        base: patternCells.slice(0, 2).map((cell) => [...cell]),
        roof: patternCells.slice(2, 4).map((cell) => [...cell]),
      },
    };
  }

  if (techniqueId === 13) {
    const patternCells = readStandalonePatternCells(core);
    return {
      actionType: "eliminate",
      technique,
      patternCells,
      eliminations: readStandaloneEliminations(core),
      context: {
        digit: core.standaloneResultMeta(0),
        near: patternCells.slice(0, 2).map((cell) => [...cell]),
        far: patternCells.slice(2, 4).map((cell) => [...cell]),
      },
    };
  }

  if (techniqueId === 14) {
    const patternCells = readStandalonePatternCells(core);
    const eliminations = readStandaloneEliminations(core);
    const near = patternCells[patternCells.length - 2];
    const far = patternCells[patternCells.length - 1];
    const target = [eliminations[0].r, eliminations[0].c];
    return {
      actionType: "eliminate",
      technique,
      patternCells,
      eliminations,
      context: {
        digit: core.standaloneResultMeta(0),
        box: core.standaloneResultMeta(1),
        axis: [core.standaloneResultMeta(2), core.standaloneResultMeta(3)],
        near: [...near],
        far: [...far],
        target,
      },
    };
  }

  if (techniqueId === 20) {
    const patternCells = readStandalonePatternCells(core);
    const digits = maskToDigits(core.standaloneResultMeta(0) & 0x1ff);
    const extraCell = patternCells[core.standaloneResultMeta(1)];
    return {
      actionType: "eliminate",
      technique,
      patternCells,
      eliminations: readStandaloneEliminations(core),
      context: { digits, extraCell: [...extraCell] },
    };
  }

  if (techniqueId === 21) {
    const patternCells = readStandalonePatternCells(core);
    const roofCells = [];
    for (let i = 0; i < core.standaloneResultExtraCellCount(); i++) {
      const index = core.standaloneResultExtraCellAt(i);
      roofCells.push([Math.floor(index / 9), index % 9]);
    }
    return {
      actionType: "eliminate",
      technique,
      patternCells,
      eliminations: readStandaloneEliminations(core),
      context: {
        digits: maskToDigits(core.standaloneResultMeta(0) & 0x1ff),
        extraDigit: core.standaloneResultMeta(1),
        roofCells,
      },
    };
  }

  if (techniqueId === 22) {
    const patternCells = readStandalonePatternCells(core);
    return {
      actionType: "eliminate",
      technique,
      patternCells,
      eliminations: readStandaloneEliminations(core),
      context: {
        digits: maskToDigits(core.standaloneResultMeta(0) & 0x1ff),
        floorCell: [...patternCells[core.standaloneResultMeta(1)]],
        targetCell: [...patternCells[core.standaloneResultMeta(2)]],
        strongDigit: core.standaloneResultMeta(3),
      },
    };
  }

  if (techniqueId === 23) {
    const unitTypeCode = core.standaloneResultMeta(1);
    return {
      actionType: "fill",
      technique,
      r,
      c,
      digit,
      context: {
        tripleDigits: maskToDigits(core.standaloneResultMeta(0) & 0x1ff),
        oddUnit: {
          unitType: unitTypeCode === 0 ? "row" : unitTypeCode === 1 ? "col" : "box",
          idx: core.standaloneResultMeta(2),
        },
      },
    };
  }

  if (techniqueId === 24 || techniqueId === 26) {
    const patternCells = readStandalonePatternCells(core);
    return {
      actionType: "eliminate",
      technique,
      patternCells,
      eliminations: readStandaloneEliminations(core),
      context: {
        hinge: [...patternCells[0]],
        outliers: patternCells.slice(1).map((cell) => [...cell]),
        digit: core.standaloneResultMeta(0),
        hingeDigits: maskToDigits(core.standaloneResultMeta(1) & 0x1ff),
      },
    };
  }

  if (techniqueId === 25) {
    const patternCells = readStandalonePatternCells(core);
    const unitTypeCode = core.standaloneResultMeta(2);
    return {
      actionType: "eliminate",
      technique,
      patternCells,
      eliminations: readStandaloneEliminations(core),
      context: {
        biValueCells: patternCells.slice(0, 2).map((cell) => [...cell]),
        strongLinkCells: patternCells.slice(2, 4).map((cell) => [...cell]),
        strongDigit: core.standaloneResultMeta(0),
        elimDigit: core.standaloneResultMeta(1),
        unitType: unitTypeCode === 0 ? "row" : unitTypeCode === 1 ? "col" : "box",
        idx: core.standaloneResultMeta(3),
      },
    };
  }

  if (techniqueId === 29) {
    core.runNiceLoopFinder();
    const nodeCount = core.aicFinderResultNodeCount();
    if (nodeCount === 0) return null;
    const chainNodes = [];
    for (let i = 0; i < nodeCount; i++) {
      const cells = [];
      for (let j = 0; j < core.aicFinderResultNodeCellCount(i); j++) {
        const index = core.aicFinderResultNodeCellAt(i, j);
        cells.push([Math.floor(index / 9), index % 9]);
      }
      chainNodes.push({ cells, d: core.aicFinderResultNodeDigit(i) });
    }
    const start = chainNodes[0];
    const [r, c] = start.cells[0];
    return {
      actionType: "fill",
      technique,
      r,
      c,
      digit: start.d,
      chainNodes,
      context: { chainLength: chainNodes.length },
    };
  }

  if (techniqueId === 28) {
    core.runAicFinder();
    if (core.aicFinderResultNodeCount() === 0) return null;
    const chainNodes = [];
    const patternCells = [];
    for (let i = 0; i < core.aicFinderResultNodeCount(); i++) {
      const cells = [];
      for (let j = 0; j < core.aicFinderResultNodeCellCount(i); j++) {
        const index = core.aicFinderResultNodeCellAt(i, j);
        const cell = [Math.floor(index / 9), index % 9];
        cells.push(cell);
        patternCells.push([...cell]);
      }
      chainNodes.push({ cells, d: core.aicFinderResultNodeDigit(i) });
    }
    const eliminations = [];
    for (let i = 0; i < core.aicFinderResultEliminationCount(); i++) {
      eliminations.push(decodeFact(core.aicFinderResultEliminationAt(i)));
    }
    return {
      actionType: "eliminate",
      technique,
      subtype: core.aicFinderResultSubtype() === 0 ? "type1" : "type2",
      patternCells,
      chainNodes,
      eliminations,
      context: {
        chainLength: chainNodes.length,
        startDigit: chainNodes[0].d,
        endDigit: chainNodes[chainNodes.length - 1].d,
        grouped: chainNodes.some((node) => node.cells.length > 1),
      },
    };
  }

  if (techniqueId === 37) {
    const patternCells = readStandalonePatternCells(core);
    const aCellCount = core.standaloneResultMeta(0);
    const bCellCount = core.standaloneResultMeta(1);
    const aDigitCount = core.standaloneResultMeta(2);
    const bDigitCount = core.standaloneResultMeta(3);
    const overlapCount = core.standaloneResultMeta(4);
    const xCount = core.standaloneResultMeta(5);
    const zCount = core.standaloneResultMeta(6);
    const auxCells = [];
    for (let i = 0; i < core.standaloneResultExtraCellCount(); i++) {
      const index = core.standaloneResultExtraCellAt(i);
      auxCells.push([Math.floor(index / 9), index % 9]);
    }
    const auxDigits = [];
    for (let i = 0; i < core.standaloneResultExtraDigitCount(); i++) {
      auxDigits.push(core.standaloneResultExtraDigitAt(i));
    }
    return {
      actionType: "eliminate",
      technique,
      patternCells,
      eliminations: readStandaloneEliminations(core),
      context: {
        ahsACells: patternCells.slice(0, aCellCount).map((cell) => [...cell]),
        ahsADigits: auxDigits.slice(0, aDigitCount),
        ahsBCells: patternCells.slice(aCellCount, aCellCount + bCellCount).map((cell) => [...cell]),
        ahsBDigits: auxDigits.slice(aDigitCount, aDigitCount + bDigitCount),
        rccCells: auxCells.slice(0, overlapCount).map((cell) => [...cell]),
        xCells: auxCells.slice(overlapCount, overlapCount + xCount).map((cell) => [...cell]),
        zCells: auxCells.slice(overlapCount + xCount, overlapCount + xCount + zCount).map((cell) => [...cell]),
      },
    };
  }

  if (techniqueId === 36) {
    const patternCells = readStandalonePatternCells(core);
    const aSize = core.standaloneResultMeta(0);
    const bSize = core.standaloneResultMeta(1);
    const rccDigits = [];
    for (let i = 0; i < core.standaloneResultExtraDigitCount(); i++) {
      rccDigits.push(core.standaloneResultExtraDigitAt(i));
    }
    return {
      actionType: "eliminate",
      technique,
      patternCells,
      eliminations: readStandaloneEliminations(core),
      context: {
        rccDigits,
        elimDigit: core.standaloneResultMeta(2),
        alsACells: patternCells.slice(0, aSize).map((cell) => [...cell]),
        alsBCells: patternCells.slice(aSize, aSize + bSize).map((cell) => [...cell]),
      },
    };
  }

  if (techniqueId === 35) {
    const patternCells = readStandalonePatternCells(core);
    const patternCount = core.standaloneResultMeta(1);
    const pomDigit = core.standaloneResultMeta(0);
    if (actionType === 1) {
      const allFixedCells = [];
      for (let i = 0; i < core.standaloneResultExtraCellCount(); i++) {
        const index = core.standaloneResultExtraCellAt(i);
        allFixedCells.push([Math.floor(index / 9), index % 9]);
      }
      return {
        actionType: "fill",
        technique,
        r,
        c,
        digit,
        patternCells,
        context: { digit: pomDigit, patternCount, allFixedCells, mode: "allPattern" },
      };
    }
    return {
      actionType: "eliminate",
      technique,
      patternCells,
      eliminations: readStandaloneEliminations(core),
      context: { digit: pomDigit, patternCount, mode: "noPattern" },
    };
  }

  if (techniqueId === 27) {
    const patternCells = readStandalonePatternCells(core);
    const chainLinkDigits = [];
    for (let i = 0; i < core.standaloneResultExtraDigitCount(); i++) {
      chainLinkDigits.push(core.standaloneResultExtraDigitAt(i));
    }
    return {
      actionType: "eliminate",
      technique,
      patternCells,
      eliminations: readStandaloneEliminations(core),
      chainCells: patternCells.map(([r, c]) => ({ r, c })),
      chainLinkDigits,
      context: {
        digit: core.standaloneResultMeta(0),
        chainLength: patternCells.length,
      },
    };
  }

  const finnedFishIds = new Set([17, 18, 19]);
  if (finnedFishIds.has(techniqueId)) {
    const patternCells = readStandalonePatternCells(core);
    const finCells = [];
    for (let i = 0; i < core.standaloneResultExtraCellCount(); i++) {
      const index = core.standaloneResultExtraCellAt(i);
      finCells.push([Math.floor(index / 9), index % 9]);
    }
    const baseType = core.standaloneResultMeta(1) === 0 ? "row" : "col";
    const coverType = baseType === "row" ? "col" : "row";
    const maskIndexes = (mask) => {
      const out = [];
      for (let i = 0; i < 9; i++) if (mask & (1 << i)) out.push(i);
      return out;
    };
    return {
      actionType: "eliminate",
      technique,
      subtype: baseType,
      patternCells,
      finCells,
      eliminations: readStandaloneEliminations(core),
      context: {
        digit: core.standaloneResultMeta(0),
        baseType,
        coverType,
        baseIdxs: maskIndexes(core.standaloneResultMeta(2) & 0x1ff),
        coverIdxs: maskIndexes(core.standaloneResultMeta(3) & 0x1ff),
      },
    };
  }

  const fishIds = new Set([10, 11, 15, 16]);
  if (fishIds.has(techniqueId)) {
    const baseType = core.standaloneResultMeta(1) === 0 ? "row" : "col";
    const coverType = baseType === "row" ? "col" : "row";
    const baseMask = core.standaloneResultMeta(2) & 0x1ff;
    const coverMask = core.standaloneResultMeta(3) & 0x1ff;
    const maskIndexes = (mask) => {
      const out = [];
      for (let i = 0; i < 9; i++) if (mask & (1 << i)) out.push(i);
      return out;
    };
    return {
      actionType: "eliminate",
      technique,
      subtype: baseType,
      patternCells: readStandalonePatternCells(core),
      eliminations: readStandaloneEliminations(core),
      context: {
        digit: core.standaloneResultMeta(0),
        baseType,
        coverType,
        baseIdxs: maskIndexes(baseMask),
        coverIdxs: maskIndexes(coverMask),
      },
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


export function runStaticNishioFinder(core) {
  core.runStaticNishioFinder();
  if (core.finderResultActionType() === 0) return null;
  const r = core.finderResultStartR();
  const c = core.finderResultStartC();
  const d = core.finderResultStartDigit();
  return {
    actionType: "eliminate",
    technique: "nishioChain",
    patternCells: [[r, c]],
    eliminations: readFinderEliminations(core),
    context: { r, c, d, branches: null },
  };
}

export function runStaticUnaryFinder(core) {
  core.runStaticUnaryFinder();
  const actionType = core.finderResultActionType();
  if (actionType === 0) return null;
  const startR = core.finderResultStartR();
  const startC = core.finderResultStartC();
  const startDigit = core.finderResultStartDigit();
  if (actionType === 1) {
    const r = core.finderResultR();
    const c = core.finderResultC();
    const digit = core.finderResultDigit();
    return {
      actionType: "fill",
      technique: "unaryChain",
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
    };
  }
  const eliminations = readFinderEliminations(core);
  return {
    actionType: "eliminate",
    technique: "unaryChain",
    patternCells: [[startR, startC]],
    eliminations,
    context: {
      startCell: [startR, startC],
      startDigit,
      concludeValue: false,
      eliminationCount: eliminations.length,
      branches: null,
    },
  };
}

export function runStaticMultipleFinder(core) {
  core.runStaticMultipleFinder();
  const actionType = core.finderResultActionType();
  if (actionType === 0) return null;

  const kindCode = core.finderResultKind();
  const patternCells = readFinderPatternCells(core);
  const eliminations = actionType === 2 ? readFinderEliminations(core) : null;
  const r = core.finderResultR();
  const c = core.finderResultC();
  const digit = core.finderResultDigit();
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
          concludeCell: [r, c],
          concludeDigit: digit,
          branches: null,
        }
      : {
          kind: "cell",
          startCell: [startR, startC],
          startDigits,
          eliminationCount: eliminations.length,
          branches: null,
        };
  } else {
    const unitTypeCode = core.finderResultUnitType();
    const unitType = unitTypeCode === 0 ? "row" : unitTypeCode === 1 ? "col" : "box";
    const unitIdx = core.finderResultUnitIdx();
    const startDigit = core.finderResultStartDigit();
    context = actionType === 1
      ? {
          kind: "region",
          unitType,
          unitIdx,
          digit: startDigit,
          startCells: patternCells.map((cell) => [...cell]),
          concludeCell: [r, c],
          concludeDigit: digit,
          branches: null,
        }
      : {
          kind: "region",
          unitType,
          unitIdx,
          digit: startDigit,
          startCells: patternCells.map((cell) => [...cell]),
          eliminationCount: eliminations.length,
          branches: null,
        };
  }

  return actionType === 1
    ? { actionType: "fill", technique: "multipleChain", r, c, digit, patternCells, context }
    : { actionType: "eliminate", technique: "multipleChain", patternCells, eliminations, context };
}
