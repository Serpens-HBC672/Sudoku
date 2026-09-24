// Exact standalone discovery ports for the frozen human-technique oracle.
// Candidate masks are authoritative u16 values restricted to bits 0..8.

const CELL_COUNT: i32 = 81;
const FACT_COUNT: i32 = 729;
const ALL_DIGITS: u16 = 0x01ff;

const inputGrid = new StaticArray<u8>(CELL_COUNT);
const givenGrid = new StaticArray<u8>(CELL_COUNT);
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
const extraDigits = new StaticArray<u8>(CELL_COUNT);
let extraDigitCount: i32 = 0;
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
  extraDigitCount = 0;
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
    unchecked(givenGrid[i] = 0);
    unchecked(inputMasks[i] = 0);
  }
}

export function basicSetGivenCell(index: i32, digit: i32): void {
  if (index >= 0 && index < CELL_COUNT) unchecked(givenGrid[index] = <u8>digit);
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


function rectangleBoxesAreTwo(c0: i32, c1: i32, c2: i32, c3: i32): bool {
  const b0 = boxIndex(c0 / 9, c0 % 9);
  const b1 = boxIndex(c1 / 9, c1 % 9);
  const b2 = boxIndex(c2 / 9, c2 % 9);
  const b3 = boxIndex(c3 / 9, c3 % 9);
  let count: i32 = 1;
  let second: i32 = -1;
  if (b1 != b0) { second = b1; count++; }
  if (b2 != b0 && b2 != second) { if (count == 2) return false; second = b2; count++; }
  if (b3 != b0 && b3 != second) return false;
  return count == 2;
}

function findUniqueRectangleType1(): i32 {
  const corners = new StaticArray<i32>(4);
  const masks = new StaticArray<u16>(4);
  for (let r1: i32 = 0; r1 < 8; r1++) for (let r2: i32 = r1 + 1; r2 < 9; r2++) {
    for (let c1: i32 = 0; c1 < 8; c1++) for (let c2: i32 = c1 + 1; c2 < 9; c2++) {
      unchecked(corners[0] = r1 * 9 + c1);
      unchecked(corners[1] = r1 * 9 + c2);
      unchecked(corners[2] = r2 * 9 + c1);
      unchecked(corners[3] = r2 * 9 + c2);
      if (!rectangleBoxesAreTwo(unchecked(corners[0]), unchecked(corners[1]), unchecked(corners[2]), unchecked(corners[3]))) continue;
      let allEmpty = true;
      for (let i: i32 = 0; i < 4; i++) {
        const index = unchecked(corners[i]);
        if (!emptyAt(index)) { allEmpty = false; break; }
        unchecked(masks[i] = maskAt(index));
      }
      if (!allEmpty) continue;
      for (let x: i32 = 1; x <= 8; x++) for (let y: i32 = x + 1; y <= 9; y++) {
        const xy = <u16>(bitForDigit(x) | bitForDigit(y));
        let allContain = true, pureCount: i32 = 0, extraIdx: i32 = -1;
        for (let i: i32 = 0; i < 4; i++) {
          const m = unchecked(masks[i]);
          if ((m & xy) != xy) { allContain = false; break; }
          if (countBits9(m) == 2) pureCount++; else extraIdx = i;
        }
        if (!allContain || pureCount != 3) continue;
        const extra = unchecked(corners[extraIdx]);
        eliminationCount = 0;
        const em = <u16>(unchecked(masks[extraIdx]) & xy);
        for (let d: i32 = 1; d <= 9; d++) if ((em & bitForDigit(d)) != 0) appendElimination(extra, d);
        if (eliminationCount > 0) {
          techniqueId = 20; actionType = 2; patternCount = 0;
          for (let i: i32 = 0; i < 4; i++) appendPattern(unchecked(corners[i]));
          unchecked(meta[0] = <i32>xy); unchecked(meta[1] = extraIdx);
          return actionType;
        }
      }
    }
  }
  return 0;
}

function findUniqueRectangleType2(): i32 {
  const corners = new StaticArray<i32>(4);
  const masks = new StaticArray<u16>(4);
  const pure = new StaticArray<i32>(4);
  for (let r1: i32 = 0; r1 < 8; r1++) for (let r2: i32 = r1 + 1; r2 < 9; r2++) {
    for (let c1: i32 = 0; c1 < 8; c1++) for (let c2: i32 = c1 + 1; c2 < 9; c2++) {
      unchecked(corners[0] = r1 * 9 + c1); unchecked(corners[1] = r1 * 9 + c2);
      unchecked(corners[2] = r2 * 9 + c1); unchecked(corners[3] = r2 * 9 + c2);
      if (!rectangleBoxesAreTwo(unchecked(corners[0]), unchecked(corners[1]), unchecked(corners[2]), unchecked(corners[3]))) continue;
      let allEmpty = true;
      for (let i: i32 = 0; i < 4; i++) {
        const index = unchecked(corners[i]);
        if (!emptyAt(index)) { allEmpty = false; break; }
        unchecked(masks[i] = maskAt(index));
      }
      if (!allEmpty) continue;
      for (let x: i32 = 1; x <= 8; x++) for (let y: i32 = x + 1; y <= 9; y++) {
        const xy = <u16>(bitForDigit(x) | bitForDigit(y));
        let allContain = true, pureCount: i32 = 0;
        for (let i: i32 = 0; i < 4; i++) {
          const m = unchecked(masks[i]);
          if ((m & xy) != xy) { allContain = false; break; }
          if (countBits9(m) == 2) unchecked(pure[pureCount++] = i);
        }
        if (!allContain || pureCount != 2) continue;
        const p1 = unchecked(pure[0]), p2 = unchecked(pure[1]);
        const cp1 = unchecked(corners[p1]), cp2 = unchecked(corners[p2]);
        if (cp1 / 9 != cp2 / 9 && cp1 % 9 != cp2 % 9) continue;
        let q1: i32 = -1, q2: i32 = -1;
        for (let i: i32 = 0; i < 4; i++) {
          if (i == p1 || i == p2) continue;
          if (q1 < 0) q1 = i; else q2 = i;
        }
        if (countBits9(unchecked(masks[q1])) != 3 || countBits9(unchecked(masks[q2])) != 3) continue;
        const e1 = <u16>(unchecked(masks[q1]) & <u16>(~xy));
        const e2 = <u16>(unchecked(masks[q2]) & <u16>(~xy));
        if (e1 != e2 || countBits9(e1) != 1) continue;
        const z = singletonDigit(e1);
        const roof1 = unchecked(corners[q1]), roof2 = unchecked(corners[q2]);
        eliminationCount = 0;
        const zBit = bitForDigit(z);
        for (let index: i32 = 0; index < CELL_COUNT; index++) {
          if (!emptyAt(index) || (maskAt(index) & zBit) == 0) continue;
          if (index == roof1 || index == roof2) continue;
          if (cellsSee(index, roof1) && cellsSee(index, roof2)) appendElimination(index, z);
        }
        if (eliminationCount > 0) {
          techniqueId = 21; actionType = 2; patternCount = 0; extraCellCount = 0;
          for (let i: i32 = 0; i < 4; i++) appendPattern(unchecked(corners[i]));
          unchecked(extraCells[extraCellCount++] = <u8>roof1);
          unchecked(extraCells[extraCellCount++] = <u8>roof2);
          unchecked(meta[0] = <i32>xy); unchecked(meta[1] = z);
          return actionType;
        }
      }
    }
  }
  return 0;
}

function findHiddenUniqueRectangle(): i32 {
  const corners = new StaticArray<i32>(4);
  const masks = new StaticArray<u16>(4);
  const diag = new StaticArray<i32>(4); unchecked(diag[0]=3); unchecked(diag[1]=2); unchecked(diag[2]=1); unchecked(diag[3]=0);
  const rowPartner = new StaticArray<i32>(4); unchecked(rowPartner[0]=1); unchecked(rowPartner[1]=0); unchecked(rowPartner[2]=3); unchecked(rowPartner[3]=2);
  const colPartner = new StaticArray<i32>(4); unchecked(colPartner[0]=2); unchecked(colPartner[1]=3); unchecked(colPartner[2]=0); unchecked(colPartner[3]=1);
  for (let r1: i32 = 0; r1 < 8; r1++) for (let r2: i32 = r1 + 1; r2 < 9; r2++) {
    for (let c1: i32 = 0; c1 < 8; c1++) for (let c2: i32 = c1 + 1; c2 < 9; c2++) {
      unchecked(corners[0] = r1*9+c1); unchecked(corners[1] = r1*9+c2);
      unchecked(corners[2] = r2*9+c1); unchecked(corners[3] = r2*9+c2);
      if (!rectangleBoxesAreTwo(unchecked(corners[0]), unchecked(corners[1]), unchecked(corners[2]), unchecked(corners[3]))) continue;
      let allEmpty = true;
      for (let i:i32=0;i<4;i++){ const index=unchecked(corners[i]); if(!emptyAt(index)){allEmpty=false;break;} unchecked(masks[i]=maskAt(index)); }
      if(!allEmpty) continue;
      for (let floorIdx:i32=0; floorIdx<4; floorIdx++) {
        const fm=unchecked(masks[floorIdx]);
        if(countBits9(fm)!=2) continue;
        let x:i32=0,y:i32=0;
        for(let d:i32=1;d<=9;d++) if((fm&bitForDigit(d))!=0){ if(x==0)x=d; else y=d; }
        const xy=<u16>(bitForDigit(x)|bitForDigit(y));
        let allContain=true;
        for(let i:i32=0;i<4;i++) if((unchecked(masks[i])&xy)!=xy){allContain=false;break;}
        if(!allContain) continue;
        const targetIdx=unchecked(diag[floorIdx]);
        const target=unchecked(corners[targetIdx]);
        const rp=unchecked(corners[unchecked(rowPartner[targetIdx])]);
        const cp=unchecked(corners[unchecked(colPartner[targetIdx])]);
        for(let pass:i32=0;pass<2;pass++){
          const testDigit=pass==0?x:y, otherDigit=testDigit==x?y:x;
          if((unchecked(masks[targetIdx])&bitForDigit(otherDigit))==0) continue;
          const bit=bitForDigit(testDigit);
          let rowCount:i32=0,rowHasPartner=false;
          for(let pos:i32=0;pos<9;pos++){const index=unitCellIndex(0,target/9,pos);if(emptyAt(index)&&(maskAt(index)&bit)!=0){rowCount++;if(index==rp)rowHasPartner=true;}}
          if(rowCount!=2||!rowHasPartner) continue;
          let colCount:i32=0,colHasPartner=false;
          for(let pos:i32=0;pos<9;pos++){const index=unitCellIndex(1,target%9,pos);if(emptyAt(index)&&(maskAt(index)&bit)!=0){colCount++;if(index==cp)colHasPartner=true;}}
          if(colCount!=2||!colHasPartner) continue;
          techniqueId=22;actionType=2;patternCount=0;eliminationCount=0;
          for(let i:i32=0;i<4;i++)appendPattern(unchecked(corners[i]));
          appendElimination(target,otherDigit);
          unchecked(meta[0]=<i32>xy);unchecked(meta[1]=floorIdx);unchecked(meta[2]=targetIdx);unchecked(meta[3]=testDigit);
          return actionType;
        }
      }
    }
  }
  return 0;
}

function findBugPlusOne(): i32 {
  let triple: i32 = -1;
  for(let index:i32=0;index<CELL_COUNT;index++){
    if(!emptyAt(index)) continue;
    const n=countBits9(maskAt(index));
    if(n==2) continue;
    if(n==3 && triple<0){triple=index;continue;}
    return 0;
  }
  if(triple<0) return 0;
  const tripleMask=maskAt(triple);
  const r0=triple/9,c0=triple%9,b0=boxIndex(r0,c0);
  for(let d:i32=1;d<=9;d++){
    const bit=bitForDigit(d);if((tripleMask&bit)==0)continue;
    let rowCount:i32=0,colCount:i32=0,boxCount:i32=0;
    for(let pos:i32=0;pos<9;pos++){
      let index=unitCellIndex(0,r0,pos);if(emptyAt(index)&&(maskAt(index)&bit)!=0)rowCount++;
      index=unitCellIndex(1,c0,pos);if(emptyAt(index)&&(maskAt(index)&bit)!=0)colCount++;
      index=unitCellIndex(2,b0,pos);if(emptyAt(index)&&(maskAt(index)&bit)!=0)boxCount++;
    }
    let unitType:i32=-1,idx:i32=-1;
    if((rowCount&1)==1){unitType=0;idx=r0;}else if((colCount&1)==1){unitType=1;idx=c0;}else if((boxCount&1)==1){unitType=2;idx=b0;}
    if(unitType>=0){
      techniqueId=23;actionType=1;resultR=r0;resultC=c0;resultDigit=d;
      unchecked(meta[0]=<i32>tripleMask);unchecked(meta[1]=unitType);unchecked(meta[2]=idx);
      return actionType;
    }
  }
  return 0;
}

function findWing(hingeSize:i32,outlierCount:i32,id:i32):i32{
  const candidates=new StaticArray<i32>(81);
  const others=new StaticArray<i32>(81);
  const combo=new StaticArray<i32>(4);
  for(let hinge:i32=0;hinge<CELL_COUNT;hinge++){
    if(!emptyAt(hinge))continue;
    const hm=maskAt(hinge);if(countBits9(hm)!=hingeSize)continue;
    for(let z:i32=1;z<=9;z++){
      const zBit=bitForDigit(z);if((hm&zBit)==0)continue;
      const otherMask=<u16>(hm&<u16>(~zBit));
      let count:i32=0;
      for(let index:i32=0;index<CELL_COUNT;index++){
        if(index==hinge||!emptyAt(index)||!cellsSee(index,hinge))continue;
        const m=maskAt(index);if(countBits9(m)!=2||(m&zBit)==0)continue;
        const ob=<u16>(m&<u16>(~zBit));if((otherMask&ob)==0)continue;
        unchecked(candidates[count]=index);unchecked(others[count]=singletonDigit(ob));count++;
      }
      if(count<outlierCount)continue;
      initCombination(combo,outlierCount);
      while(true){
        let covered:i32=0;
        for(let ci:i32=0;ci<outlierCount;ci++)covered|=1<<(unchecked(others[unchecked(combo[ci])])-1);
        if(countBits9(<u16>covered)==outlierCount){
          patternCount=0;appendPattern(hinge);
          for(let ci:i32=0;ci<outlierCount;ci++)appendPattern(unchecked(candidates[unchecked(combo[ci])]));
          eliminationCount=0;
          for(let index:i32=0;index<CELL_COUNT;index++){
            if(!emptyAt(index)||(maskAt(index)&zBit)==0)continue;
            let isPattern=false;for(let pi:i32=0;pi<patternCount;pi++)if(<i32>unchecked(patternCells[pi])==index){isPattern=true;break;}
            if(isPattern)continue;
            let seesAll=true;for(let pi:i32=0;pi<patternCount;pi++)if(!cellsSee(index,<i32>unchecked(patternCells[pi]))){seesAll=false;break;}
            if(seesAll)appendElimination(index,z);
          }
          if(eliminationCount>0){
            techniqueId=id;actionType=2;unchecked(meta[0]=z);unchecked(meta[1]=<i32>hm);return actionType;
          }
        }
        if(!advanceCombination(combo,count,outlierCount))break;
      }
    }
  }
  return 0;
}

function findWWing():i32{
  const cells=new StaticArray<i32>(81);const masks=new StaticArray<u16>(81);let count:i32=0;
  for(let index:i32=0;index<CELL_COUNT;index++)if(emptyAt(index)&&countBits9(maskAt(index))==2){unchecked(cells[count]=index);unchecked(masks[count]=maskAt(index));count++;}
  for(let i:i32=0;i<count;i++)for(let j:i32=i+1;j<count;j++){
    const A=unchecked(cells[i]),B=unchecked(cells[j]);const m=unchecked(masks[i]);
    if(m!=unchecked(masks[j])||cellsSee(A,B))continue;
    let x:i32=0,y:i32=0;for(let d:i32=1;d<=9;d++)if((m&bitForDigit(d))!=0){if(x==0)x=d;else y=d;}
    for(let pass:i32=0;pass<2;pass++){
      const strong=pass==0?x:y,elim=pass==0?y:x,strongBit=bitForDigit(strong),elimBit=bitForDigit(elim);
      for(let unitType:i32=0;unitType<3;unitType++)for(let idx:i32=0;idx<9;idx++){
        let p:i32=-1,q:i32=-1,n:i32=0;
        for(let pos:i32=0;pos<9;pos++){const index=unitCellIndex(unitType,idx,pos);if(emptyAt(index)&&(maskAt(index)&strongBit)!=0){if(n==0)p=index;else if(n==1)q=index;n++;}}
        if(n!=2||p==A||p==B||q==A||q==B)continue;
        const config1=cellsSee(p,A)&&cellsSee(q,B),config2=cellsSee(p,B)&&cellsSee(q,A);if(!config1&&!config2)continue;
        eliminationCount=0;
        for(let index:i32=0;index<CELL_COUNT;index++){
          if(!emptyAt(index)||index==A||index==B||(maskAt(index)&elimBit)==0)continue;
          if(cellsSee(index,A)&&cellsSee(index,B))appendElimination(index,elim);
        }
        if(eliminationCount>0){
          techniqueId=25;actionType=2;patternCount=0;appendPattern(A);appendPattern(B);appendPattern(p);appendPattern(q);
          unchecked(meta[0]=strong);unchecked(meta[1]=elim);unchecked(meta[2]=unitType);unchecked(meta[3]=idx);return actionType;
        }
      }
    }
  }
  return 0;
}


function xyPathContains(path: StaticArray<i32>, pathCount: i32, index: i32): bool {
  for (let i:i32=0;i<pathCount;i++) if(unchecked(path[i])==index) return true;
  return false;
}

function xyDfs(
  start:i32, z:i32, current:i32, neededDigit:i32, depth:i32,
  cells:StaticArray<i32>, masks:StaticArray<u16>, cellCount:i32,
  visited:StaticArray<u8>, path:StaticArray<i32>, links:StaticArray<i32>,
  pathCount:i32, linkCount:i32
): bool {
  if(depth>10) return false;
  const neededBit=bitForDigit(neededDigit);
  for(let ni:i32=0;ni<cellCount;ni++){
    const next=unchecked(cells[ni]);
    if(unchecked(visited[next])!=0)continue;
    const nextMask=unchecked(masks[ni]);
    if((nextMask&neededBit)==0||!cellsSee(current,next))continue;
    const nextOther=singletonDigit(<u16>(nextMask&<u16>(~neededBit)));

    if(nextOther==z){
      eliminationCount=0;
      const zBit=bitForDigit(z);
      for(let index:i32=0;index<CELL_COUNT;index++){
        if(!emptyAt(index)||(maskAt(index)&zBit)==0)continue;
        if(index==next||xyPathContains(path,pathCount,index))continue;
        if(cellsSee(index,start)&&cellsSee(index,next))appendElimination(index,z);
      }
      if(eliminationCount>0){
        techniqueId=27;actionType=2;patternCount=0;extraDigitCount=0;
        for(let i:i32=0;i<pathCount;i++)appendPattern(unchecked(path[i]));
        appendPattern(next);
        for(let i:i32=0;i<linkCount;i++)unchecked(extraDigits[extraDigitCount++]=<u8>unchecked(links[i]));
        unchecked(extraDigits[extraDigitCount++]=<u8>neededDigit);
        unchecked(meta[0]=z);
        return true;
      }
    }

    unchecked(visited[next]=1);
    unchecked(path[pathCount]=next);
    unchecked(links[linkCount]=neededDigit);
    if(xyDfs(start,z,next,nextOther,depth+1,cells,masks,cellCount,visited,path,links,pathCount+1,linkCount+1))return true;
    unchecked(visited[next]=0);
  }
  return false;
}

function findXYChain():i32{
  const cells=new StaticArray<i32>(81),masks=new StaticArray<u16>(81);let count:i32=0;
  for(let index:i32=0;index<CELL_COUNT;index++){
    if(emptyAt(index)&&countBits9(maskAt(index))==2){unchecked(cells[count]=index);unchecked(masks[count]=maskAt(index));count++;}
  }
  if(count<3)return 0;
  const visited=new StaticArray<u8>(81),path=new StaticArray<i32>(12),links=new StaticArray<i32>(11);
  for(let si:i32=0;si<count;si++){
    const start=unchecked(cells[si]),sm=unchecked(masks[si]);
    for(let z:i32=1;z<=9;z++){
      const zBit=bitForDigit(z);if((sm&zBit)==0)continue;
      const other=singletonDigit(<u16>(sm&<u16>(~zBit)));
      for(let i:i32=0;i<81;i++)unchecked(visited[i]=0);
      unchecked(visited[start]=1);unchecked(path[0]=start);
      if(xyDfs(start,z,start,other,1,cells,masks,count,visited,path,links,1,0))return actionType;
    }
  }
  return 0;
}


@inline
function gspMirrorIndex(symmetry: i32, index: i32): i32 {
  const r = index / 9, c = index % 9;
  if (symmetry == 0) return (8 - r) * 9 + (8 - c);
  if (symmetry == 1) return c * 9 + r;
  return (8 - c) * 9 + (8 - r);
}

function findGsp(): i32 {
  const perm = new StaticArray<i32>(10);
  for (let symmetry: i32 = 0; symmetry < 3; symmetry++) {
    for (let i: i32 = 0; i < 10; i++) unchecked(perm[i] = 0);
    let ok = true;
    let anyMapped = false;

    for (let index: i32 = 0; index < CELL_COUNT; index++) {
      const v = <i32>unchecked(givenGrid[index]);
      const mirror = gspMirrorIndex(symmetry, index);
      const mv = <i32>unchecked(givenGrid[mirror]);
      if ((v != 0) != (mv != 0)) { ok = false; break; }
      if (v == 0) continue;
      const previous = unchecked(perm[v]);
      if (previous != 0 && previous != mv) { ok = false; break; }
      unchecked(perm[v] = mv);
      anyMapped = true;
    }
    if (!ok || !anyMapped) continue;
    for (let d: i32 = 1; d <= 9; d++) {
      const p = unchecked(perm[d]);
      if (p != 0 && unchecked(perm[p]) != d) { ok = false; break; }
    }
    if (!ok) continue;

    let selfMask: u16 = 0;
    for (let d: i32 = 1; d <= 9; d++) {
      const p = unchecked(perm[d]);
      if (p == 0 || p == d) selfMask = <u16>(selfMask | bitForDigit(d));
    }

    // (a) filled mirror -> fill current, row-major.
    for (let index: i32 = 0; index < CELL_COUNT; index++) {
      if (!emptyAt(index)) continue;
      const mirror = gspMirrorIndex(symmetry, index);
      const mv = <i32>unchecked(inputGrid[mirror]);
      if (mv == 0) continue;
      const digit = unchecked(perm[mv]);
      if (digit == 0 || (maskAt(index) & bitForDigit(digit)) == 0) continue;
      techniqueId = 3; actionType = 1;
      resultR = index / 9; resultC = index % 9; resultDigit = digit;
      unchecked(meta[0] = symmetry);
      unchecked(meta[1] = mirror);
      unchecked(meta[2] = mv);
      unchecked(meta[3] = 0); // fill
      return actionType;
    }

    // (b) symmetry-axis cells may only contain self-paired digits.
    eliminationCount = 0;
    for (let index: i32 = 0; index < CELL_COUNT; index++) {
      if (!emptyAt(index) || gspMirrorIndex(symmetry, index) != index) continue;
      const remove = <u16>(maskAt(index) & <u16>(~selfMask));
      for (let d: i32 = 1; d <= 9; d++) if ((remove & bitForDigit(d)) != 0) appendElimination(index, d);
    }
    if (eliminationCount > 0) {
      techniqueId = 3; actionType = 2; patternCount = 0;
      unchecked(meta[0] = symmetry); unchecked(meta[3] = 1); // axis
      return actionType;
    }

    // (c) mirror-candidate consistency, accumulating every violation.
    eliminationCount = 0;
    for (let index: i32 = 0; index < CELL_COUNT; index++) {
      if (!emptyAt(index)) continue;
      const mirror = gspMirrorIndex(symmetry, index);
      if (mirror == index) continue;
      const mirrorValue = <i32>unchecked(inputGrid[mirror]);
      const mirrorMask = mirrorValue != 0 ? bitForDigit(mirrorValue) : maskAt(mirror);
      const m = maskAt(index);
      for (let d: i32 = 1; d <= 9; d++) {
        const p = unchecked(perm[d]);
        if ((m & bitForDigit(d)) == 0 || p == 0) continue;
        if ((mirrorMask & bitForDigit(p)) == 0) appendElimination(index, d);
      }
    }
    if (eliminationCount > 0) {
      techniqueId = 3; actionType = 2; patternCount = 0;
      unchecked(meta[0] = symmetry); unchecked(meta[3] = 2); // mirror
      return actionType;
    }
  }
  return 0;
}


const pomRows = new StaticArray<i32>(9);
const pomRowMasks = new StaticArray<i32>(9);
const pomChosen = new StaticArray<i32>(9);
const pomCellCount = new StaticArray<i32>(81);
let pomRowCount:i32=0;
let pomPatternCount:i32=0;
let pomSteps:i32=0;
let pomBudgetExceeded:bool=false;

function pomBacktrack(idx:i32, usedCols:i32, usedBoxes:i32):void{
  if(pomBudgetExceeded)return;
  pomSteps++;
  if(pomSteps>300000){pomBudgetExceeded=true;return;}
  if(idx==pomRowCount){
    pomPatternCount++;
    for(let i:i32=0;i<pomRowCount;i++){
      const r=unchecked(pomRows[i]), c=unchecked(pomChosen[i]);
      const index=r*9+c;
      unchecked(pomCellCount[index]=unchecked(pomCellCount[index])+1);
    }
    return;
  }
  const r=unchecked(pomRows[idx]);
  const avail=unchecked(pomRowMasks[r])&~usedCols;
  for(let c:i32=0;c<9;c++){
    const cBit=1<<c;if((avail&cBit)==0)continue;
    const bBit=1<<boxIndex(r,c);if((usedBoxes&bBit)!=0)continue;
    unchecked(pomChosen[idx]=c);
    pomBacktrack(idx+1,usedCols|cBit,usedBoxes|bBit);
    if(pomPatternCount>=4000||pomBudgetExceeded)return;
  }
}

function findPom():i32{
  for(let digit:i32=1;digit<=9;digit++){
    const bit=bitForDigit(digit);
    pomRowCount=0;pomPatternCount=0;pomSteps=0;pomBudgetExceeded=false;
    for(let i:i32=0;i<81;i++)unchecked(pomCellCount[i]=0);
    for(let r:i32=0;r<9;r++){
      let already=false,colMask:i32=0;
      for(let c:i32=0;c<9;c++){
        const index=r*9+c;
        if(<i32>unchecked(inputGrid[index])==digit){already=true;break;}
        if(emptyAt(index)&&(maskAt(index)&bit)!=0)colMask|=1<<c;
      }
      if(already)continue;
      if(colMask==0){pomRowCount=0;break;}
      unchecked(pomRows[pomRowCount++]=r);
      unchecked(pomRowMasks[r]=colMask);
    }
    if(pomRowCount==0)continue;
    pomBacktrack(0,0,0);
    if(pomBudgetExceeded||pomPatternCount==0)continue;

    patternCount=0;
    for(let index:i32=0;index<CELL_COUNT;index++){
      if(emptyAt(index)&&(maskAt(index)&bit)!=0)appendPattern(index);
    }

    extraCellCount=0;
    for(let pi:i32=0;pi<patternCount;pi++){
      const index=<i32>unchecked(patternCells[pi]);
      if(unchecked(pomCellCount[index])==pomPatternCount)unchecked(extraCells[extraCellCount++]=<u8>index);
    }
    if(extraCellCount>0){
      const index=<i32>unchecked(extraCells[0]);
      techniqueId=35;actionType=1;resultR=index/9;resultC=index%9;resultDigit=digit;
      unchecked(meta[0]=digit);unchecked(meta[1]=pomPatternCount);unchecked(meta[2]=0);
      return actionType;
    }

    eliminationCount=0;
    for(let pi:i32=0;pi<patternCount;pi++){
      const index=<i32>unchecked(patternCells[pi]);
      if(unchecked(pomCellCount[index])==0)appendElimination(index,digit);
    }
    if(eliminationCount>0){
      techniqueId=35;actionType=2;
      unchecked(meta[0]=digit);unchecked(meta[1]=pomPatternCount);unchecked(meta[2]=1);
      return actionType;
    }
  }
  return 0;
}

export function runBasicTechniqueFinder(id: i32): i32 {
  resetResult();
  if (id == 0) return findNakedSingle();
  if (id == 1) return findHiddenSingle();
  if (id == 2) return findLockedCandidate();
  if (id == 3) return findGsp();
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
  if (id == 20) return findUniqueRectangleType1();
  if (id == 21) return findUniqueRectangleType2();
  if (id == 22) return findHiddenUniqueRectangle();
  if (id == 23) return findBugPlusOne();
  if (id == 24) return findWing(3, 2, 24);
  if (id == 25) return findWWing();
  if (id == 26) return findWing(4, 3, 26);
  if (id == 27) return findXYChain();
  if (id == 35) return findPom();
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

export function basicResultExtraDigitCount(): i32 { return extraDigitCount; }
export function basicResultExtraDigitAt(i: i32): i32 {
  return i >= 0 && i < extraDigitCount ? <i32>unchecked(extraDigits[i]) : -1;
}
