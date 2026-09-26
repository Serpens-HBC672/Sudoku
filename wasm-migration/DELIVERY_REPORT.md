# 本地交付验收

接续点：caaef8df1b939142ac79445f33696e16bb092f78。最终源码提交和逐文件哈希见包根目录 manifest.json。

## 二进制

AssemblyScript 0.27.31，incremental，Node v22.23.1。142582 bytes；SHA-256：009d0805c461df9a49b7015b642fc9e8a6dd5f0503a957f4606639b39ccf6a1a。标量与 SIMD-enabled 构建相同，没有 SIMD 提速证据。

## 本地结果

- 57/57 题完整求解；4886/4886 步真实有序 Finding 完全一致；预算 6790。每题 oracle pre/post grid、81 masks、Finding 和 soundness 数据在 evidence/full-trace。
- 三项原有 soundness 检查的负例测试通过；所有 4886 个已匹配 Finding 的 post-state 重放同一检查函数，零失败；另外检查全部未解格非零候选。
- 静态传播 1140，动态传播 228（预算64 smoke），动态 finder 171（预算64 smoke），standalone finder 2679，静态强制链 finder 171 项比较通过。初始态比较不冒充全程验证。
- Node bridge 与 browser-safe adapter 的独立实例：#22 的非空 findAll/findNext、validator 拒绝首项继续搜索、已解无结果、三次交错调用、返回对象生命周期及输入不变测试通过，预算6790。
- Node worker_threads parity 通过。真实 Edge 主线程/模块 Worker 使用同一字节测试通过；预算64 smoke，含 Exocet solution validator 拒绝路径。浏览器版本与返回对象保存在 evidence/browser-worker.json。
- Coverage：41/53 first-match；35/53 all-available；合计 46/53。未观察：fireworkTriple, fireworkQuadruple, fireworkWWing, fireworkAlp, multipleChain, seniorExocet, dynamicMultipleChain。

## 性能

同一机器同一 Node 进程的8个实际命中状态，预热1次、测量3次，先检查逐项一致性；初始化、输入、计算、Finding、端到端及原始样本见 BENCHMARK.md / evidence/performance/results.json。只代表所列技巧/状态，不宣称整题或 UI 加速比。

## 集成范围与未覆盖项

主线程适配器和浏览器 Worker 已验证可调用，使用同一个 WASM；生产适配器没有旧 JS 求解 fallback。Worker 增加可选 solution，复制冻结 oracle 的 Exocet 边界校验规则，未改技巧发现。原应用 HTML 仍是冻结 oracle，未改成已部署的 WASM 应用，也未做 UI/消息/导航验收；不能把本包测试当成原应用整体切换成功。owner 仍需完成最终 Base64 嵌入及应用发布接入。原应用的可选详细链展示和自定义技巧顺序未做集成验收。

历史 CI run 36108090845 的 completed/success 来自交接文件，保留引用于 BUILD.md；本次未重新触发或等待，也不以其替代本地结果。

所有文件仅在当前 Sudoku 工作区及新的交付子目录；没有 push、merge、远端分支修改或 GitHub Actions 操作。

## 后续 GSP 接入修复（2026-09-26）

`loadPosition(core, grid, masks, givenGrid)` 现在支持同次加载原始题面，Node、浏览器和 Worker 路径及调用示例均已同步。此前省略原始题面可复现第47—54题的42处GSP差异；正确加载后，两种适配器各570/570步与冻结JS oracle一致。新增 `test:gsp` 覆盖上述完整轨迹、直接GSP调用、重复加载、旧接口、无givens重置及生产Worker消息处理（Node shim，非真实浏览器启动测试）。

本次未修改AssemblyScript技巧实现，重建WASM的哈希仍与上文一致。桥接文件与测试已修改，旧交付包manifest和4886步证据属于修复前版本，本次未重新宣称全57题验收。仓库未包含Claude后续的Base64内嵌集成HTML，该文件须使用更新适配器并在每次loadPosition时传入原始givenGrid。
