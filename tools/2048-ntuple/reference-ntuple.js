'use strict';

// Deliberately independent, allocation-heavy array reference for test use only.
// No production move, symmetry, packed-index, or evaluation helpers are imported.
const PATTERNS = Object.freeze([
  Object.freeze([0, 1, 2, 3, 4, 5]),
  Object.freeze([4, 5, 6, 7, 8, 9]),
  Object.freeze([0, 1, 2, 4, 5, 6]),
  Object.freeze([4, 5, 6, 8, 9, 10])
]);

function rotateClockwise(board) {
  const result = new Array(16);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      result[col * 4 + (3 - row)] = board[row * 4 + col];
    }
  }
  return result;
}

function rotate(board, count) {
  let result = Array.from(board);
  for (let i = 0; i < count; i++) result = rotateClockwise(result);
  return result;
}

function reflectLeftRight(board) {
  const result = [];
  for (let row = 0; row < 4; row++) {
    result.push(...Array.from(board).slice(row * 4, row * 4 + 4).reverse());
  }
  return result;
}

function symmetries(board) {
  const result = [];
  for (const reflected of [false, true]) {
    let transformed = reflected ? reflectLeftRight(board) : Array.from(board);
    for (let rotation = 0; rotation < 4; rotation++) {
      result.push(transformed);
      transformed = rotateClockwise(transformed);
    }
  }
  return result;
}

function rankIndex(ranks, pattern) {
  let result = 0;
  let place = 1;
  for (const cell of pattern) {
    result += ranks[cell] * place;
    place *= 16;
  }
  return result;
}

function indices(board, patterns = PATTERNS) {
  const ranks = Array.from(board, tile => tile === 0 ? 0 : Math.log2(tile));
  const transformed = symmetries(ranks);
  return patterns.map(pattern => {
    const cells = typeof pattern === 'string' ? Array.from(pattern, digit => parseInt(digit, 16)) : pattern;
    return transformed.map(r => rankIndex(r, cells));
  });
}

function evaluate(board, tables, patterns = PATTERNS) {
  let sum = 0;
  const allIndices = indices(board, patterns);
  for (let table = 0; table < patterns.length; table++) {
    for (const index of allIndices[table]) sum += tables[table][index];
  }
  return sum;
}

function move(board, direction) {
  const rotations = [3, 2, 1, 0][direction];
  const aligned = rotate(board, rotations);
  const shifted = [];
  let score = 0;
  for (let row = 0; row < 4; row++) {
    const nonzero = aligned.slice(row * 4, row * 4 + 4).filter(value => value !== 0);
    const output = [];
    while (nonzero.length) {
      let value = nonzero.shift();
      if (nonzero[0] === value) {
        nonzero.shift();
        value *= 2;
        score += value;
      }
      output.push(value);
    }
    while (output.length < 4) output.push(0);
    shifted.push(...output);
  }
  const result = rotate(shifted, (4 - rotations) % 4);
  return {board: result, score, moved: result.some((value, index) => value !== board[index])};
}

// Source policy at TDL2048+ a99f620: the inner search uses a nonnegative
// value floor and +1 survival bonus. A dead child contributes exactly zero.
// Remaining is the number of additional player moves after this afterstate.
function evaluateAfter(board, tables, remaining = 0, patterns = PATTERNS, target = 32768) {
  if (remaining === 0 || board.some(tile => tile >= target)) return evaluate(board, tables, patterns);
  const empty = [];
  for (let cell = 0; cell < 16; cell++) if (board[cell] === 0) empty.push(cell);
  if (!empty.length) throw new Error('Reference search expected an afterstate spawn cell.');
  let expectation = 0;
  for (const cell of empty) {
    for (const [tile, probability] of [[2, 0.9], [4, 0.1]]) {
      const spawned = board.slice();
      spawned[cell] = tile;
      expectation += probability * innerBest(spawned, tables, patterns, remaining - 1, target);
    }
  }
  return expectation / empty.length;
}

function innerBest(board, tables, patterns = PATTERNS, remaining = 0, target = 32768) {
  let best = 0;
  for (let direction = 0; direction < 4; direction++) {
    const after = move(board, direction);
    if (after.moved) {
      const estimate = evaluateAfter(after.board, tables, remaining, patterns, target);
      best = Math.max(best, after.score + Math.max(estimate, 0) + 1);
    }
  }
  return best;
}

function actionValues(board, tables, ply = 1, patterns = PATTERNS, target = 32768) {
  const values = [null, null, null, null];
  for (let direction = 0; direction < 4; direction++) {
    const after = move(board, direction);
    if (!after.moved) continue;
    values[direction] = after.score + evaluateAfter(after.board, tables, ply - 1, patterns, target);
  }
  return values;
}

function chooseMove(board, tables, ply = 1, patterns = PATTERNS, target = 32768) {
  const values = actionValues(board, tables, ply, patterns, target);
  let direction = null;
  let value = -Infinity;
  for (let d = 0; d < 4; d++) {
    if (values[d] !== null && values[d] > value) {
      direction = d;
      value = values[d];
    }
  }
  return {direction, value: direction === null ? 0 : value, values};
}

function leafBoards(board, ply = 2) {
  const leaves = [];
  for (let direction = 0; direction < 4; direction++) {
    const after = move(board, direction);
    if (!after.moved) continue;
    leaves.push(after.board);
    if (ply === 1) continue;
    for (let cell = 0; cell < 16; cell++) {
      if (after.board[cell] !== 0) continue;
      for (const tile of [2, 4]) {
        const spawned = after.board.slice();
        spawned[cell] = tile;
        for (let nextDirection = 0; nextDirection < 4; nextDirection++) {
          const next = move(spawned, nextDirection);
          if (next.moved) leaves.push(next.board);
        }
      }
    }
  }
  return leaves;
}

module.exports = {PATTERNS, rotate, reflectLeftRight, symmetries, rankIndex, indices, evaluate, move, evaluateAfter, innerBest, actionValues, chooseMove, leafBoards};
