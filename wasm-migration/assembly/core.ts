import {
  basicResetInput,
  basicSetInputCell,
  basicSetInputMask,
  basicSetGivenCell,
  runBasicTechniqueFinder as basicRunTechniqueFinder,
  basicResultActionType as basicActionType,
  basicResultTechniqueId as basicTechniqueId,
  basicResultSubtype as basicSubtype,
  basicResultR as basicR,
  basicResultC as basicC,
  basicResultDigit as basicDigit,
  basicResultPatternCount as basicPatternCount,
  basicResultPatternAt as basicPatternAt,
  basicResultEliminationCount as basicEliminationCount,
  basicResultEliminationAt as basicEliminationAt,
  basicResultMeta as basicMeta,
  basicResultExtraCellCount as basicExtraCellCount,
  basicResultExtraCellAt as basicExtraCellAt,
  basicResultExtraDigitCount as basicExtraDigitCount,
  basicResultExtraDigitAt as basicExtraDigitAt,
} from "./basic-finders";

// AssemblyScript hotspot prototype for the human-technique solver.
//
// Scope is intentionally narrow: this module ports the exact static
// propagateAssumptionCore behavior used by Unary/Nishio/Multiple forcing
// chains (Naked Single -> Hidden Single -> Locked Candidates). It does not
// touch puzzle generation/MRV and it does not change the public Finding
// contract. The first milestone is exact differential behavior, not a
// redesigned solver.
//
// Candidate digits always use the low 9 bits of u16: digit d -> bit d-1.

const CELL_COUNT: i32 = 81;
const FACT_COUNT: i32 = 729;
const UNIT_DIGIT_COUNT: i32 = 270; // 3 * 9 * 10 (digit 0 unused)
const PLACED_COUNT: i32 = 27;      // 3 * 9
const TRIPLE_COUNT: i32 = 243;     // 9 digits * 3 unit types * 9 units
const ALL_DIGITS: u16 = 0x01ff;

const inputGrid = new StaticArray<u8>(CELL_COUNT);
const inputBaseMask = new StaticArray<u16>(CELL_COUNT);

const grid = new StaticArray<u8>(CELL_COUNT);
const cellMask = new StaticArray<u16>(CELL_COUNT);
const unitDigitMask = new StaticArray<u16>(UNIT_DIGIT_COUNT);
const placedMask = new StaticArray<u16>(PLACED_COUNT);

const trueSeen = new StaticArray<u8>(FACT_COUNT);
const falseSeen = new StaticArray<u8>(FACT_COUNT);
const trueOrder = new StaticArray<u16>(FACT_COUNT);
const falseOrder = new StaticArray<u16>(FACT_COUNT);
let trueCountValue: i32 = 0;
let falseCountValue: i32 = 0;

const touchedCells = new StaticArray<u8>(CELL_COUNT);
const touchedTriples = new StaticArray<u8>(TRIPLE_COUNT);

// Dynamic propagation nests exactly one STATIC propagation level. Preserve the
// outer frame by explicit snapshot/restore rather than introducing an undo-log
// algorithm that the JS oracle does not use.
const backupInputGrid = new StaticArray<u8>(CELL_COUNT);
const backupInputBaseMask = new StaticArray<u16>(CELL_COUNT);
const backupGrid = new StaticArray<u8>(CELL_COUNT);
const backupCellMask = new StaticArray<u16>(CELL_COUNT);
const backupUnitDigitMask = new StaticArray<u16>(UNIT_DIGIT_COUNT);
const backupPlacedMask = new StaticArray<u16>(PLACED_COUNT);
const backupTrueSeen = new StaticArray<u8>(FACT_COUNT);
const backupFalseSeen = new StaticArray<u8>(FACT_COUNT);
const backupTrueOrder = new StaticArray<u16>(FACT_COUNT);
const backupFalseOrder = new StaticArray<u16>(FACT_COUNT);
const backupTouchedCells = new StaticArray<u8>(CELL_COUNT);
const backupTouchedTriples = new StaticArray<u8>(TRIPLE_COUNT);

// Unary forcing chains must compare the completed on/off branches while
// preserving insertion order from the "on" branch.
const branchTrueSeen = new StaticArray<u8>(FACT_COUNT);
const branchFalseSeen = new StaticArray<u8>(FACT_COUNT);
const branchTrueOrder = new StaticArray<u16>(FACT_COUNT);
const branchFalseOrder = new StaticArray<u16>(FACT_COUNT);
let branchTrueCount: i32 = 0;
let branchFalseCount: i32 = 0;

const multiTrueSeen = new StaticArray<u8>(FACT_COUNT);
const multiFalseSeen = new StaticArray<u8>(FACT_COUNT);
const multiTrueOrder = new StaticArray<u16>(FACT_COUNT);
const multiFalseOrder = new StaticArray<u16>(FACT_COUNT);
let multiTrueCount: i32 = 0;
let multiFalseCount: i32 = 0;

// Raw finder result ABI for the migration adapter.
let finderActionType: i32 = 0; // 0 none, 1 fill, 2 eliminate
let finderR: i32 = -1;
let finderC: i32 = -1;
let finderDigit: i32 = 0;
let finderStartR: i32 = -1;
let finderStartC: i32 = -1;
let finderStartDigit: i32 = 0;
let finderKind: i32 = 0; // 0 none/simple, 1 cell-multiple, 2 region-multiple
let finderUnitType: i32 = -1;
let finderUnitIdx: i32 = -1;
const finderPatternCells = new StaticArray<u8>(CELL_COUNT);
let finderPatternCellCount: i32 = 0;
const finderEliminations = new StaticArray<u16>(FACT_COUNT);
let finderEliminationCount: i32 = 0;

let budgetCallsValue: i32 = 0;
let budgetLimitValue: i32 = 0;
let abortedValue: i32 = 0;

let initialized: bool = false;
let contradictionValue: i32 = 0;
let guardIterationsValue: i32 = 0;

@inline
function boxIndexRC(r: i32, c: i32): i32 {
  return (r / 3) * 3 + c / 3;
}

@inline
function factIndex(r: i32, c: i32, d: i32): i32 {
  return r * 81 + c * 9 + (d - 1);
}

@inline
function unitMaskIndex(unitType: i32, idx: i32, d: i32): i32 {
  return unitType * 90 + idx * 10 + d;
}

@inline
function placedIndex(unitType: i32, idx: i32): i32 {
  return unitType * 9 + idx;
}

@inline
function tripleKey(unitType: i32, idx: i32, d: i32): i32 {
  return (d - 1) * 27 + unitType * 9 + idx;
}

@inline
function positionBit(pos: i32): u16 {
  switch (pos) {
    case 0: return 0x001;
    case 1: return 0x002;
    case 2: return 0x004;
    case 3: return 0x008;
    case 4: return 0x010;
    case 5: return 0x020;
    case 6: return 0x040;
    case 7: return 0x080;
    case 8: return 0x100;
    default: return 0;
  }
}

@inline
function bitForDigit(d: i32): u16 {
  return positionBit(d - 1);
}

@inline
function countBits9(maskValue: u16): i32 {
  let mask = maskValue & ALL_DIGITS;
  let count: i32 = 0;
  while (mask != 0) {
    mask = <u16>(mask & <u16>(mask - 1));
    count++;
  }
  return count;
}

@inline
function singletonDigit(mask: u16): i32 {
  for (let d: i32 = 1; d <= 9; d++) {
    if ((mask & bitForDigit(d)) != 0) return d;
  }
  return 0;
}

@inline
function unitCellIndex(unitType: i32, idx: i32, pos: i32): i32 {
  if (unitType == 0) return idx * 9 + pos;       // row
  if (unitType == 1) return pos * 9 + idx;       // col
  const br = (idx / 3) * 3;
  const bc = (idx % 3) * 3;
  return (br + pos / 3) * 9 + (bc + pos % 3);   // box
}

function clearU8(array: StaticArray<u8>, length: i32): void {
  for (let i: i32 = 0; i < length; i++) unchecked(array[i] = 0);
}

function clearU16(array: StaticArray<u16>, length: i32): void {
  for (let i: i32 = 0; i < length; i++) unchecked(array[i] = 0);
}

function copyU8(src: StaticArray<u8>, dst: StaticArray<u8>, length: i32): void {
  for (let i: i32 = 0; i < length; i++) unchecked(dst[i] = unchecked(src[i]));
}

function copyU16(src: StaticArray<u16>, dst: StaticArray<u16>, length: i32): void {
  for (let i: i32 = 0; i < length; i++) unchecked(dst[i] = unchecked(src[i]));
}

let backupTrueCountValue: i32 = 0;
let backupFalseCountValue: i32 = 0;
let backupInitializedValue: bool = false;
let backupContradictionValue: i32 = 0;
let backupGuardIterationsValue: i32 = 0;
let backupAbortedValue: i32 = 0;

function saveOuterFrame(): void {
  copyU8(inputGrid, backupInputGrid, CELL_COUNT);
  copyU16(inputBaseMask, backupInputBaseMask, CELL_COUNT);
  copyU8(grid, backupGrid, CELL_COUNT);
  copyU16(cellMask, backupCellMask, CELL_COUNT);
  copyU16(unitDigitMask, backupUnitDigitMask, UNIT_DIGIT_COUNT);
  copyU16(placedMask, backupPlacedMask, PLACED_COUNT);
  copyU8(trueSeen, backupTrueSeen, FACT_COUNT);
  copyU8(falseSeen, backupFalseSeen, FACT_COUNT);
  copyU16(trueOrder, backupTrueOrder, FACT_COUNT);
  copyU16(falseOrder, backupFalseOrder, FACT_COUNT);
  copyU8(touchedCells, backupTouchedCells, CELL_COUNT);
  copyU8(touchedTriples, backupTouchedTriples, TRIPLE_COUNT);
  backupTrueCountValue = trueCountValue;
  backupFalseCountValue = falseCountValue;
  backupInitializedValue = initialized;
  backupContradictionValue = contradictionValue;
  backupGuardIterationsValue = guardIterationsValue;
  backupAbortedValue = abortedValue;
}

function restoreOuterFrame(): void {
  copyU8(backupInputGrid, inputGrid, CELL_COUNT);
  copyU16(backupInputBaseMask, inputBaseMask, CELL_COUNT);
  copyU8(backupGrid, grid, CELL_COUNT);
  copyU16(backupCellMask, cellMask, CELL_COUNT);
  copyU16(backupUnitDigitMask, unitDigitMask, UNIT_DIGIT_COUNT);
  copyU16(backupPlacedMask, placedMask, PLACED_COUNT);
  copyU8(backupTrueSeen, trueSeen, FACT_COUNT);
  copyU8(backupFalseSeen, falseSeen, FACT_COUNT);
  copyU16(backupTrueOrder, trueOrder, FACT_COUNT);
  copyU16(backupFalseOrder, falseOrder, FACT_COUNT);
  copyU8(backupTouchedCells, touchedCells, CELL_COUNT);
  copyU8(backupTouchedTriples, touchedTriples, TRIPLE_COUNT);
  trueCountValue = backupTrueCountValue;
  falseCountValue = backupFalseCountValue;
  initialized = backupInitializedValue;
  contradictionValue = backupContradictionValue;
  guardIterationsValue = backupGuardIterationsValue;
  abortedValue = backupAbortedValue;
}

export function resetInput(): void {
  clearU8(inputGrid, CELL_COUNT);
  clearU16(inputBaseMask, CELL_COUNT);
  basicResetInput();
}

export function setInputCell(index: i32, digit: i32): void {
  if (index < 0 || index >= CELL_COUNT) return;
  unchecked(inputGrid[index] = <u8>digit);
  basicSetInputCell(index, digit);
}

export function setInputMask(index: i32, mask: i32): void {
  if (index < 0 || index >= CELL_COUNT) return;
  unchecked(inputBaseMask[index] = <u16>(mask & 0x01ff));
  basicSetInputMask(index, mask);
}

export function getInputCell(index: i32): i32 {
  if (index < 0 || index >= CELL_COUNT) return 0;
  return <i32>unchecked(inputGrid[index]);
}

export function getInputMask(index: i32): i32 {
  if (index < 0 || index >= CELL_COUNT) return 0;
  return <i32>unchecked(inputBaseMask[index]);
}

function resetWork(): void {
  for (let i: i32 = 0; i < CELL_COUNT; i++) {
    unchecked(grid[i] = unchecked(inputGrid[i]));
    unchecked(cellMask[i] = 0);
  }
  clearU16(unitDigitMask, UNIT_DIGIT_COUNT);
  clearU16(placedMask, PLACED_COUNT);
  clearU8(trueSeen, FACT_COUNT);
  clearU8(falseSeen, FACT_COUNT);
  clearU8(touchedCells, CELL_COUNT);
  clearU8(touchedTriples, TRIPLE_COUNT);
  trueCountValue = 0;
  falseCountValue = 0;
  initialized = false;
  contradictionValue = 0;
  guardIterationsValue = 0;
}

@inline
function markTripleTouched(unitType: i32, idx: i32, d: i32): void {
  unchecked(touchedTriples[tripleKey(unitType, idx, d)] = 1);
}

function clearUnitPositionsOnly(index: i32, d: i32): void {
  const r = index / 9;
  const c = index % 9;
  const box = boxIndexRC(r, c);
  const posInBox = (r % 3) * 3 + (c % 3);

  let ui = unitMaskIndex(0, r, d);
  let m = unchecked(unitDigitMask[ui]);
  const rowBit = positionBit(c);
  if ((m & rowBit) != 0) {
    unchecked(unitDigitMask[ui] = <u16>(m & ~rowBit));
    markTripleTouched(0, r, d);
  }

  ui = unitMaskIndex(1, c, d);
  m = unchecked(unitDigitMask[ui]);
  const colBit = positionBit(r);
  if ((m & colBit) != 0) {
    unchecked(unitDigitMask[ui] = <u16>(m & ~colBit));
    markTripleTouched(1, c, d);
  }

  ui = unitMaskIndex(2, box, d);
  m = unchecked(unitDigitMask[ui]);
  const boxBit = positionBit(posInBox);
  if ((m & boxBit) != 0) {
    unchecked(unitDigitMask[ui] = <u16>(m & ~boxBit));
    markTripleTouched(2, box, d);
  }
}

function clearCandidate(index: i32, d: i32): void {
  const bit = bitForDigit(d);
  const old = unchecked(cellMask[index]);
  if ((old & bit) == 0) return;
  unchecked(cellMask[index] = <u16>(old & ~bit));
  unchecked(touchedCells[index] = 1);
  clearUnitPositionsOnly(index, d);
}

function placeDigit(index: i32, d: i32): void {
  const r = index / 9;
  const c = index % 9;
  const box = boxIndexRC(r, c);
  const oldMask = unchecked(cellMask[index]);

  for (let dd: i32 = 1; dd <= 9; dd++) {
    if ((oldMask & bitForDigit(dd)) != 0) clearUnitPositionsOnly(index, dd);
  }
  unchecked(cellMask[index] = 0);
  unchecked(grid[index] = <u8>d);

  const dBit = bitForDigit(d);
  let pi = placedIndex(0, r);
  unchecked(placedMask[pi] = <u16>(unchecked(placedMask[pi]) | dBit));
  pi = placedIndex(1, c);
  unchecked(placedMask[pi] = <u16>(unchecked(placedMask[pi]) | dBit));
  pi = placedIndex(2, box);
  unchecked(placedMask[pi] = <u16>(unchecked(placedMask[pi]) | dBit));

  // Equivalent to the JS PEERS_TABLE traversal. Duplicate row/box or col/box
  // visits are harmless because clearCandidate exits once the bit is gone.
  for (let cc: i32 = 0; cc < 9; cc++) {
    if (cc == c) continue;
    const peer = r * 9 + cc;
    if (unchecked(grid[peer]) == 0) clearCandidate(peer, d);
  }
  for (let rr: i32 = 0; rr < 9; rr++) {
    if (rr == r) continue;
    const peer = rr * 9 + c;
    if (unchecked(grid[peer]) == 0) clearCandidate(peer, d);
  }
  const br = (r / 3) * 3;
  const bc = (c / 3) * 3;
  for (let dr: i32 = 0; dr < 3; dr++) {
    for (let dc: i32 = 0; dc < 3; dc++) {
      const rr = br + dr;
      const cc = bc + dc;
      if (rr == r && cc == c) continue;
      const peer = rr * 9 + cc;
      if (unchecked(grid[peer]) == 0) clearCandidate(peer, d);
    }
  }
}

function markTrue(r: i32, c: i32, d: i32): bool {
  const k = factIndex(r, c, d);
  if (unchecked(trueSeen[k]) != 0) return true;
  if (unchecked(falseSeen[k]) != 0) return false;
  const index = r * 9 + c;
  const current = unchecked(grid[index]);
  if (current != 0) return current == d;
  if (initialized && (unchecked(cellMask[index]) & bitForDigit(d)) == 0) return false;

  unchecked(trueSeen[k] = 1);
  unchecked(trueOrder[trueCountValue++] = <u16>k);
  if (initialized) placeDigit(index, d);
  else unchecked(grid[index] = <u8>d);
  return true;
}

function markFalse(r: i32, c: i32, d: i32): bool {
  const k = factIndex(r, c, d);
  if (unchecked(falseSeen[k]) != 0) return true;
  if (unchecked(trueSeen[k]) != 0) return false;
  const index = r * 9 + c;
  if (unchecked(grid[index]) != 0) return true;

  unchecked(falseSeen[k] = 1);
  unchecked(falseOrder[falseCountValue++] = <u16>k);
  if (initialized) clearCandidate(index, d);
  return true;
}

function initMasks(): void {
  clearU16(unitDigitMask, UNIT_DIGIT_COUNT);
  clearU16(placedMask, PLACED_COUNT);
  clearU8(touchedCells, CELL_COUNT);
  clearU8(touchedTriples, TRIPLE_COUNT);

  // Placed digits from the assumption-adjusted working grid.
  for (let index: i32 = 0; index < CELL_COUNT; index++) {
    const d = <i32>unchecked(grid[index]);
    if (d == 0) continue;
    const r = index / 9;
    const c = index % 9;
    const box = boxIndexRC(r, c);
    const bit = bitForDigit(d);
    let pi = placedIndex(0, r);
    unchecked(placedMask[pi] = <u16>(unchecked(placedMask[pi]) | bit));
    pi = placedIndex(1, c);
    unchecked(placedMask[pi] = <u16>(unchecked(placedMask[pi]) | bit));
    pi = placedIndex(2, box);
    unchecked(placedMask[pi] = <u16>(unchecked(placedMask[pi]) | bit));
  }

  for (let index: i32 = 0; index < CELL_COUNT; index++) {
    if (unchecked(grid[index]) != 0) {
      unchecked(cellMask[index] = 0);
      continue;
    }
    const r = index / 9;
    const c = index % 9;
    let used: u16 = 0;
    for (let i: i32 = 0; i < 9; i++) {
      const rv = <i32>unchecked(grid[r * 9 + i]);
      const cv = <i32>unchecked(grid[i * 9 + c]);
      if (rv != 0) used = <u16>(used | bitForDigit(rv));
      if (cv != 0) used = <u16>(used | bitForDigit(cv));
    }
    const br = (r / 3) * 3;
    const bc = (c / 3) * 3;
    for (let dr: i32 = 0; dr < 3; dr++) {
      for (let dc: i32 = 0; dc < 3; dc++) {
        const v = <i32>unchecked(grid[(br + dr) * 9 + bc + dc]);
        if (v != 0) used = <u16>(used | bitForDigit(v));
      }
    }

    let erased: u16 = 0;
    for (let d: i32 = 1; d <= 9; d++) {
      if (unchecked(falseSeen[factIndex(r, c, d)]) != 0) erased = <u16>(erased | bitForDigit(d));
    }
    const raw = <u16>(ALL_DIGITS & ~used);
    const base = unchecked(inputBaseMask[index]);
    unchecked(cellMask[index] = <u16>(raw & base & ~erased));
  }

  // Build unit x digit candidate-position masks.
  for (let index: i32 = 0; index < CELL_COUNT; index++) {
    const mask = unchecked(cellMask[index]);
    if (mask == 0) continue;
    const r = index / 9;
    const c = index % 9;
    const box = boxIndexRC(r, c);
    const posInBox = (r % 3) * 3 + (c % 3);
    for (let d: i32 = 1; d <= 9; d++) {
      const bit = bitForDigit(d);
      if ((mask & bit) == 0) continue;
      let ui = unitMaskIndex(0, r, d);
      unchecked(unitDigitMask[ui] = <u16>(unchecked(unitDigitMask[ui]) | positionBit(c)));
      ui = unitMaskIndex(1, c, d);
      unchecked(unitDigitMask[ui] = <u16>(unchecked(unitDigitMask[ui]) | positionBit(r)));
      ui = unitMaskIndex(2, box, d);
      unchecked(unitDigitMask[ui] = <u16>(unchecked(unitDigitMask[ui]) | positionBit(posInBox)));
    }
  }

  initialized = true;

  // Exact JS behavior: first contradiction check is prepared as a full scan,
  // but it is only executed after a technique finding is applied.
  for (let index: i32 = 0; index < CELL_COUNT; index++) unchecked(touchedCells[index] = 1);
  for (let d: i32 = 1; d <= 9; d++) {
    for (let unitType: i32 = 0; unitType < 3; unitType++) {
      for (let idx: i32 = 0; idx < 9; idx++) {
        unchecked(touchedTriples[tripleKey(unitType, idx, d)] = 1);
      }
    }
  }
}

// Return 0=no finding, 1=applied, -1=hard conflict.
function applyNakedSingle(): i32 {
  for (let index: i32 = 0; index < CELL_COUNT; index++) {
    if (unchecked(grid[index]) != 0) continue;
    const mask = unchecked(cellMask[index]);
    if (mask != 0 && (mask & <u16>(mask - 1)) == 0) {
      const d = singletonDigit(mask);
      const r = index / 9;
      const c = index % 9;
      return markTrue(r, c, d) ? 1 : -1;
    }
  }
  return 0;
}

function applyHiddenSingle(): i32 {
  for (let unitType: i32 = 0; unitType < 3; unitType++) {
    for (let idx: i32 = 0; idx < 9; idx++) {
      const present = unchecked(placedMask[placedIndex(unitType, idx)]);
      for (let d: i32 = 1; d <= 9; d++) {
        const bit = bitForDigit(d);
        if ((present & bit) != 0) continue;
        let spotIndex: i32 = -1;
        let count: i32 = 0;
        for (let pos: i32 = 0; pos < 9; pos++) {
          const index = unitCellIndex(unitType, idx, pos);
          if (unchecked(grid[index]) != 0) continue;
          if ((unchecked(cellMask[index]) & bit) != 0) {
            count++;
            if (count > 1) break;
            spotIndex = index;
          }
        }
        if (count == 1) {
          return markTrue(spotIndex / 9, spotIndex % 9, d) ? 1 : -1;
        }
      }
    }
  }
  return 0;
}

function applyLockedCandidates(): i32 {
  // pointing: box -> row/col
  for (let box: i32 = 0; box < 9; box++) {
    for (let d: i32 = 1; d <= 9; d++) {
      const bit = bitForDigit(d);
      let count: i32 = 0;
      let firstRow: i32 = -1;
      let firstCol: i32 = -1;
      let sameRow: bool = true;
      let sameCol: bool = true;
      for (let pos: i32 = 0; pos < 9; pos++) {
        const index = unitCellIndex(2, box, pos);
        if (unchecked(grid[index]) != 0 || (unchecked(cellMask[index]) & bit) == 0) continue;
        const r = index / 9;
        const c = index % 9;
        if (count == 0) {
          firstRow = r;
          firstCol = c;
        } else {
          if (r != firstRow) sameRow = false;
          if (c != firstCol) sameCol = false;
        }
        count++;
      }
      if (count < 2) continue;

      if (sameRow) {
        let elimCount: i32 = 0;
        for (let c: i32 = 0; c < 9; c++) {
          const index = firstRow * 9 + c;
          if (boxIndexRC(firstRow, c) == box) continue;
          if (unchecked(grid[index]) == 0 && (unchecked(cellMask[index]) & bit) != 0) elimCount++;
        }
        if (elimCount > 0) {
          for (let c: i32 = 0; c < 9; c++) {
            const index = firstRow * 9 + c;
            if (boxIndexRC(firstRow, c) == box) continue;
            if (unchecked(grid[index]) == 0 && (unchecked(cellMask[index]) & bit) != 0) {
              if (!markFalse(firstRow, c, d)) return -1;
            }
          }
          return 1;
        }
      }

      if (sameCol) {
        let elimCount: i32 = 0;
        for (let r: i32 = 0; r < 9; r++) {
          const index = r * 9 + firstCol;
          if (boxIndexRC(r, firstCol) == box) continue;
          if (unchecked(grid[index]) == 0 && (unchecked(cellMask[index]) & bit) != 0) elimCount++;
        }
        if (elimCount > 0) {
          for (let r: i32 = 0; r < 9; r++) {
            const index = r * 9 + firstCol;
            if (boxIndexRC(r, firstCol) == box) continue;
            if (unchecked(grid[index]) == 0 && (unchecked(cellMask[index]) & bit) != 0) {
              if (!markFalse(r, firstCol, d)) return -1;
            }
          }
          return 1;
        }
      }
    }
  }

  // claiming: row/col -> box
  for (let lineType: i32 = 0; lineType < 2; lineType++) {
    for (let idx: i32 = 0; idx < 9; idx++) {
      for (let d: i32 = 1; d <= 9; d++) {
        const bit = bitForDigit(d);
        let count: i32 = 0;
        let firstBox: i32 = -1;
        let sameBox: bool = true;
        for (let pos: i32 = 0; pos < 9; pos++) {
          const index = unitCellIndex(lineType, idx, pos);
          if (unchecked(grid[index]) != 0 || (unchecked(cellMask[index]) & bit) == 0) continue;
          const b = boxIndexRC(index / 9, index % 9);
          if (count == 0) firstBox = b;
          else if (b != firstBox) sameBox = false;
          count++;
        }
        if (count < 2 || !sameBox) continue;

        let elimCount: i32 = 0;
        for (let pos: i32 = 0; pos < 9; pos++) {
          const index = unitCellIndex(2, firstBox, pos);
          const r = index / 9;
          const c = index % 9;
          const inLine = lineType == 0 ? r == idx : c == idx;
          if (!inLine && unchecked(grid[index]) == 0 && (unchecked(cellMask[index]) & bit) != 0) elimCount++;
        }
        if (elimCount > 0) {
          for (let pos: i32 = 0; pos < 9; pos++) {
            const index = unitCellIndex(2, firstBox, pos);
            const r = index / 9;
            const c = index % 9;
            const inLine = lineType == 0 ? r == idx : c == idx;
            if (!inLine && unchecked(grid[index]) == 0 && (unchecked(cellMask[index]) & bit) != 0) {
              if (!markFalse(r, c, d)) return -1;
            }
          }
          return 1;
        }
      }
    }
  }
  return 0;
}


@inline
function comboContains(index: i32, a: i32, b: i32, c: i32, k: i32): bool {
  if (index == a || index == b) return true;
  return k == 3 && index == c;
}

function tryNakedSubsetCombo(unitType: i32, idx: i32, a: i32, b: i32, c: i32, k: i32): i32 {
  let unionMask: u16 = unchecked(cellMask[a]) | unchecked(cellMask[b]);
  if (k == 3) unionMask = <u16>(unionMask | unchecked(cellMask[c]));
  if (countBits9(unionMask) != k) return 0;

  let eliminationCount: i32 = 0;
  for (let pos: i32 = 0; pos < 9; pos++) {
    const index = unitCellIndex(unitType, idx, pos);
    if (comboContains(index, a, b, c, k) || unchecked(grid[index]) != 0) continue;
    eliminationCount += countBits9(<u16>(unchecked(cellMask[index]) & unionMask));
  }
  if (eliminationCount == 0) return 0;

  // JS builds the full elimination list in unit-cell order, with digits
  // ascending inside each cell, then applies it. This second pass preserves
  // that exact order while avoiding a heap Finding object in the hot path.
  for (let pos: i32 = 0; pos < 9; pos++) {
    const index = unitCellIndex(unitType, idx, pos);
    if (comboContains(index, a, b, c, k) || unchecked(grid[index]) != 0) continue;
    const eliminateMask = <u16>(unchecked(cellMask[index]) & unionMask);
    for (let d: i32 = 1; d <= 9; d++) {
      if ((eliminateMask & bitForDigit(d)) == 0) continue;
      if (!markFalse(index / 9, index % 9, d)) return -1;
    }
  }
  return 1;
}

function applyNakedSubset(k: i32): i32 {
  for (let unitType: i32 = 0; unitType < 3; unitType++) {
    for (let idx: i32 = 0; idx < 9; idx++) {
      const eligible = new StaticArray<i32>(9);
      let count: i32 = 0;
      for (let pos: i32 = 0; pos < 9; pos++) {
        const index = unitCellIndex(unitType, idx, pos);
        if (unchecked(grid[index]) != 0) continue;
        const n = countBits9(unchecked(cellMask[index]));
        if (n >= 2 && n <= k) unchecked(eligible[count++] = index);
      }
      if (count < k) continue;

      if (k == 2) {
        for (let i: i32 = 0; i < count - 1; i++) {
          for (let j: i32 = i + 1; j < count; j++) {
            const result = tryNakedSubsetCombo(
              unitType, idx,
              unchecked(eligible[i]), unchecked(eligible[j]), -1, 2
            );
            if (result != 0) return result;
          }
        }
      } else {
        for (let i: i32 = 0; i < count - 2; i++) {
          for (let j: i32 = i + 1; j < count - 1; j++) {
            for (let q: i32 = j + 1; q < count; q++) {
              const result = tryNakedSubsetCombo(
                unitType, idx,
                unchecked(eligible[i]), unchecked(eligible[j]), unchecked(eligible[q]), 3
              );
              if (result != 0) return result;
            }
          }
        }
      }
    }
  }
  return 0;
}

function tryHiddenSubsetDigits(unitType: i32, idx: i32, d1: i32, d2: i32, d3: i32, k: i32): i32 {
  const cells = new StaticArray<i32>(9);
  let cellCount: i32 = 0;

  // JS Set insertion order is: first selected digit's unit positions, then the
  // second's, then the third's, de-duplicated. Recreate that order explicitly.
  for (let which: i32 = 0; which < k; which++) {
    const d = which == 0 ? d1 : which == 1 ? d2 : d3;
    const bit = bitForDigit(d);
    for (let pos: i32 = 0; pos < 9; pos++) {
      const index = unitCellIndex(unitType, idx, pos);
      if (unchecked(grid[index]) != 0 || (unchecked(cellMask[index]) & bit) == 0) continue;
      let seen: bool = false;
      for (let i: i32 = 0; i < cellCount; i++) if (unchecked(cells[i]) == index) { seen = true; break; }
      if (!seen) unchecked(cells[cellCount++] = index);
    }
  }
  if (cellCount != k) return 0;

  let digitMask = <u16>(bitForDigit(d1) | bitForDigit(d2));
  if (k == 3) digitMask = <u16>(digitMask | bitForDigit(d3));

  let eliminationCount: i32 = 0;
  for (let i: i32 = 0; i < cellCount; i++) {
    const index = unchecked(cells[i]);
    eliminationCount += countBits9(<u16>(unchecked(cellMask[index]) & <u16>(~digitMask)));
  }
  if (eliminationCount == 0) return 0;

  for (let i: i32 = 0; i < cellCount; i++) {
    const index = unchecked(cells[i]);
    const eliminateMask = <u16>(unchecked(cellMask[index]) & <u16>(~digitMask));
    for (let d: i32 = 1; d <= 9; d++) {
      if ((eliminateMask & bitForDigit(d)) == 0) continue;
      if (!markFalse(index / 9, index % 9, d)) return -1;
    }
  }
  return 1;
}

function applyHiddenSubset(k: i32): i32 {
  for (let unitType: i32 = 0; unitType < 3; unitType++) {
    for (let idx: i32 = 0; idx < 9; idx++) {
      const present = unchecked(placedMask[placedIndex(unitType, idx)]);
      const eligibleDigits = new StaticArray<i32>(9);
      let eligibleCount: i32 = 0;

      for (let d: i32 = 1; d <= 9; d++) {
        const bit = bitForDigit(d);
        if ((present & bit) != 0) continue;
        let positions: i32 = 0;
        for (let pos: i32 = 0; pos < 9; pos++) {
          const index = unitCellIndex(unitType, idx, pos);
          if (unchecked(grid[index]) == 0 && (unchecked(cellMask[index]) & bit) != 0) positions++;
        }
        if (positions >= 2 && positions <= k) unchecked(eligibleDigits[eligibleCount++] = d);
      }
      if (eligibleCount < k) continue;

      if (k == 2) {
        for (let i: i32 = 0; i < eligibleCount - 1; i++) {
          for (let j: i32 = i + 1; j < eligibleCount; j++) {
            const result = tryHiddenSubsetDigits(
              unitType, idx, unchecked(eligibleDigits[i]), unchecked(eligibleDigits[j]), 0, 2
            );
            if (result != 0) return result;
          }
        }
      } else {
        for (let i: i32 = 0; i < eligibleCount - 2; i++) {
          for (let j: i32 = i + 1; j < eligibleCount - 1; j++) {
            for (let q: i32 = j + 1; q < eligibleCount; q++) {
              const result = tryHiddenSubsetDigits(
                unitType, idx,
                unchecked(eligibleDigits[i]), unchecked(eligibleDigits[j]), unchecked(eligibleDigits[q]), 3
              );
              if (result != 0) return result;
            }
          }
        }
      }
    }
  }
  return 0;
}

@inline
function baseComboContains(idx: i32, a: i32, b: i32, c: i32, k: i32): bool {
  if (idx == a || idx == b) return true;
  return k == 3 && idx == c;
}

function tryFishCombo(d: i32, baseType: i32, a: i32, b: i32, c: i32, k: i32): i32 {
  const bit = bitForDigit(d);
  const coverOrder = new StaticArray<i32>(9);
  let coverCount: i32 = 0;

  for (let which: i32 = 0; which < k; which++) {
    const baseIdx = which == 0 ? a : which == 1 ? b : c;
    for (let pos: i32 = 0; pos < 9; pos++) {
      const index = unitCellIndex(baseType, baseIdx, pos);
      if (unchecked(grid[index]) != 0 || (unchecked(cellMask[index]) & bit) == 0) continue;
      const coverIdx = baseType == 0 ? index % 9 : index / 9;
      let seen: bool = false;
      for (let i: i32 = 0; i < coverCount; i++) if (unchecked(coverOrder[i]) == coverIdx) { seen = true; break; }
      if (!seen) unchecked(coverOrder[coverCount++] = coverIdx);
    }
  }
  if (coverCount != k) return 0;

  const coverType = baseType == 0 ? 1 : 0;
  let eliminationCount: i32 = 0;
  for (let ci: i32 = 0; ci < coverCount; ci++) {
    const coverIdx = unchecked(coverOrder[ci]);
    for (let pos: i32 = 0; pos < 9; pos++) {
      const index = unitCellIndex(coverType, coverIdx, pos);
      const baseIdxOfCell = baseType == 0 ? index / 9 : index % 9;
      if (baseComboContains(baseIdxOfCell, a, b, c, k)) continue;
      if (unchecked(grid[index]) == 0 && (unchecked(cellMask[index]) & bit) != 0) eliminationCount++;
    }
  }
  if (eliminationCount == 0) return 0;

  for (let ci: i32 = 0; ci < coverCount; ci++) {
    const coverIdx = unchecked(coverOrder[ci]);
    for (let pos: i32 = 0; pos < 9; pos++) {
      const index = unitCellIndex(coverType, coverIdx, pos);
      const baseIdxOfCell = baseType == 0 ? index / 9 : index % 9;
      if (baseComboContains(baseIdxOfCell, a, b, c, k)) continue;
      if (unchecked(grid[index]) == 0 && (unchecked(cellMask[index]) & bit) != 0) {
        if (!markFalse(index / 9, index % 9, d)) return -1;
      }
    }
  }
  return 1;
}

function applyFish(k: i32): i32 {
  for (let d: i32 = 1; d <= 9; d++) {
    const bit = bitForDigit(d);
    for (let baseType: i32 = 0; baseType < 2; baseType++) {
      const eligible = new StaticArray<i32>(9);
      let eligibleCount: i32 = 0;
      for (let idx: i32 = 0; idx < 9; idx++) {
        let positions: i32 = 0;
        for (let pos: i32 = 0; pos < 9; pos++) {
          const index = unitCellIndex(baseType, idx, pos);
          if (unchecked(grid[index]) == 0 && (unchecked(cellMask[index]) & bit) != 0) positions++;
        }
        if (positions >= 2 && positions <= k) unchecked(eligible[eligibleCount++] = idx);
      }
      if (eligibleCount < k) continue;

      if (k == 2) {
        for (let i: i32 = 0; i < eligibleCount - 1; i++) {
          for (let j: i32 = i + 1; j < eligibleCount; j++) {
            const result = tryFishCombo(d, baseType, unchecked(eligible[i]), unchecked(eligible[j]), -1, 2);
            if (result != 0) return result;
          }
        }
      } else {
        for (let i: i32 = 0; i < eligibleCount - 2; i++) {
          for (let j: i32 = i + 1; j < eligibleCount - 1; j++) {
            for (let q: i32 = j + 1; q < eligibleCount; q++) {
              const result = tryFishCombo(
                d, baseType, unchecked(eligible[i]), unchecked(eligible[j]), unchecked(eligible[q]), 3
              );
              if (result != 0) return result;
            }
          }
        }
      }
    }
  }
  return 0;
}

function runStaticBudgetedInternal(r: i32, c: i32, d: i32, startTrue: bool): i32 {
  budgetCallsValue++;
  if (budgetCallsValue > budgetLimitValue) {
    contradictionValue = 0;
    abortedValue = 1;
    // JS returns freshly allocated empty Sets on a budget abort. Counts alone
    // are not enough because outer Unary logic queries set membership directly.
    clearU8(trueSeen, FACT_COUNT);
    clearU8(falseSeen, FACT_COUNT);
    trueCountValue = 0;
    falseCountValue = 0;
    return 0;
  }

  resetWork();
  abortedValue = 0;
  const initialOk = startTrue ? markTrue(r, c, d) : markFalse(r, c, d);
  if (!initialOk) {
    contradictionValue = 1;
    return 1;
  }
  initMasks();

  let guard: i32 = 0;
  while (guard++ < 200) {
    guardIterationsValue = guard;
    let result = applyNakedSingle();
    if (result == 0) result = applyHiddenSingle();
    if (result == 0) result = applyLockedCandidates();
    if (result == 0) break;
    if (result < 0 || detectContradiction()) {
      contradictionValue = 1;
      return 1;
    }
    clearTouched();
  }
  contradictionValue = 0;
  return 0;
}

function nestedStaticContradiction(r: i32, c: i32, d: i32): bool {
  // Snapshot the full outer propagation frame. Budget counters intentionally
  // live outside the frame because JS shares one budget object across all
  // nested calls in a Dynamic finder.
  saveOuterFrame();
  copyU8(backupGrid, inputGrid, CELL_COUNT);
  copyU16(backupCellMask, inputBaseMask, CELL_COUNT);

  const nestedContradiction = runStaticBudgetedInternal(r, c, d, true) != 0;
  restoreOuterFrame();
  return nestedContradiction;
}

function applyNestedNishio(): i32 {
  if (budgetCallsValue > budgetLimitValue) return 0;

  // JS uses a stable sort by candidate-count only. The source list is
  // row-major and digit-ascending, so iterating n=1..9 reproduces that stable
  // ordering exactly without a comparator implementation.
  for (let n: i32 = 1; n <= 9; n++) {
    for (let index: i32 = 0; index < CELL_COUNT; index++) {
      if (unchecked(grid[index]) != 0) continue;
      const mask = unchecked(cellMask[index]);
      if (countBits9(mask) != n) continue;
      for (let d: i32 = 1; d <= 9; d++) {
        if ((mask & bitForDigit(d)) == 0) continue;
        if (budgetCallsValue > budgetLimitValue) return 0;
        const r = index / 9;
        const c = index % 9;
        if (nestedStaticContradiction(r, c, d)) {
          return markFalse(r, c, d) ? 1 : -1;
        }
      }
    }
  }
  return 0;
}

function applyDynamicTechnique(): i32 {
  let result = applyNakedSingle();
  if (result == 0) result = applyHiddenSingle();
  if (result == 0) result = applyLockedCandidates();
  if (result == 0) result = applyNakedSubset(2);
  if (result == 0) result = applyHiddenSubset(2);
  if (result == 0) result = applyNakedSubset(3);
  if (result == 0) result = applyHiddenSubset(3);
  if (result == 0) result = applyFish(2);
  if (result == 0) result = applyFish(3);
  if (result == 0) result = applyNestedNishio();
  return result;
}

function detectContradiction(): bool {
  for (let index: i32 = 0; index < CELL_COUNT; index++) {
    if (unchecked(touchedCells[index]) == 0) continue;
    if (unchecked(grid[index]) == 0 && unchecked(cellMask[index]) == 0) return true;
  }

  for (let key: i32 = 0; key < TRIPLE_COUNT; key++) {
    if (unchecked(touchedTriples[key]) == 0) continue;
    const d = key / 27 + 1;
    const rest = key % 27;
    const unitType = rest / 9;
    const idx = rest % 9;
    const positions = unchecked(unitDigitMask[unitMaskIndex(unitType, idx, d)]);
    const placed = unchecked(placedMask[placedIndex(unitType, idx)]);
    if (positions == 0 && (placed & bitForDigit(d)) == 0) return true;
  }
  return false;
}

function clearTouched(): void {
  clearU8(touchedCells, CELL_COUNT);
  clearU8(touchedTriples, TRIPLE_COUNT);
}

export function runStaticAssumption(r: i32, c: i32, d: i32, startTrue: i32): i32 {
  resetWork();

  const initialOk = startTrue != 0 ? markTrue(r, c, d) : markFalse(r, c, d);
  if (!initialOk) {
    contradictionValue = 1;
    return contradictionValue;
  }

  initMasks();

  let guard: i32 = 0;
  while (guard++ < 200) {
    guardIterationsValue = guard;
    let result = applyNakedSingle();
    if (result == 0) result = applyHiddenSingle();
    if (result == 0) result = applyLockedCandidates();
    if (result == 0) break;
    if (result < 0) {
      contradictionValue = 1;
      return contradictionValue;
    }

    if (detectContradiction()) {
      contradictionValue = 1;
      return contradictionValue;
    }
    clearTouched();
  }

  contradictionValue = 0;
  return contradictionValue;
}

function runDynamicShared(r: i32, c: i32, d: i32, startTrue: bool): i32 {
  budgetCallsValue++; // propagateAssumptionCore increments at function entry
  if (budgetCallsValue > budgetLimitValue) {
    contradictionValue = 0;
    abortedValue = 1;
    // JS returns freshly allocated empty Sets on a budget abort. Counts alone
    // are not enough because outer Unary logic queries set membership directly.
    clearU8(trueSeen, FACT_COUNT);
    clearU8(falseSeen, FACT_COUNT);
    trueCountValue = 0;
    falseCountValue = 0;
    return 0;
  }

  resetWork();
  abortedValue = 0;

  const initialOk = startTrue ? markTrue(r, c, d) : markFalse(r, c, d);
  if (!initialOk) {
    contradictionValue = 1;
    return 1;
  }
  initMasks();

  let guard: i32 = 0;
  while (guard++ < 200) {
    guardIterationsValue = guard;
    const result = applyDynamicTechnique();
    if (result == 0) break;
    if (result < 0 || detectContradiction()) {
      contradictionValue = 1;
      return 1;
    }
    clearTouched();
  }

  contradictionValue = 0;
  return 0;
}

export function runDynamicAssumption(r: i32, c: i32, d: i32, startTrue: i32, budgetLimit: i32): i32 {
  budgetCallsValue = 0;
  budgetLimitValue = budgetLimit;
  return runDynamicShared(r, c, d, startTrue != 0);
}


function resetFinderResult(): void {
  finderActionType = 0;
  finderR = -1;
  finderC = -1;
  finderDigit = 0;
  finderStartR = -1;
  finderStartC = -1;
  finderStartDigit = 0;
  finderKind = 0;
  finderUnitType = -1;
  finderUnitIdx = -1;
  finderPatternCellCount = 0;
  finderEliminationCount = 0;
}

function copyOnBranchSets(): void {
  copyU8(trueSeen, branchTrueSeen, FACT_COUNT);
  copyU8(falseSeen, branchFalseSeen, FACT_COUNT);
  copyU16(trueOrder, branchTrueOrder, FACT_COUNT);
  copyU16(falseOrder, branchFalseOrder, FACT_COUNT);
  branchTrueCount = trueCountValue;
  branchFalseCount = falseCountValue;
}

export function runDynamicNishioFinder(budgetLimit: i32): i32 {
  resetFinderResult();
  budgetCallsValue = 0;
  budgetLimitValue = budgetLimit;

  for (let index: i32 = 0; index < CELL_COUNT; index++) {
    if (unchecked(inputGrid[index]) != 0) continue;
    const mask = unchecked(inputBaseMask[index]) & ALL_DIGITS;
    for (let d: i32 = 1; d <= 9; d++) {
      if ((mask & bitForDigit(d)) == 0) continue;
      const r = index / 9;
      const c = index % 9;
      runDynamicShared(r, c, d, true);
      if (contradictionValue == 0) continue;

      finderActionType = 2;
      finderStartR = r;
      finderStartC = c;
      finderStartDigit = d;
      finderEliminationCount = 1;
      unchecked(finderEliminations[0] = <u16>factIndex(r, c, d));
      return finderActionType;
    }
  }
  return 0;
}

export function runDynamicUnaryFinder(budgetLimit: i32): i32 {
  resetFinderResult();
  budgetCallsValue = 0;
  budgetLimitValue = budgetLimit;

  for (let index: i32 = 0; index < CELL_COUNT; index++) {
    if (unchecked(inputGrid[index]) != 0) continue;
    const mask = unchecked(inputBaseMask[index]) & ALL_DIGITS;
    for (let d: i32 = 1; d <= 9; d++) {
      if ((mask & bitForDigit(d)) == 0) continue;
      const r = index / 9;
      const c = index % 9;
      const startFact = factIndex(r, c, d);

      runDynamicShared(r, c, d, true);
      if (contradictionValue != 0) continue;
      copyOnBranchSets();

      runDynamicShared(r, c, d, false);
      if (contradictionValue != 0) continue;

      // JS iterates onB.trueSet insertion order and picks the first common
      // true fact, excluding the starting candidate itself.
      for (let i: i32 = 0; i < branchTrueCount; i++) {
        const k = <i32>unchecked(branchTrueOrder[i]);
        if (k == startFact || unchecked(trueSeen[k]) == 0) continue;
        const td = k % 9 + 1;
        const q = (k - (td - 1)) / 9;
        const tc = q % 9;
        const tr = (q - tc) / 9;

        finderActionType = 1;
        finderR = tr;
        finderC = tc;
        finderDigit = td;
        finderStartR = r;
        finderStartC = c;
        finderStartDigit = d;
        return finderActionType;
      }

      // No common true fact: JS filters onB.falseSet in its insertion order,
      // retaining every member also present in offB.falseSet.
      finderEliminationCount = 0;
      for (let i: i32 = 0; i < branchFalseCount; i++) {
        const k = <i32>unchecked(branchFalseOrder[i]);
        if (unchecked(falseSeen[k]) == 0) continue;
        unchecked(finderEliminations[finderEliminationCount++] = <u16>k);
      }
      if (finderEliminationCount > 0) {
        finderActionType = 2;
        finderStartR = r;
        finderStartC = c;
        finderStartDigit = d;
        return finderActionType;
      }
    }
  }
  return 0;
}

function runFinderAssumption(dynamicMode: bool, r: i32, c: i32, d: i32, startTrue: bool): void {
  if (dynamicMode) runDynamicShared(r, c, d, startTrue);
  else runStaticAssumption(r, c, d, startTrue ? 1 : 0);
}

export function runStaticNishioFinder(): i32 {
  resetFinderResult();
  for (let index: i32 = 0; index < CELL_COUNT; index++) {
    if (unchecked(inputGrid[index]) != 0) continue;
    const mask = unchecked(inputBaseMask[index]) & ALL_DIGITS;
    for (let d: i32 = 1; d <= 9; d++) {
      if ((mask & bitForDigit(d)) == 0) continue;
      const r = index / 9;
      const c = index % 9;
      runStaticAssumption(r, c, d, 1);
      if (contradictionValue == 0) continue;
      finderActionType = 2;
      finderStartR = r;
      finderStartC = c;
      finderStartDigit = d;
      finderEliminationCount = 1;
      unchecked(finderEliminations[0] = <u16>factIndex(r, c, d));
      return finderActionType;
    }
  }
  return 0;
}

export function runStaticUnaryFinder(): i32 {
  resetFinderResult();
  for (let index: i32 = 0; index < CELL_COUNT; index++) {
    if (unchecked(inputGrid[index]) != 0) continue;
    const mask = unchecked(inputBaseMask[index]) & ALL_DIGITS;
    for (let d: i32 = 1; d <= 9; d++) {
      if ((mask & bitForDigit(d)) == 0) continue;
      const r = index / 9;
      const c = index % 9;
      const startFact = factIndex(r, c, d);

      runStaticAssumption(r, c, d, 1);
      if (contradictionValue != 0) continue;
      copyOnBranchSets();

      runStaticAssumption(r, c, d, 0);
      if (contradictionValue != 0) continue;

      for (let i: i32 = 0; i < branchTrueCount; i++) {
        const k = <i32>unchecked(branchTrueOrder[i]);
        if (k == startFact || unchecked(trueSeen[k]) == 0) continue;
        finderActionType = 1;
        finderR = factR(k);
        finderC = factC(k);
        finderDigit = factD(k);
        finderStartR = r;
        finderStartC = c;
        finderStartDigit = d;
        return finderActionType;
      }

      finderEliminationCount = 0;
      for (let i: i32 = 0; i < branchFalseCount; i++) {
        const k = <i32>unchecked(branchFalseOrder[i]);
        if (unchecked(falseSeen[k]) == 0) continue;
        unchecked(finderEliminations[finderEliminationCount++] = <u16>k);
      }
      if (finderEliminationCount > 0) {
        finderActionType = 2;
        finderStartR = r;
        finderStartC = c;
        finderStartDigit = d;
        return finderActionType;
      }
    }
  }
  return 0;
}



function initMultiCommonFromCurrent(): void {
  copyU8(trueSeen, multiTrueSeen, FACT_COUNT);
  copyU8(falseSeen, multiFalseSeen, FACT_COUNT);
  copyU16(trueOrder, multiTrueOrder, FACT_COUNT);
  copyU16(falseOrder, multiFalseOrder, FACT_COUNT);
  multiTrueCount = trueCountValue;
  multiFalseCount = falseCountValue;
}

function intersectMultiCommonWithCurrent(): void {
  for (let i: i32 = 0; i < multiTrueCount; i++) {
    const k = <i32>unchecked(multiTrueOrder[i]);
    if (unchecked(multiTrueSeen[k]) != 0 && unchecked(trueSeen[k]) == 0) unchecked(multiTrueSeen[k] = 0);
  }
  for (let i: i32 = 0; i < multiFalseCount; i++) {
    const k = <i32>unchecked(multiFalseOrder[i]);
    if (unchecked(multiFalseSeen[k]) != 0 && unchecked(falseSeen[k]) == 0) unchecked(multiFalseSeen[k] = 0);
  }
}

@inline
function factR(k: i32): i32 {
  const d = k % 9 + 1;
  const q = (k - (d - 1)) / 9;
  const c = q % 9;
  return (q - c) / 9;
}

@inline
function factC(k: i32): i32 {
  const d = k % 9 + 1;
  const q = (k - (d - 1)) / 9;
  return q % 9;
}

@inline
function factD(k: i32): i32 {
  return k % 9 + 1;
}

function setFinderFillFromFact(k: i32): void {
  finderActionType = 1;
  finderDigit = factD(k);
  finderC = factC(k);
  finderR = factR(k);
}

function copyCommonFalseToFinder(): void {
  finderEliminationCount = 0;
  for (let i: i32 = 0; i < multiFalseCount; i++) {
    const k = <i32>unchecked(multiFalseOrder[i]);
    if (unchecked(multiFalseSeen[k]) == 0) continue;
    unchecked(finderEliminations[finderEliminationCount++] = <u16>k);
  }
}

function runMultipleCellFinder(dynamicMode: bool): i32 {
  for (let index: i32 = 0; index < CELL_COUNT; index++) {
    if (unchecked(inputGrid[index]) != 0) continue;
    const mask = unchecked(inputBaseMask[index]) & ALL_DIGITS;
    if (countBits9(mask) < 3) continue;

    let firstBranch: bool = true;
    let anyContradiction: bool = false;
    for (let d: i32 = 1; d <= 9; d++) {
      if ((mask & bitForDigit(d)) == 0) continue;
      runFinderAssumption(dynamicMode, index / 9, index % 9, d, true);
      if (contradictionValue != 0) {
        // JS uses cands.map(engine) before branches.some(...), so every
        // assumption consumes budget even when an earlier branch contradicted.
        // Do not short-circuit here; only suppress the final Multiple finding.
        anyContradiction = true;
        continue;
      }
      if (firstBranch) {
        initMultiCommonFromCurrent();
        firstBranch = false;
      } else {
        intersectMultiCommonWithCurrent();
      }
    }
    if (anyContradiction || firstBranch) continue;

    // JS deletes every start-cell candidate from commonTrue after intersection.
    for (let d: i32 = 1; d <= 9; d++) {
      if ((mask & bitForDigit(d)) == 0) continue;
      unchecked(multiTrueSeen[factIndex(index / 9, index % 9, d)] = 0);
    }

    let commonTrueFact: i32 = -1;
    for (let i: i32 = 0; i < multiTrueCount; i++) {
      const k = <i32>unchecked(multiTrueOrder[i]);
      if (unchecked(multiTrueSeen[k]) != 0) { commonTrueFact = k; break; }
    }

    if (commonTrueFact >= 0) {
      resetFinderResult();
      finderKind = 1;
      finderStartR = index / 9;
      finderStartC = index % 9;
      unchecked(finderPatternCells[0] = <u8>index);
      finderPatternCellCount = 1;
      setFinderFillFromFact(commonTrueFact);
      return finderActionType;
    }

    copyCommonFalseToFinder();
    if (finderEliminationCount > 0) {
      finderActionType = 2;
      finderKind = 1;
      finderStartR = index / 9;
      finderStartC = index % 9;
      unchecked(finderPatternCells[0] = <u8>index);
      finderPatternCellCount = 1;
      return finderActionType;
    }
  }
  return 0;
}

function runMultipleRegionFinder(dynamicMode: bool): i32 {
  for (let d: i32 = 1; d <= 9; d++) {
    const bit = bitForDigit(d);
    for (let unitType: i32 = 0; unitType < 3; unitType++) {
      for (let idx: i32 = 0; idx < 9; idx++) {
        const cells = new StaticArray<i32>(9);
        let cellCount: i32 = 0;
        for (let pos: i32 = 0; pos < 9; pos++) {
          const index = unitCellIndex(unitType, idx, pos);
          if (unchecked(inputGrid[index]) == 0 && (unchecked(inputBaseMask[index]) & bit) != 0) {
            unchecked(cells[cellCount++] = index);
          }
        }
        if (cellCount < 3) continue;

        let firstBranch: bool = true;
        let anyContradiction: bool = false;
        for (let ci: i32 = 0; ci < cellCount; ci++) {
          const index = unchecked(cells[ci]);
          runFinderAssumption(dynamicMode, index / 9, index % 9, d, true);
          if (contradictionValue != 0) {
            // JS constructs the full branches array before testing whether any
            // branch contradicted, so region branches also never short-circuit.
            anyContradiction = true;
            continue;
          }
          if (firstBranch) {
            initMultiCommonFromCurrent();
            firstBranch = false;
          } else {
            intersectMultiCommonWithCurrent();
          }
        }
        if (anyContradiction || firstBranch) continue;

        for (let ci: i32 = 0; ci < cellCount; ci++) {
          const index = unchecked(cells[ci]);
          unchecked(multiTrueSeen[factIndex(index / 9, index % 9, d)] = 0);
        }

        let commonTrueFact: i32 = -1;
        for (let i: i32 = 0; i < multiTrueCount; i++) {
          const k = <i32>unchecked(multiTrueOrder[i]);
          if (unchecked(multiTrueSeen[k]) != 0) { commonTrueFact = k; break; }
        }

        if (commonTrueFact >= 0) {
          resetFinderResult();
          finderKind = 2;
          finderUnitType = unitType;
          finderUnitIdx = idx;
          finderStartDigit = d;
          finderPatternCellCount = cellCount;
          for (let ci: i32 = 0; ci < cellCount; ci++) unchecked(finderPatternCells[ci] = <u8>unchecked(cells[ci]));
          setFinderFillFromFact(commonTrueFact);
          return finderActionType;
        }

        copyCommonFalseToFinder();
        if (finderEliminationCount > 0) {
          finderActionType = 2;
          finderKind = 2;
          finderUnitType = unitType;
          finderUnitIdx = idx;
          finderStartDigit = d;
          finderPatternCellCount = cellCount;
          for (let ci: i32 = 0; ci < cellCount; ci++) unchecked(finderPatternCells[ci] = <u8>unchecked(cells[ci]));
          return finderActionType;
        }
      }
    }
  }
  return 0;
}

export function runDynamicMultipleFinder(budgetLimit: i32): i32 {
  resetFinderResult();
  budgetCallsValue = 0;
  budgetLimitValue = budgetLimit;

  const cellResult = runMultipleCellFinder(true);
  if (cellResult != 0) return cellResult;
  return runMultipleRegionFinder(true);
}

export function runStaticMultipleFinder(): i32 {
  resetFinderResult();
  const cellResult = runMultipleCellFinder(false);
  if (cellResult != 0) return cellResult;
  return runMultipleRegionFinder(false);
}

export function finderResultActionType(): i32 {
  return finderActionType;
}

export function finderResultR(): i32 {
  return finderR;
}

export function finderResultC(): i32 {
  return finderC;
}

export function finderResultDigit(): i32 {
  return finderDigit;
}

export function finderResultStartR(): i32 {
  return finderStartR;
}

export function finderResultStartC(): i32 {
  return finderStartC;
}

export function finderResultStartDigit(): i32 {
  return finderStartDigit;
}

export function finderResultKind(): i32 {
  return finderKind;
}

export function finderResultUnitType(): i32 {
  return finderUnitType;
}

export function finderResultUnitIdx(): i32 {
  return finderUnitIdx;
}

export function finderResultPatternCellCount(): i32 {
  return finderPatternCellCount;
}

export function finderResultPatternCellAt(index: i32): i32 {
  if (index < 0 || index >= finderPatternCellCount) return -1;
  return <i32>unchecked(finderPatternCells[index]);
}

export function finderResultEliminationCount(): i32 {
  return finderEliminationCount;
}

export function finderResultEliminationFactAt(index: i32): i32 {
  if (index < 0 || index >= finderEliminationCount) return -1;
  return <i32>unchecked(finderEliminations[index]);
}

export function resultBudgetCalls(): i32 {
  return budgetCallsValue;
}

export function resultAborted(): i32 {
  return abortedValue;
}

export function resultContradiction(): i32 {
  return contradictionValue;
}

export function resultGuardIterations(): i32 {
  return guardIterationsValue;
}

export function resultTrueCount(): i32 {
  return trueCountValue;
}

export function resultFalseCount(): i32 {
  return falseCountValue;
}

export function resultTrueFactAt(index: i32): i32 {
  if (index < 0 || index >= trueCountValue) return -1;
  return <i32>unchecked(trueOrder[index]);
}

export function resultFalseFactAt(index: i32): i32 {
  if (index < 0 || index >= falseCountValue) return -1;
  return <i32>unchecked(falseOrder[index]);
}

export function resultGridCell(index: i32): i32 {
  if (index < 0 || index >= CELL_COUNT) return 0;
  return <i32>unchecked(grid[index]);
}

export function resultCandidateMask(index: i32): i32 {
  if (index < 0 || index >= CELL_COUNT) return 0;
  return <i32>unchecked(cellMask[index]);
}

// Standalone raw-Finding ABI for individually migrated TECHNIQUE_CHAIN entries.
export function runStandaloneTechniqueFinder(techniqueId: i32): i32 { return basicRunTechniqueFinder(techniqueId); }
export function standaloneResultActionType(): i32 { return basicActionType(); }
export function standaloneResultTechniqueId(): i32 { return basicTechniqueId(); }
export function standaloneResultSubtype(): i32 { return basicSubtype(); }
export function standaloneResultR(): i32 { return basicR(); }
export function standaloneResultC(): i32 { return basicC(); }
export function standaloneResultDigit(): i32 { return basicDigit(); }
export function standaloneResultPatternCount(): i32 { return basicPatternCount(); }
export function standaloneResultPatternAt(i: i32): i32 { return basicPatternAt(i); }
export function standaloneResultEliminationCount(): i32 { return basicEliminationCount(); }
export function standaloneResultEliminationAt(i: i32): i32 { return basicEliminationAt(i); }
export function standaloneResultMeta(i: i32): i32 { return basicMeta(i); }
export function standaloneResultExtraCellCount(): i32 { return basicExtraCellCount(); }
export function standaloneResultExtraCellAt(i: i32): i32 { return basicExtraCellAt(i); }
export function standaloneResultExtraDigitCount(): i32 { return basicExtraDigitCount(); }
export function standaloneResultExtraDigitAt(i: i32): i32 { return basicExtraDigitAt(i); }

// Small deterministic kernel used only to detect gross JS<->WASM call/setup
// regressions. It is not the migration's performance acceptance benchmark.
export function candidateKernelChecksum(iterations: i32): i32 {
  let checksum: i32 = 0;
  for (let n: i32 = 0; n < iterations; n++) {
    for (let index: i32 = 0; index < CELL_COUNT; index++) {
      if (unchecked(inputGrid[index]) != 0) continue;
      const r = index / 9;
      const c = index % 9;
      let used: u16 = 0;
      for (let i: i32 = 0; i < 9; i++) {
        const rv = <i32>unchecked(inputGrid[r * 9 + i]);
        const cv = <i32>unchecked(inputGrid[i * 9 + c]);
        if (rv != 0) used = <u16>(used | bitForDigit(rv));
        if (cv != 0) used = <u16>(used | bitForDigit(cv));
      }
      const br = (r / 3) * 3;
      const bc = (c / 3) * 3;
      for (let dr: i32 = 0; dr < 3; dr++) {
        for (let dc: i32 = 0; dc < 3; dc++) {
          const v = <i32>unchecked(inputGrid[(br + dr) * 9 + bc + dc]);
          if (v != 0) used = <u16>(used | bitForDigit(v));
        }
      }
      const mask = <i32>(ALL_DIGITS & ~used & unchecked(inputBaseMask[index]));
      checksum = (checksum * 33 + mask + index) | 0;
    }
  }
  return checksum;
}
