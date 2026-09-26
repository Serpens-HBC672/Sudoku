import { parentPort } from "node:worker_threads";
import {
  instantiateCore,
  loadPosition,
  runStandaloneTechniqueFinder,
  runDynamicNishioFinder,
  runDynamicUnaryFinder,
  runDynamicMultipleFinder,
  findNextStepWasm,
  findAllAvailableStepsWasm,
} from "../bridge/sudoku-wasm-adapter.js";

let core = null;
parentPort.on("message", async (message) => {
  try {
    if (message.type === "init") {
      core = await instantiateCore(new Uint8Array(message.wasm));
      parentPort.postMessage({ id: message.id, ok: true });
      return;
    }
    if (!core) throw new Error("worker core not initialized");
    if (message.type === "load") {
      loadPosition(core, message.grid, message.masks, message.givenGrid);
      parentPort.postMessage({ id: message.id, ok: true });
      return;
    }
    let result;
    if (message.type === "standalone") result = runStandaloneTechniqueFinder(core, message.techniqueId);
    else if (message.type === "findNext") result = findNextStepWasm(core, { budgetLimit: message.budgetLimit });
    else if (message.type === "findAll") result = findAllAvailableStepsWasm(core, { budgetLimit: message.budgetLimit });
    else if (message.type === "dynamicNishio") result = runDynamicNishioFinder(core, message.budgetLimit);
    else if (message.type === "dynamicUnary") result = runDynamicUnaryFinder(core, message.budgetLimit);
    else if (message.type === "dynamicMultiple") result = runDynamicMultipleFinder(core, message.budgetLimit);
    else throw new Error("unknown command " + message.type);
    parentPort.postMessage({ id: message.id, ok: true, result });
  } catch (error) {
    parentPort.postMessage({ id: message.id, ok: false, error: error?.stack || String(error) });
  }
});
