import {
  instantiateCore,
  loadPosition,
  loadGivenGrid,
  runStandaloneTechniqueFinder,
  runStaticNishioFinder,
  runStaticUnaryFinder,
  runStaticMultipleFinder,
  runDynamicNishioFinder,
  runDynamicUnaryFinder,
  runDynamicMultipleFinder,
} from "./sudoku-wasm-adapter.js";

let core = null;

function assertCore() {
  if (!core) throw new Error("WASM worker is not initialized");
  return core;
}

async function handle(message) {
  switch (message.type) {
    case "init": {
      core = await instantiateCore(message.wasm);
      return { type: "ready" };
    }
    case "loadPosition": {
      loadPosition(assertCore(), message.grid, message.masks);
      if (message.givenGrid) loadGivenGrid(core, message.givenGrid);
      return { type: "positionLoaded" };
    }
    case "standalone":
      return {
        type: "result",
        finding: runStandaloneTechniqueFinder(assertCore(), message.techniqueId),
      };
    case "staticNishio":
      return { type: "result", finding: runStaticNishioFinder(assertCore()) };
    case "staticUnary":
      return { type: "result", finding: runStaticUnaryFinder(assertCore()) };
    case "staticMultiple":
      return { type: "result", finding: runStaticMultipleFinder(assertCore()) };
    case "dynamicNishio":
      return {
        type: "result",
        envelope: runDynamicNishioFinder(assertCore(), message.budgetLimit),
      };
    case "dynamicUnary":
      return {
        type: "result",
        envelope: runDynamicUnaryFinder(assertCore(), message.budgetLimit),
      };
    case "dynamicMultiple":
      return {
        type: "result",
        envelope: runDynamicMultipleFinder(assertCore(), message.budgetLimit),
      };
    default:
      throw new Error("Unknown WASM worker message type: " + message.type);
  }
}

self.onmessage = async (event) => {
  const id = event.data && event.data.id;
  try {
    const payload = await handle(event.data || {});
    self.postMessage({ id, ok: true, ...payload });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error && error.stack ? error.stack : String(error),
    });
  }
};
