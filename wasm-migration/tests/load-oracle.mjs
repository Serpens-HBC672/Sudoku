import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DEVVER_URL = new URL("../../Sudoku v3.23.3-rc.3 - DevVer.html", import.meta.url);

export async function loadOracle({ includeSoundnessChecker = false } = {}) {
  const html = await readFile(fileURLToPath(DEVVER_URL), "utf8");
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const mainScript = scripts.find((script) => script.includes("function candidatesAt") && script.includes("__SUDOKU_WASM_MIGRATION_TEST_HOOKS__"));
  if (!mainScript) throw new Error("Could not locate the DevVer main solver script");

  const eventMarker = "/* ------------------------------ 事件绑定";
  const markerIndex = mainScript.indexOf(eventMarker);
  if (markerIndex < 0) throw new Error("Could not locate event-binding cutoff marker");

  // Everything needed by the algorithm and migration hook is defined before
  // the DOM event-binding block. Evaluating only that prefix makes the oracle
  // runnable in Node without inventing a fake browser DOM.
  const algorithmScript = mainScript.slice(0, markerIndex);
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    performance,
    Date,
    Math,
    JSON,
    Object,
    Array,
    Set,
    Map,
    WeakSet,
    Number,
    String,
    Boolean,
    RegExp,
  });
  vm.runInContext(algorithmScript, context, {
    filename: "Sudoku-DevVer-oracle.js",
    timeout: 30_000,
  });

  const hooks = context.__SUDOKU_WASM_MIGRATION_TEST_HOOKS__;
  if (!hooks) throw new Error("DevVer did not install __SUDOKU_WASM_MIGRATION_TEST_HOOKS__");
  return includeSoundnessChecker
    ? { ...hooks, verifySoundnessAfterApply: vm.runInContext('verifySoundnessAfterApply', context) }
    : hooks;
}
