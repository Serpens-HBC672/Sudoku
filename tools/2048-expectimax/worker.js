/* Optional classic Web Worker: run via an HTTP(S) server, not file://. */
'use strict';
importScripts('./expectimax2048.js');
let solver = new Expectimax2048.Solver();
self.onmessage = function (event) {
  const request = event.data || {};
  try {
    if (request.type === 'configure') {
      solver = new Expectimax2048.Solver(request.options || {});
      self.postMessage({type: 'configured', id: request.id, options: solver.options});
    } else if (request.type === 'solve') {
      self.postMessage({type: 'result', id: request.id, result: solver.chooseMove(request.board)});
    } else throw new Error('Message type must be configure or solve.');
  } catch (error) {
    self.postMessage({type: 'error', id: request.id, error: String(error.message || error)});
  }
};
