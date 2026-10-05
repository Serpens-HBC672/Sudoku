# 接口说明

## 棋盘与方向

公开棋盘为长度 **16** 的普通数组或数值 TypedArray，按 **行优先** 排列；`0` 表示空位，其他格为 `2, 4, 8, ...` 的真实块值，不是指数。输入不被修改。

| 方向编号 | 字符串 | 说明 |
|---:|---|---|
| 0 | `up` | 上 |
| 1 | `right` | 右 |
| 2 | `down` | 下 |
| 3 | `left` | 左 |

字符串不区分大小写。方向编号与原版 2048 相同；**不同于某些 C++ 实现中的 up/down/left/right 顺序**。

## `new Solver(options?)`

| 选项 | 默认值 | 含义 |
|---|---:|---|
| `profile` | `balanced` | `fast` / `balanced` / `strong` |
| `maxDepth` | 见下表 | 后续移动深度上限，整数 1–16 |
| `probabilityCutoff` | 见下表 | 累积路径概率小于此值时使用叶子估值；0 关闭概率截断 |
| `nodeBudget` | 见下表 | 单次决策所有迭代共享的递归节点预算 |
| `tableBits` | 18 | 缓存容量 `2^tableBits`；0 关闭，最大 24 |
| `target` | 32768 | 第一次达到的终止目标，4–32768 之间的 2 的整数次幂 |
| `timeBudgetMs` | 0 | 0 不按墙钟截断；正数为软时间预算 |
| `iterative` | true | 逐层加深，只采用完成的整轮根搜索 |
| `adaptiveDepth` | true | 深度取 `min(maxDepth, max(3, 不同非零指数数−2))` |

| profile | maxDepth | probabilityCutoff | nodeBudget |
|---|---:|---:|---:|
| fast | 5 | 0.001 | 100000 |
| balanced | 8 | 0.0001 | 1000000 |
| strong | 10 | 0.00005 | 8000000 |

显式选项覆盖 profile。更大预算不保证每局必然更好，也不能由配置名推出胜率。

缓存约占 `29 × 2^tableBits` 字节，默认约 7.25 MiB；全局行表约数 MiB，每个 JavaScript 运行时共享一次。多个 Solver 有各自置换表。使用很大的 tableBits 可能造成明显内存压力。

### 深度精确定义

根动作先移动。`depth = 1` 表示随后枚举一次生成，再看一次玩家动作，在该动作之后评估棋盘；因此包含 **根动作及 1 次未来玩家动作**。概率截断允许一些分支更浅；返回的 `depth` 是完成的迭代深度，不是每条路径都走到的深度。

### 预算限制

- 节点预算精确到一次调用的超限检测，返回节点数可能是 `nodeBudget + 1`。
- 时间每 2048 个节点检查一次，是软预算；初始化、输入检查与运行时调度还可能增加耗时。
- 时间预算会影响复现；实验建议禁用。
- `iterative: false` 直接尝试目标深度；若中途耗尽预算，没有已完成的较浅轮可以保留，将退回静态合法动作。不要用过小预算同时禁用迭代加深。

## `solver.chooseMove(board)`

同步返回：

```js
{
  direction: 0,          // 0..3；null 表示停止
  name: 'up',            // 相应字符串；停止时 null
  value: 1234567.89,     // 启发式/Expectimax价值，不是成功概率
  depth: 4,             // 完成的整轮深度；0 表示无需搜索或静态回退
  nodes: 500000,         // 本次递归节点计数
  cacheHits: 9000,
  elapsedMs: 32.1,
  complete: true,        // 是否未因预算中断；不代表无概率截断或已证明最优
  targetReached: false  // 输入棋盘是否已经达到目标
}
```

重要边界：

- 输入中任一块 `>= target`：`direction: null, targetReached: true`，不继续玩超目标局面。
- 无合法移动：`direction: null, targetReached: false`。
- 可以一步达到目标：直接返回该合法动作，无需扩大搜索；输入尚未达标，因此 `targetReached: false`。
- 只有一个合法动作：直接返回该动作，`depth: 0, nodes: 0, complete: true`；此时 `value` 为静态估值，不是已经执行搜索的结果。
- 返回 `value` 绝不是预测成功概率，不能当作百分数展示。
- 空棋盘没有可变化的移动；先用 `initialBoard()` 开局。
- 对 32768 目标，一般参与搜索的输入块最大为 16384。已有更大块先按“已达目标”处理，不压入 4 位棋盘。

## 游戏规则辅助接口

### `move(board, direction)`

返回 `{ board, moved, score }`。仅滑动和合并，**不会随机生成**。同一块每次移动只可参与一次合并；`score` 是本次合并的新块数值之和。`moved: false` 时游戏不得生成新块。

实现与搜索 LUT 独立，支持更高块值，例如 `32768+32768→65536`。输入块最高可为安全整数范围内的 2 的幂；合并将超出 `Number.MAX_SAFE_INTEGER` 时抛出 `RangeError`。正常 2048 不会接近该边界。

### `spawn(board, rng = Math.random)`

返回 `{ board, index, value }`；没有空位时返回 `null`。均匀选取一个空格，90% 放 2，10% 放 4。每次使用两次 RNG，顺序是位置、数值。RNG 必须返回 `[0,1)` 的有限数。

该函数不判断上一步是否有效；调用方只能在有效移动之后调用。求解器自身不会为 UI 擅自落子或生成。

### `createRng(seed)`

返回 Mulberry32 种子 RNG；`seed` 为 `0..4294967295` 的整数。适合可复现仿真实验，**不适用于密码学**。不同游戏应使用不同预先指定的种子；不要在每一步重置种子。

### `emptyBoard()` / `initialBoard(rng?)`

分别返回全空新棋盘、按相同生成规则放置两个初始块的新棋盘。

### 常量

- `DIRECTIONS`：冻结的 `['up','right','down','left']`
- `PROFILES`：冻结的预算配置
- `_internals`：仅为测试提供的私有接口，不承诺稳定兼容性；packed 移动只在目标终止之前使用，不能用它继续合并两个 32768。

## Worker 消息协议

- 请求 `{type:'configure', id, options}` → `{type:'configured', id, options}`
- 请求 `{type:'solve', id, board}` → `{type:'result', id, result}`
- 失败 → `{type:'error', id, error}`

同一个 Worker 按消息队列串行处理；`id` 原样回传。若棋盘在等待期间变化，前端应丢弃过期 id 的决策，不能把旧棋盘结果用于新局面。需要立即取消时终止 Worker，并创建新的 Worker。

## 实验命令

```sh
node benchmark.js --games 30 --seed 50001 --profile strong \
  --cutoff 0.0001 --nodes 8000000 --time-ms 0 \
  --out results/holdout-50001-50030.jsonl
```

这是可复现的命令示例，并不表示对应的 30 局已经跑完。实际执行范围见实验报告。

其他参数：`--depth`、`--table-bits`、`--no-iterative`、`--fixed-depth`、`--progress`、`--max-moves`；完整帮助为 `node benchmark.js --help`。达到 max-moves 的局计为 `censored`，不会假报成功或普通输局。
