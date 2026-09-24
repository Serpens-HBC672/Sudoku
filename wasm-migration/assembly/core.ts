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

export function resetInput(): void {
  clearU8(inputGrid, CELL_COUNT);
  clearU16(inputBaseMask, CELL_COUNT);
}

export function setInputCell(index: i32, digit: i32): void {
  if (index < 0 || index >= CELL_COUNT) return;
  unchecked(inputGrid[index] = <u8>digit);
}

export function setInputMask(index: i32, mask: i32): void {
  if (index < 0 || index >= CELL_COUNT) return;
  unchecked(inputBaseMask[index] = <u16>(mask & 0x01ff));
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
