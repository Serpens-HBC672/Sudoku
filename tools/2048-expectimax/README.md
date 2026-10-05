# 独立 2048 Expectimax 求解器

这是一套与 Sudoku 页面完全独立的标准 **4×4 2048** 求解器。建议目录为 `tools/2048-expectimax/`；不改数独逻辑，不假装原仓库有 2048 游戏接口。

目标是提高第一次合成 **32768** 的概率。**目前不能把“成功率 ≥ 1/3”当成已经验证的结果。** 源码采用纯 Expectimax，尚未引入 N-tuple / TD 学习。实际实验与限制见 [EXPERIMENTS.md](EXPERIMENTS.md)，包括低预算下的失败结果；上游算法的历史表现不等于此 JavaScript 实现的实测表现。

## 文件

- `expectimax2048.js`：求解器、独立游戏规则、种子随机数，无运行时依赖
- `benchmark.js`：可复现实验，逐局 JSONL、配置、源码 SHA-256、轨迹摘要、耗时、Wilson 置信区间
- `analyze.js` / `test-analyze.js`：按预注册协议汇总，拒绝混合版本/重复种子，并独立检查生成质量与得分守恒
- `test-expectimax2048.js`：独立参考实现、穷举行表、随机棋盘、搜索 oracle 等
- `worker.js`：可选浏览器 Worker 适配层
- `API.md`：完整接口、方向编号、终止语义及预算说明
- `EXPERIMENTS.md` / `results/`：实验报告与原始记录
- `LICENSE`：本实现及上游启发式的 MIT 授权声明

## 快速运行

需要 Node.js ≥ 22；无需 `npm install`。

```sh
cd tools/2048-expectimax
node test-expectimax2048.js
node benchmark.js --games 1 --seed 42 --profile balanced --out results/local-seed42.jsonl
```

`--out` 默认拒绝覆盖已有实验文件；换一个文件名重跑。

### Node.js CommonJS

```js
const { Solver, move, spawn, createRng, initialBoard } = require('./expectimax2048.js');
const solver = new Solver({ profile: 'balanced' });
const rng = createRng(42);
let board = initialBoard(rng);

while (true) {
  const answer = solver.chooseMove(board);
  if (answer.direction === null) break; // 已达目标或无合法移动
  const moved = move(board, answer.direction);
  board = moved.board;
  if (board.some(value => value >= 32768)) break;
  board = spawn(board, rng).board; // 仅在棋盘发生变化后生成新块
}
console.log(board);
```

### Node.js ESM

```js
import Expectimax2048 from './tools/2048-expectimax/expectimax2048.js';
const solver = new Expectimax2048.Solver({ profile: 'strong' });
const answer = solver.chooseMove([
  2, 4, 8, 16,
  0, 2, 4, 8,
  0, 0, 2, 4,
  0, 0, 0, 2
]);
console.log(answer.name, answer.depth, answer.nodes);
```

目录内 `package.json` 的 `"type": "commonjs"` 仅作用于本目录，适配主仓库的 `"type": "module"`。浏览器直接加载经典脚本获得 `globalThis.Expectimax2048`；浏览器原生 ESM 并不支持上面的 Node.js CommonJS 默认导入规则。

### 浏览器与 Worker

```html
<script src="./expectimax2048.js"></script>
<script>
  const solver = new Expectimax2048.Solver({ profile: 'fast' });
  // solver.chooseMove(flatRowMajorBoard)
</script>
```

高预算搜索是同步 CPU 工作，会阻塞页面主线程，实际页面推荐经典 Web Worker：

```js
const worker = new Worker('./worker.js');
worker.postMessage({ type: 'configure', id: 1, options: { profile: 'strong' } });
worker.postMessage({ type: 'solve', id: 2, board: flatRowMajorBoard });
worker.onmessage = event => console.log(event.data);
// 用户换局或取消时可 worker.terminate()，再按需建立新 Worker。
```

通过正常 HTTP(S) 服务加载；不要依赖 `file://`。Worker 示例为可选适配层，核心脚本的浏览器导出与 Node ESM 已测试，实际 Worker 页面端到端运行仍需在接入游戏时验证。

## 算法与优化

1. **64 位棋盘拆成两个无符号 32 位整数**：每格 4 位保存指数，避免 JavaScript `Number` 无法精确表示任意 64 位整数，以及热循环 `BigInt` 分配开销。
2. **65,536 项行表**：左右移动、上下列增量、空格数、最大指数、不同指数掩码及启发式全部预计算。递归移动路径不创建数组或棋盘对象。
3. **标准 Expectimax**：玩家节点取合法动作最大值；随机节点枚举全部空位，每个位置分别按 `0.9 / 空位数`、`0.1 / 空位数` 生成 2、4。不把随机生成当成恶意对手，不随机抽样代替完整枚举。
4. **叶子启发式**：行列各计一次，使用空位、可合并同指数段、四次幂单调性及指数 3.5 次幂和。系数来自 nneonneo/2048-ai；无额外训练数据或伪造的学习过程。
5. **路径概率截断**：低概率分支直接以启发式估值，非数学意义上的零误差精确搜索；参数可设为 0 关闭。
6. **精确键置换表**：存储完整双整数棋盘、剩余深度及路径概率。哈希冲突只能覆盖，不会误命中。深度为 1 且已经通过当前概率截断的节点，其所有子节点均到叶子，可安全忽略路径概率进行精确复用。跨深度、受不同概率截断影响的值不盲目混用。
7. **迭代加深与预算**：按照不同非零指数个数自适应搜索深度；达到节点或时间预算时，仅保留所有根动作都完成的一轮。不会比较搜索量不一致的半轮根值。预算小到一轮都没完成时，退回合法动作的静态启发式排序。
8. **无需搜索的决策**：只有一个合法根动作时直接返回；内部最大值节点达到目标效用上界时立即停止其余动作。
9. **目标与失败分离**：第一次出现目标块立即终止搜索；不会发生 `32768+32768` 在 4 位编码中溢出。输局值为 `-1e9`，避免负启发式意外使“立即死局”更吸引人。公开 `move()` 为独立数值实现，能够正确合成 65536 等更高块。

## 强度与复现建议

- `fast` 适合检查接入和低延迟演示，不应据此承诺 32768 达成率。
- `balanced` 为默认实用预算。
- `strong` 为更高搜索预算，仍是算法配置名称，不是成功率保证。
- 要比较真实棋力，使用固定节点预算、`timeBudgetMs: 0`、预先指定且不挑选的种子集合。墙钟预算会随硬件和负载改变搜索行为。
- 开发期种子与最终评估种子必须分开。修改启发式、预算、缓存或终止规则之后，应重新冻结版本和独立评估。
- 统计“至少 1/3”的总体概率，不能只看三局赢一局，也不能删去慢局、失败局或未完成局。报告点估计、样本数、置信区间与所有原始轨迹摘要。

## 来源与授权

- [nneonneo/2048-ai 源码](https://github.com/nneonneo/2048-ai/blob/master/2048.cpp)：位棋盘、行表与启发式思路，MIT
- [上游 MIT License](https://github.com/nneonneo/2048-ai/blob/master/LICENSE)
- [原版 2048 游戏规则实现](https://github.com/gabrielecirulli/2048/blob/master/js/game_manager.js)：4×4、两个初始块、90% 2 / 10% 4、有效移动后生成

本实现对 JavaScript 编码、精确缓存键、预算管理、目标终止、失败值、验证及实验记录做了独立适配。上游历史胜率只构成选型依据，不能替代本实现的实验。
