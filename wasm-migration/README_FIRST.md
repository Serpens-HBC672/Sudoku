# 本地 WASM 交接

此目录从 `caaef8df1b939142ac79445f33696e16bb092f78` 接续。以 `DELIVERY_REPORT.md` 与 `manifest.json` 为最终验收记录；旧文档中的 CI/性能/coverage 数字属于历史记录，不能代替本包本地证据。

## 直接使用

`build/sudoku-techniques.wasm` 是已编译的独立模块，使用它不需要安装 AssemblyScript。Node 22+ 示例（从此目录执行）：

```js
import { instantiateCore, loadPosition, findNextStepWasm }
  from './bridge/assembly-core.mjs';
const core = await instantiateCore(new URL('./build/sudoku-techniques.wasm', import.meta.url));
// grid/givens: 9×9 数字数组；masks: 81 个 row-major 9-bit 候选掩码。
loadPosition(core, grid, masks, givens);
const finding = findNextStepWasm(core, { budgetLimit: 6790 });
```

每次加载都应传入原始题面 `givens`，不能用当前已填写的盘面替代。省略第四参数会清空原始题面并禁用 GSP；旧版分开调用的接口仍可用，但 `loadGivenGrid` 必须在每次 `loadPosition` 之后调用。

浏览器使用 `bridge/sudoku-wasm-adapter.js`，传入通过 fetch 取得的 Uint8Array。Worker 使用 `bridge/sudoku-wasm-worker.js`，先发送 `{id,type:'init',wasm:bytes}`，再发送 `{id,type:'loadPosition',grid,masks,givenGrid}`，最后发送 `{id,type:'findNext',budgetLimit:6790}` 或 `findAll`。回复包含同一个 id、ok 和 finding/findings；错误在 error 字段。Worker 不应并发提交 init 与 load，应等待回复。主线程与 Worker 使用同一份模块字节，各自拥有独立实例。

Node adapter 可接收 validator 函数；函数不能通过 structured clone 发送给 Worker。Worker 的 loadPosition 可附带 solution（9×9 数组），按冻结 oracle 的 Exocet 校验规则过滤 Finding；每次 loadPosition 都重置 solution，省略时不启用已知解校验。主线程可使用 finding-validator.js 中相同的规则。

适配器返回的是原有 Finding 形状，顺序没有归一化或排序。9-bit mask 是计算输入，不能用 UI 笔记文本代替。模块不会回退到旧 JS 引擎。

## 重建与验收

从本目录执行 `npm ci --no-audit --no-fund`，再执行 `npm run build`。源码重建需要联网安装锁定编译器；交付二进制的离线调用不需要安装依赖。完整源码、原始语料与冻结 HTML 必须保持 ZIP 中的相对层级。

GSP 输入生命周期回归：`npm run test:gsp`（第47—54题，两种适配器各570步，含42个GSP步骤及生产Worker消息处理路径的Node测试）。入口验收：`npm run test:coarse`；soundness 负例：`npm run test:soundness`。完整 trace：`npm run test:trace`，它按题复用哈希匹配的 PASS，避免重跑已完成题。原有差分脚本保留；详见 BUILD.md。浏览器 Worker 脚本需安装 Playwright 并提供其 index.mjs 的绝对路径，使用本机 Edge：`node tests/browser-worker.mjs <playwright/index.mjs>`。

## 交付边界

适配器可调用、Node Worker 测试、真实浏览器 Worker 测试、原应用切换是四件不同的事。原 DevVer HTML 保留作冻结 oracle，未声称已切换原应用。此包是引擎和计算适配器交接；完整应用接线状态与未满足事项见 DELIVERY_REPORT.md。

owner 负责最终 Base64 嵌入和应用发布。MRV、Android/APK/AAB、签名均不在此包范围。没有 push、merge 或触发/等待 GitHub Actions。
