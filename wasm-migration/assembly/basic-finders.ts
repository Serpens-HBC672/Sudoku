// Exact standalone discovery ports for the frozen human-technique oracle.
// Candidate masks are authoritative u16 values restricted to bits 0..8.

const CELL_COUNT: i32 = 81;
const FACT_COUNT: i32 = 729;
const ALL_DIGITS: u16 = 0x01ff;

const inputGrid = new StaticArray<u8>(CELL_COUNT);
const inputMasks = new StaticArray<u16>(CELL_COUNT);

let actionType: i32 = 0;
let techniqueId: i32 = -1;
let subtype: i32 = -1;
let resultR: i32 = -1;
let resultC: i32 = -1;
let resultDigit: i32 = 0;
const patternCells = new StaticArray<u8>(CELL_COUNT);
let patternCount: i32 = 0;
const eliminations = new StaticArray<u16>(FACT_COUNT);
let eliminationCount: i32 = 0;
const extraCells = new StaticArray<u8>(CELL_COUNT);
let extraCellCount: i32 = 0;
const meta = new StaticArray<i32>(16);

@inline
function boxIndex(r: i32, c: i32): i32 {
  return (r / 3) * 3 + c / 3;
}

@inline
function bitForDigit(d: i32): u16 {
  switch (d) {
    case 1: return 0x001;
    case 2: return 0x002;
    case 3: return 0x004;
    case 4: return 0x008;
    case 5: return 0x010;
    case 6: return 0x020;
    case 7: return 0x040;
    case 8: return 0x080;
    case 9: return 0x100;
    default: return 0;
  }
}

@inline
function factIndex(r: i32, c: i32, d: i32): i32 {
  return r * 81 + c * 9 + (d - 1);
}

@inline
function unitCellIndex(unitType: i32, idx: i32, pos: i32): i32 {
  if (unitType == 0) return idx * 9 + pos;
  if (unitType == 1) return pos * 9 + idx;
  const br = (idx / 3) * 3;
  const bc = (idx % 3) * 3;
  return (br + pos / 3) * 9 + (bc + pos % 3);
}

@inline
function maskAt(index: i32): u16 {
  return <u16>(unchecked(inputMasks[index]) & ALL_DIGITS);
}

@inline
function emptyAt(index: i32): bool {
  return unchecked(inputGrid[index]) == 0;
}

@inline
function countBits9(value: u16): i32 {
  let mask = <u16>(value & ALL_DIGITS);
  let count: i32 = 0;
  while (mask != 0) {
    mask = <u16>(mask & <u16>(mask - 1));
    count++;
  }
  return count;
}

@inline
function singletonDigit(mask: u16): i32 {
  for (let d: i32 = 1; d <= 9; d++) if ((mask & bitForDigit(d)) != 0) return d;
  return 0;
}

function resetResult(): void {
  actionType = 0;
  techniqueId = -1;
  subtype = -1;
  resultR = -1;
  resultC = -1;
  resultDigit = 0;
  patternCount = 0;
  eliminationCount = 0;
  extraCellCount = 0;
  for (let i: i32 = 0; i < 16; i++) unchecked(meta[i] = 0);
}

function appendPattern(index: i32): void {
  unchecked(patternCells[patternCount++] = <u8>index);
}

function appendElimination(index: i32, d: i32): void {
  unchecked(eliminations[eliminationCount++] = <u16>factIndex(index / 9, index % 9, d));
}

function setFill(id: i32, index: i32, d: i32): i32 {
  techniqueId = id;
  actionType = 1;
  resultR = index / 9;
  resultC = index % 9;
  resultDigit = d;
  return actionType;
}

export function basicResetInput(): void {
  for (let i: i32 = 0; i < CELL_COUNT; i++) {
    unchecked(inputGrid[i] = 0);
    unchecked(inputMasks[i] = 0);
  }
}

export function basicSetInputCell(index: i32, digit: i32): void {
  if (index >= 0 && index < CELL_COUNT) unchecked(inputGrid[index] = <u8>digit);
}

export function basicSetInputMask(index: i32, mask: i32): void {
  if (index >= 0 && index < CELL_COUNT) unchecked(inputMasks[index] = <u16>(mask & 0x1ff));
}

function findNakedSingle(): i32 {
  for (let index: i32 = 0; index < CELL_COUNT; index++) {
    if (!emptyAt(index)) continue;
    const mask = maskAt(index);
    if (mask != 0 && (mask & <u16>(mask - 1)) == 0) return setFill(0, index, singletonDigit(mask));
  }
  return 0;
}

function findHiddenSingle(): i32 {
  for (let unitType: i32 = 0; unitType < 3; unitType++) {
    for (let idx: i32 = 0; idx < 9; idx++) {
      let present: u16 = 0;
      for (let pos: i32 = 0; pos < 9; pos++) {
        const value = <i32>unchecked(inputGrid[unitCellIndex(unitType, idx, pos)]);
        if (value != 0) present = <u16>(present | bitForDigit(value));
      }
      for (let d: i32 = 1; d <= 9; d++) {
        const bit = bitForDigit(d);
        if ((present & bit) != 0) continue;
        let spot: i32 = -1;
        let count: i32 = 0;
        for (let pos: i32 = 0; pos < 9; pos++) {
          const index = unitCellIndex(unitType, idx, pos);
          if (!emptyAt(index)) continue;
          if ((maskAt(index) & bit) != 0) {
            count++;
            if (count > 1) break;
            spot = index;
          }
        }
        if (count == 1) {
          unchecked(meta[0] = unitType);
          unchecked(meta[1] = idx);
          return setFill(1, spot, d);
        }
      }
    }
  }
  return 0;
}

function collectSpots(unitType: i32, idx: i32, d: i32): i32 {
  patternCount = 0;
  const bit = bitForDigit(d);
  for (let pos: i32 = 0; pos < 9; pos++) {
    const index = unitCellIndex(unitType, idx, pos);
    if (emptyAt(index) && (maskAt(index) & bit) != 0) appendPattern(index);
  }
  return patternCount;
}

function findLockedCandidate(): i32 {
  for (let box: i32 = 0; box < 9; box++) {
    for (let d: i32 = 1; d <= 9; d++) {
      const count = collectSpots(2, box, d);
      if (count < 2) continue;
      const first = <i32>unchecked(patternCells[0]);
      const firstRow = first / 9;
      const firstCol = first % 9;
      let sameRow = true;
      let sameCol = true;
      for (let i: i32 = 1; i < count; i++) {
        const index = <i32>unchecked(patternCells[i]);
        if (index / 9 != firstRow) sameRow = false;
        if (index % 9 != firstCol) sameCol = false;
      }
      const bit = bitForDigit(d);
      if (sameRow) {
        eliminationCount = 0;
        for (let pos: i32 = 0; pos < 9; pos++) {
          const index = unitCellIndex(0, firstRow, pos);
          if (boxIndex(index / 9, index % 9) == box) continue;
          if (emptyAt(index) && (maskAt(index) & bit) != 0) appendElimination(index, d);
        }
        if (eliminationCount > 0) {
          techniqueId = 2; actionType = 2; subtype = 0;
          unchecked(meta[0] = box); unchecked(meta[1] = firstRow);
          unchecked(meta[2] = 0); unchecked(meta[3] = d);
          return actionType;
        }
      }
      if (sameCol) {
        eliminationCount = 0;
        for (let pos: i32 = 0; pos < 9; pos++) {
          const index = unitCellIndex(1, firstCol, pos);
          if (boxIndex(index / 9, index % 9) == box) continue;
          if (emptyAt(index) && (maskAt(index) & bit) != 0) appendElimination(index, d);
        }
        if (eliminationCount > 0) {
          techniqueId = 2; actionType = 2; subtype = 1;
          unchecked(meta[0] = box); unchecked(meta[1] = firstCol);
          unchecked(meta[2] = 1); unchecked(meta[3] = d);
          return actionType;
        }
      }
    }
  }

  for (let lineType: i32 = 0; lineType < 2; lineType++) {
    for (let idx: i32 = 0; idx < 9; idx++) {
      for (let d: i32 = 1; d <= 9; d++) {
        const count = collectSpots(lineType, idx, d);
        if (count < 2) continue;
        const first = <i32>unchecked(patternCells[0]);
        const oneBox = boxIndex(first / 9, first % 9);
        let sameBox = true;
        for (let i: i32 = 1; i < count; i++) {
          const index = <i32>unchecked(patternCells[i]);
          if (boxIndex(index / 9, index % 9) != oneBox) { sameBox = false; break; }
        }
        if (!sameBox) continue;
        eliminationCount = 0;
        const bit = bitForDigit(d);
        for (let pos: i32 = 0; pos < 9; pos++) {
          const index = unitCellIndex(2, oneBox, pos);
          const r = index / 9, c = index % 9;
          const inLine = lineType == 0 ? r == idx : c == idx;
          if (!inLine && emptyAt(index) && (maskAt(index) & bit) != 0) appendElimination(index, d);
        }
        if (eliminationCount > 0) {
          techniqueId = 2; actionType = 2; subtype = lineType == 0 ? 2 : 3;
          unchecked(meta[0] = oneBox); unchecked(meta[1] = idx);
          unchecked(meta[2] = lineType); unchecked(meta[3] = d);
          return actionType;
        }
      }
    }
  }
  patternCount = 0;
  return 0;
}


function initCombination(indices: StaticArray<i32>, k: i32): void {
  for (let i: i32 = 0; i < k; i++) unchecked(indices[i] = i);
}

function advanceCombination(indices: StaticArray<i32>, n: i32, k: i32): bool {
  let i = k - 1;
  while (i >= 0 && unchecked(indices[i]) == n - k + i) i--;
  if (i < 0) return false;
  unchecked(indices[i] = unchecked(indices[i]) + 1);
  for (let j = i + 1; j < k; j++) unchecked(indices[j] = unchecked(indices[j - 1]) + 1);
  return true;
}

function comboContainsValue(values: StaticArray<i32>, combo: StaticArray<i32>, k: i32, value: i32): bool {
  for (let i: i32 = 0; i < k; i++) {
    if (unchecked(values[unchecked(combo[i])]) == value) return true;
  }
  return false;
}

function appendUniqueCell(cells: StaticArray<i32>, count: i32, index: i32): i32 {
  for (let i: i32 = 0; i < count; i++) if (unchecked(cells[i]) == index) return count;
  unchecked(cells[count] = index);
  return count + 1;
}

function findNakedSubset(k: i32, id: i32): i32 {
  const eligible = new StaticArray<i32>(9);
  const combo = new StaticArray<i32>(9);

  for (let unitType: i32 = 0; unitType < 3; unitType++) {
    for (let idx: i32 = 0; idx < 9; idx++) {
      let eligibleCount: i32 = 0;
      for (let pos: i32 = 0; pos < 9; pos++) {
        const index = unitCellIndex(unitType, idx, pos);
        if (!emptyAt(index)) continue;
        const n = countBits9(maskAt(index));
        if (n >= 2 && n <= k) unchecked(eligible[eligibleCount++] = index);
      }
      if (eligibleCount < k) continue;

      initCombination(combo, k);
      while (true) {
        let unionMask: u16 = 0;
        for (let i: i32 = 0; i < k; i++) {
          const index = unchecked(eligible[unchecked(combo[i])]);
          unionMask = <u16>(unionMask | maskAt(index));
        }
        if (countBits9(unionMask) == k) {
          eliminationCount = 0;
          for (let pos: i32 = 0; pos < 9; pos++) {
            const index = unitCellIndex(unitType, idx, pos);
            if (!emptyAt(index) || comboContainsValue(eligible, combo, k, index)) continue;
            const eliminateMask = <u16>(maskAt(index) & unionMask);
            for (let d: i32 = 1; d <= 9; d++) {
              if ((eliminateMask & bitForDigit(d)) != 0) appendElimination(index, d);
            }
          }
          if (eliminationCount > 0) {
            techniqueId = id; actionType = 2; subtype = unitType;
            patternCount = 0;
            for (let i: i32 = 0; i < k; i++) appendPattern(unchecked(eligible[unchecked(combo[i])]));
            unchecked(meta[0] = unitType);
            unchecked(meta[1] = idx);
            unchecked(meta[2] = <i32>unionMask);
            unchecked(meta[3] = k);
            return actionType;
          }
        }
        if (!advanceCombination(combo, eligibleCount, k)) break;
      }
    }
  }
  return 0;
}

function findHiddenSubset(k: i32, id: i32): i32 {
  const eligibleDigits = new StaticArray<i32>(9);
  const combo = new StaticArray<i32>(9);
  const cells = new StaticArray<i32>(9);

  for (let unitType: i32 = 0; unitType < 3; unitType++) {
    for (let idx: i32 = 0; idx < 9; idx++) {
      let present: u16 = 0;
      for (let pos: i32 = 0; pos < 9; pos++) {
        const v = <i32>unchecked(inputGrid[unitCellIndex(unitType, idx, pos)]);
        if (v != 0) present = <u16>(present | bitForDigit(v));
      }

      let eligibleCount: i32 = 0;
      for (let d: i32 = 1; d <= 9; d++) {
        const bit = bitForDigit(d);
        if ((present & bit) != 0) continue;
        let positions: i32 = 0;
        for (let pos: i32 = 0; pos < 9; pos++) {
          const index = unitCellIndex(unitType, idx, pos);
          if (emptyAt(index) && (maskAt(index) & bit) != 0) positions++;
        }
        if (positions >= 2 && positions <= k) unchecked(eligibleDigits[eligibleCount++] = d);
      }
      if (eligibleCount < k) continue;

      initCombination(combo, k);
      while (true) {
        let cellCount: i32 = 0;
        let digitMask: u16 = 0;
        for (let ci: i32 = 0; ci < k; ci++) {
          const d = unchecked(eligibleDigits[unchecked(combo[ci])]);
          digitMask = <u16>(digitMask | bitForDigit(d));
          const bit = bitForDigit(d);
          for (let pos: i32 = 0; pos < 9; pos++) {
            const index = unitCellIndex(unitType, idx, pos);
            if (emptyAt(index) && (maskAt(index) & bit) != 0) {
              cellCount = appendUniqueCell(cells, cellCount, index);
            }
          }
        }

        if (cellCount == k) {
          eliminationCount = 0;
          for (let i: i32 = 0; i < cellCount; i++) {
            const index = unchecked(cells[i]);
            const eliminateMask = <u16>(maskAt(index) & <u16>(~digitMask));
            for (let d: i32 = 1; d <= 9; d++) {
              if ((eliminateMask & bitForDigit(d)) != 0) appendElimination(index, d);
            }
          }
          if (eliminationCount > 0) {
            techniqueId = id; actionType = 2; subtype = unitType;
            patternCount = 0;
            for (let i: i32 = 0; i < cellCount; i++) appendPattern(unchecked(cells[i]));
            unchecked(meta[0] = unitType);
            unchecked(meta[1] = idx);
            unchecked(meta[2] = <i32>digitMask);
            unchecked(meta[3] = k);
            return actionType;
          }
        }
        if (!advanceCombination(combo, eligibleCount, k)) break;
      }
    }
  }
  return 0;
}


function findFish(k: i32, id: i32): i32 {
  const eligibleBases = new StaticArray<i32>(9);
  const combo = new StaticArray<i32>(9);
  const coverOrder = new StaticArray<i32>(9);

  for (let d: i32 = 1; d <= 9; d++) {
    const bit = bitForDigit(d);
    for (let baseType: i32 = 0; baseType < 2; baseType++) {
      let eligibleCount: i32 = 0;
      for (let idx: i32 = 0; idx < 9; idx++) {
        let positions: i32 = 0;
        for (let pos: i32 = 0; pos < 9; pos++) {
          const index = unitCellIndex(baseType, idx, pos);
          if (emptyAt(index) && (maskAt(index) & bit) != 0) positions++;
        }
        if (positions >= 2 && positions <= k) unchecked(eligibleBases[eligibleCount++] = idx);
      }
      if (eligibleCount < k) continue;

      initCombination(combo, k);
      while (true) {
        let coverCount: i32 = 0;
        for (let ci: i32 = 0; ci < k; ci++) {
          const baseIdx = unchecked(eligibleBases[unchecked(combo[ci])]);
          for (let pos: i32 = 0; pos < 9; pos++) {
            const index = unitCellIndex(baseType, baseIdx, pos);
            if (!emptyAt(index) || (maskAt(index) & bit) == 0) continue;
            const coverIdx = baseType == 0 ? index % 9 : index / 9;
            let seen = false;
            for (let j: i32 = 0; j < coverCount; j++) {
              if (unchecked(coverOrder[j]) == coverIdx) { seen = true; break; }
            }
            if (!seen) unchecked(coverOrder[coverCount++] = coverIdx);
          }
        }

        if (coverCount == k) {
          eliminationCount = 0;
          const coverType = baseType == 0 ? 1 : 0;
          for (let ci: i32 = 0; ci < coverCount; ci++) {
            const coverIdx = unchecked(coverOrder[ci]);
            for (let pos: i32 = 0; pos < 9; pos++) {
              const index = unitCellIndex(coverType, coverIdx, pos);
              const baseIdxOfCell = baseType == 0 ? index / 9 : index % 9;
              if (comboContainsValue(eligibleBases, combo, k, baseIdxOfCell)) continue;
              if (emptyAt(index) && (maskAt(index) & bit) != 0) appendElimination(index, d);
            }
          }
          if (eliminationCount > 0) {
            techniqueId = id; actionType = 2; subtype = baseType;
            patternCount = 0;
            let baseMask: i32 = 0;
            let coverMask: i32 = 0;
            for (let ci: i32 = 0; ci < k; ci++) {
              const baseIdx = unchecked(eligibleBases[unchecked(combo[ci])]);
              baseMask |= 1 << baseIdx;
              for (let pos: i32 = 0; pos < 9; pos++) {
                const index = unitCellIndex(baseType, baseIdx, pos);
                if (emptyAt(index) && (maskAt(index) & bit) != 0) appendPattern(index);
              }
            }
            for (let ci: i32 = 0; ci < coverCount; ci++) coverMask |= 1 << unchecked(coverOrder[ci]);
            unchecked(meta[0] = d);
            unchecked(meta[1] = baseType);
            unchecked(meta[2] = baseMask);
            unchecked(meta[3] = coverMask);
            unchecked(meta[4] = k);
            return actionType;
          }
        }
        if (!advanceCombination(combo, eligibleCount, k)) break;
      }
    }
  }
  return 0;
}


@inline
function cellsSee(a: i32, b: i32): bool {
  const ar = a / 9, ac = a % 9;
  const br = b / 9, bc = b % 9;
  return ar == br || ac == bc || boxIndex(ar, ac) == boxIndex(br, bc);
}

function findSkyscraper(): i32 {
  const lineA = new StaticArray<i32>(9);
  const lineB = new StaticArray<i32>(9);

  for (let baseType: i32 = 0; baseType < 2; baseType++) {
    for (let d: i32 = 1; d <= 9; d++) {
      const bit = bitForDigit(d);
      let lineCount: i32 = 0;
      for (let idx: i32 = 0; idx < 9; idx++) {
        let first: i32 = -1, second: i32 = -1, count: i32 = 0;
        for (let pos: i32 = 0; pos < 9; pos++) {
          const index = unitCellIndex(baseType, idx, pos);
          if (!emptyAt(index) || (maskAt(index) & bit) == 0) continue;
          if (count == 0) first = index;
          else if (count == 1) second = index;
          count++;
        }
        if (count == 2) {
          unchecked(lineA[lineCount] = first);
          unchecked(lineB[lineCount] = second);
          lineCount++;
        }
      }
      for (let i: i32 = 0; i < lineCount; i++) {
        for (let j: i32 = i + 1; j < lineCount; j++) {
          const a1 = unchecked(lineA[i]), a2 = unchecked(lineB[i]);
          const b1 = unchecked(lineA[j]), b2 = unchecked(lineB[j]);
          for (let cfg: i32 = 0; cfg < 4; cfg++) {
            const x = cfg < 2 ? a1 : a2;
            const y = (cfg == 0 || cfg == 2) ? b1 : b2;
            const crossX = baseType == 0 ? x % 9 : x / 9;
            const crossY = baseType == 0 ? y % 9 : y / 9;
            if (crossX != crossY) continue;
            const roof1 = x == a1 ? a2 : a1;
            const roof2 = y == b1 ? b2 : b1;
            if (roof1 == roof2) continue;

            eliminationCount = 0;
            for (let index: i32 = 0; index < CELL_COUNT; index++) {
              if (!emptyAt(index) || (maskAt(index) & bit) == 0) continue;
              if (index == roof1 || index == roof2) continue;
              if (cellsSee(index, roof1) && cellsSee(index, roof2)) appendElimination(index, d);
            }
            if (eliminationCount > 0) {
              techniqueId = 12; actionType = 2; subtype = -1; patternCount = 0;
              appendPattern(x); appendPattern(y); appendPattern(roof1); appendPattern(roof2);
              unchecked(meta[0] = d);
              unchecked(meta[1] = baseType);
              return actionType;
            }
          }
        }
      }
    }
  }
  return 0;
}

function findTwoStringKite(): i32 {
  const rowA = new StaticArray<i32>(9), rowB = new StaticArray<i32>(9);
  const colA = new StaticArray<i32>(9), colB = new StaticArray<i32>(9);

  for (let d: i32 = 1; d <= 9; d++) {
    const bit = bitForDigit(d);
    let rowCount: i32 = 0, colCount: i32 = 0;
    for (let i: i32 = 0; i < 9; i++) {
      let a: i32 = -1, b: i32 = -1, count: i32 = 0;
      for (let c: i32 = 0; c < 9; c++) {
        const index = i * 9 + c;
        if (emptyAt(index) && (maskAt(index) & bit) != 0) {
          if (count == 0) a = index; else if (count == 1) b = index; count++;
        }
      }
      if (count == 2) { unchecked(rowA[rowCount] = a); unchecked(rowB[rowCount] = b); rowCount++; }

      a = -1; b = -1; count = 0;
      for (let r: i32 = 0; r < 9; r++) {
        const index = r * 9 + i;
        if (emptyAt(index) && (maskAt(index) & bit) != 0) {
          if (count == 0) a = index; else if (count == 1) b = index; count++;
        }
      }
      if (count == 2) { unchecked(colA[colCount] = a); unchecked(colB[colCount] = b); colCount++; }
    }

    for (let ri: i32 = 0; ri < rowCount; ri++) {
      const r1 = unchecked(rowA[ri]), r2 = unchecked(rowB[ri]);
      for (let ci: i32 = 0; ci < colCount; ci++) {
        const c1 = unchecked(colA[ci]), c2 = unchecked(colB[ci]);
        for (let cfg: i32 = 0; cfg < 4; cfg++) {
          const near1 = cfg < 2 ? r1 : r2;
          const far1 = cfg < 2 ? r2 : r1;
          const near2 = (cfg == 0 || cfg == 2) ? c1 : c2;
          const far2 = (cfg == 0 || cfg == 2) ? c2 : c1;
          if (boxIndex(near1 / 9, near1 % 9) != boxIndex(near2 / 9, near2 % 9)) continue;
          if (near1 == near2 || far1 == far2) continue;

          eliminationCount = 0;
          for (let index: i32 = 0; index < CELL_COUNT; index++) {
            if (!emptyAt(index) || (maskAt(index) & bit) == 0) continue;
            if (index == far1 || index == far2 || index == near1 || index == near2) continue;
            if (cellsSee(index, far1) && cellsSee(index, far2)) appendElimination(index, d);
          }
          if (eliminationCount > 0) {
            techniqueId = 13; actionType = 2; patternCount = 0;
            appendPattern(near1); appendPattern(near2); appendPattern(far1); appendPattern(far2);
            unchecked(meta[0] = d);
            return actionType;
          }
        }
      }
    }
  }
  return 0;
}

function findEmptyRectangle(): i32 {
  const boxCells = new StaticArray<i32>(9);
  for (let d: i32 = 1; d <= 9; d++) {
    const bit = bitForDigit(d);
    for (let box: i32 = 0; box < 9; box++) {
      const br = (box / 3) * 3, bc = (box % 3) * 3;
      let boxCount: i32 = 0;
      for (let rr: i32 = br; rr < br + 3; rr++) {
        for (let cc: i32 = bc; cc < bc + 3; cc++) {
          const index = rr * 9 + cc;
          if (emptyAt(index) && (maskAt(index) & bit) != 0) unchecked(boxCells[boxCount++] = index);
        }
      }
      if (boxCount < 2) continue;

      for (let R: i32 = br; R < br + 3; R++) {
        for (let C: i32 = bc; C < bc + 3; C++) {
          let allCross = true, hasRow = false, hasCol = false;
          for (let i: i32 = 0; i < boxCount; i++) {
            const index = unchecked(boxCells[i]), r = index / 9, c = index % 9;
            if (r != R && c != C) { allCross = false; break; }
            if (r == R) hasRow = true;
            if (c == C) hasCol = true;
          }
          if (!allCross || !hasRow || !hasCol) continue;

          let near: i32 = -1, outsideCount: i32 = 0;
          for (let r: i32 = 0; r < 9; r++) {
            if (r >= br && r < br + 3) continue;
            const index = r * 9 + C;
            if (emptyAt(index) && (maskAt(index) & bit) != 0) { near = index; outsideCount++; }
          }
          if (outsideCount == 1) {
            const row = near / 9;
            let p1: i32 = -1, p2: i32 = -1, count: i32 = 0;
            for (let c: i32 = 0; c < 9; c++) {
              const index = row * 9 + c;
              if (emptyAt(index) && (maskAt(index) & bit) != 0) {
                if (count == 0) p1 = index; else if (count == 1) p2 = index; count++;
              }
            }
            if (count == 2) {
              const far = p1 % 9 == C ? p2 : p1;
              const farC = far % 9;
              if (farC < bc || farC >= bc + 3) {
                const target = R * 9 + farC;
                const inBox = target / 9 >= br && target / 9 < br + 3 && target % 9 >= bc && target % 9 < bc + 3;
                if (emptyAt(target) && (maskAt(target) & bit) != 0 && !inBox) {
                  techniqueId = 14; actionType = 2; patternCount = 0; eliminationCount = 0;
                  for (let i: i32 = 0; i < boxCount; i++) appendPattern(unchecked(boxCells[i]));
                  appendPattern(near); appendPattern(far); appendElimination(target, d);
                  unchecked(meta[0] = d); unchecked(meta[1] = box);
                  unchecked(meta[2] = R); unchecked(meta[3] = C);
                  return actionType;
                }
              }
            }
          }

          near = -1; outsideCount = 0;
          for (let c: i32 = 0; c < 9; c++) {
            if (c >= bc && c < bc + 3) continue;
            const index = R * 9 + c;
            if (emptyAt(index) && (maskAt(index) & bit) != 0) { near = index; outsideCount++; }
          }
          if (outsideCount == 1) {
            const col = near % 9;
            let p1: i32 = -1, p2: i32 = -1, count: i32 = 0;
            for (let r: i32 = 0; r < 9; r++) {
              const index = r * 9 + col;
              if (emptyAt(index) && (maskAt(index) & bit) != 0) {
                if (count == 0) p1 = index; else if (count == 1) p2 = index; count++;
              }
            }
            if (count == 2) {
              const far = p1 / 9 == R ? p2 : p1;
              const farR = far / 9;
              if (farR < br || farR >= br + 3) {
                const target = farR * 9 + C;
                const inBox = target / 9 >= br && target / 9 < br + 3 && target % 9 >= bc && target % 9 < bc + 3;
                if (emptyAt(target) && (maskAt(target) & bit) != 0 && !inBox) {
                  techniqueId = 14; actionType = 2; patternCount = 0; eliminationCount = 0;
                  for (let i: i32 = 0; i < boxCount; i++) appendPattern(unchecked(boxCells[i]));
                  appendPattern(near); appendPattern(far); appendElimination(target, d);
                  unchecked(meta[0] = d); unchecked(meta[1] = box);
                  unchecked(meta[2] = R); unchecked(meta[3] = C);
                  return actionType;
                }
              }
            }
          }
        }
      }
    }
  }
  return 0;
}


function findFinnedFish(k: i32, id: i32): i32 {
  const eligibleBases = new StaticArray<i32>(9);
  const baseCombo = new StaticArray<i32>(9);
  const allPositions = new StaticArray<i32>(81);
  const coverOrder = new StaticArray<i32>(9);
  const coverCombo = new StaticArray<i32>(9);
  const fins = new StaticArray<i32>(81);

  for (let d: i32 = 1; d <= 9; d++) {
    const bit = bitForDigit(d);
    for (let baseType: i32 = 0; baseType < 2; baseType++) {
      let eligibleCount: i32 = 0;
      for (let idx: i32 = 0; idx < 9; idx++) {
        let positions: i32 = 0;
        for (let pos: i32 = 0; pos < 9; pos++) {
          const index = unitCellIndex(baseType, idx, pos);
          if (emptyAt(index) && (maskAt(index) & bit) != 0) positions++;
        }
        if (positions >= 1) unchecked(eligibleBases[eligibleCount++] = idx);
      }
      if (eligibleCount < k) continue;

      initCombination(baseCombo, k);
      while (true) {
        let allCount: i32 = 0;
        let coverCount: i32 = 0;
        let baseMask: i32 = 0;
        for (let bi: i32 = 0; bi < k; bi++) {
          const baseIdx = unchecked(eligibleBases[unchecked(baseCombo[bi])]);
          baseMask |= 1 << baseIdx;
          for (let pos: i32 = 0; pos < 9; pos++) {
            const index = unitCellIndex(baseType, baseIdx, pos);
            if (!emptyAt(index) || (maskAt(index) & bit) == 0) continue;
            unchecked(allPositions[allCount++] = index);
            const coverIdx = baseType == 0 ? index % 9 : index / 9;
            let seen = false;
            for (let i: i32 = 0; i < coverCount; i++) if (unchecked(coverOrder[i]) == coverIdx) { seen = true; break; }
            if (!seen) unchecked(coverOrder[coverCount++] = coverIdx);
          }
        }

        if (coverCount > k) {
          initCombination(coverCombo, k);
          while (true) {
            let finCount: i32 = 0;
            for (let i: i32 = 0; i < allCount; i++) {
              const index = unchecked(allPositions[i]);
              const cross = baseType == 0 ? index % 9 : index / 9;
              let covered = false;
              for (let ci: i32 = 0; ci < k; ci++) {
                if (unchecked(coverOrder[unchecked(coverCombo[ci])]) == cross) { covered = true; break; }
              }
              if (!covered) unchecked(fins[finCount++] = index);
            }

            if (finCount > 0) {
              const finBox = boxIndex(unchecked(fins[0]) / 9, unchecked(fins[0]) % 9);
              let oneBox = true;
              for (let i: i32 = 1; i < finCount; i++) {
                const index = unchecked(fins[i]);
                if (boxIndex(index / 9, index % 9) != finBox) { oneBox = false; break; }
              }

              if (oneBox) {
                eliminationCount = 0;
                const coverType = baseType == 0 ? 1 : 0;
                for (let ci: i32 = 0; ci < k; ci++) {
                  const coverIdx = unchecked(coverOrder[unchecked(coverCombo[ci])]);
                  for (let pos: i32 = 0; pos < 9; pos++) {
                    const index = unitCellIndex(coverType, coverIdx, pos);
                    const baseIdxOfCell = baseType == 0 ? index / 9 : index % 9;
                    if ((baseMask & (1 << baseIdxOfCell)) != 0) continue;
                    let isFin = false;
                    for (let fi: i32 = 0; fi < finCount; fi++) if (unchecked(fins[fi]) == index) { isFin = true; break; }
                    if (isFin || !emptyAt(index) || (maskAt(index) & bit) == 0) continue;
                    let seesAll = true;
                    for (let fi: i32 = 0; fi < finCount; fi++) {
                      if (!cellsSee(index, unchecked(fins[fi]))) { seesAll = false; break; }
                    }
                    if (seesAll) appendElimination(index, d);
                  }
                }

                if (eliminationCount > 0) {
                  techniqueId = id; actionType = 2; subtype = baseType;
                  patternCount = 0; extraCellCount = 0;
                  for (let i: i32 = 0; i < allCount; i++) appendPattern(unchecked(allPositions[i]));
                  for (let i: i32 = 0; i < finCount; i++) unchecked(extraCells[extraCellCount++] = <u8>unchecked(fins[i]));
                  let coverMask: i32 = 0;
                  for (let ci: i32 = 0; ci < k; ci++) coverMask |= 1 << unchecked(coverOrder[unchecked(coverCombo[ci])]);
                  unchecked(meta[0] = d);
                  unchecked(meta[1] = baseType);
                  unchecked(meta[2] = baseMask);
                  unchecked(meta[3] = coverMask);
                  unchecked(meta[4] = k);
                  return actionType;
                }
              }
            }
            if (!advanceCombination(coverCombo, coverCount, k)) break;
          }
        }
        if (!advanceCombination(baseCombo, eligibleCount, k)) break;
      }
    }
  }
  return 0;
}

export function runBasicTechniqueFinder(id: i32): i32 {
  resetResult();
  if (id == 0) return findNakedSingle();
  if (id == 1) return findHiddenSingle();
  if (id == 2) return findLockedCandidate();
  if (id == 4) return findNakedSubset(2, 4);
  if (id == 5) return findHiddenSubset(2, 5);
  if (id == 6) return findNakedSubset(3, 6);
  if (id == 7) return findHiddenSubset(3, 7);
  if (id == 8) return findNakedSubset(4, 8);
  if (id == 9) return findHiddenSubset(4, 9);
  if (id == 10) return findFish(2, 10);
  if (id == 11) return findFish(3, 11);
  if (id == 12) return findSkyscraper();
  if (id == 13) return findTwoStringKite();
  if (id == 14) return findEmptyRectangle();
  if (id == 15) return findFish(4, 15);
  if (id == 16) return findFish(5, 16);
  if (id == 17) return findFinnedFish(2, 17);
  if (id == 18) return findFinnedFish(3, 18);
  if (id == 19) return findFinnedFish(4, 19);
  return 0;
}

export function basicResultActionType(): i32 { return actionType; }
export function basicResultTechniqueId(): i32 { return techniqueId; }
export function basicResultSubtype(): i32 { return subtype; }
export function basicResultR(): i32 { return resultR; }
export function basicResultC(): i32 { return resultC; }
export function basicResultDigit(): i32 { return resultDigit; }
export function basicResultPatternCount(): i32 { return patternCount; }
export function basicResultPatternAt(i: i32): i32 {
  return i >= 0 && i < patternCount ? <i32>unchecked(patternCells[i]) : -1;
}
export function basicResultEliminationCount(): i32 { return eliminationCount; }
export function basicResultEliminationAt(i: i32): i32 {
  return i >= 0 && i < eliminationCount ? <i32>unchecked(eliminations[i]) : -1;
}
export function basicResultMeta(i: i32): i32 {
  return i >= 0 && i < 16 ? unchecked(meta[i]) : 0;
}

export function basicResultExtraCellCount(): i32 { return extraCellCount; }
export function basicResultExtraCellAt(i: i32): i32 {
  return i >= 0 && i < extraCellCount ? <i32>unchecked(extraCells[i]) : -1;
}
