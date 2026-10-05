# 接口与实现说明

## 数据契约

棋盘为长度 16 的普通数组或数值 TypedArray，行优先。格子必须为 0 或 2 的整数次幂，2 表示真实块 2，不能传指数 1；各方法的上限不同，见下表。输入不会修改。方向与原版 2048 相同：0 up，1 right，2 down，3 left。

| 入口 | 范围与超过范围时的行为 |
|---|---|
| `model.evaluate(board)` | 非零格子为 2–32768；32768 是合法的 rank 15。65536、131072 等更大格子在查表前抛出 `RangeError`，不截断、不钳制 |
| `tupleIndices(board, patterns?)` | 与 `evaluate` 相同；每个六格索引为 0–16777215（`16^6-1`），全 rank 15 对应最后一个合法条目 |
| `model.evaluatePacked(lo, hi)` | 两个参数各为有限整数 Number，范围 0–4294967295（uint32）；每个 word 保存八个四位 rank，最大 rank 15，不存在 rank 16 编码 |
| `solver.chooseMove(board)` | 先验证格子为 0 或 2–`2^52` 的精确整数次幂，再检查目标。已有任意格子 `>= target` 时直接返回终止结果，不打包、不查权重；只有未达目标的棋盘进入搜索 |
| `new NTupleSolver(model, {target})` | `target` 仅允许 4–32768 的 2 次幂；不能设为 65536 或 131072 |

所以，`chooseMove` 接收含 65536 的合法数值棋盘并报告 `targetReached:true`，只表示目标早已达到，不表示模型能够评价该棋盘或继续向更大块搜索。

## 模型

### `loadModel(manifestPath)`

Node.js 同步加载固定模型 `.json`，验证格式、原始来源 SHA-256、转换文件大小与完整 SHA-256，再建立共享底层缓冲区的 Float32Array 表。当前支持本文固定版本的 4x6 / 8x6，不执行二进制内容，不读取训练状态。要求小端平台。

8x6 加载/checksum 在本次两个评估进程中约为 1 秒量级；计时单独记录，不计入单局游戏时间。模型只需加载一次，再复用同一个 solver 跑多局。

### `new NTupleModel(tables, patterns = PATTERNS)`

供已持有权重或研究自定义模型的调用方使用。每个模式需要一个长度 `16^6` 的 Float32Array；模式用六个十六进制格子编号表示。默认模式属于 4x6，八表模型必须传八个对应模式。该入口不验证自定义权重来源；官方模型推荐通过 `loadModel()` 加载。调用方应将权重视为只读。

- `model.evaluate(board)`：计算学习到的 afterstate 价值
- `model.evaluatePacked(lo, hi)`：有输入校验的高级接口，双 uint32 指数棋盘
- `tupleIndices(board, patterns?)`：调试接口，模式优先、每模式八种 D4 变换，返回查表索引
- `MODEL_CATALOG`：固定模型的模式、大小与哈希

afterstate 是玩家移动/合并完成、随机块尚未生成的棋盘。模型不应在 post-spawn beforestate 上直接替代动作价值。每个模式第一个格子是最低 4 位，八种对称查表值相加，不取平均。

`evaluatePacked` 中，`lo` 对应行优先格子 0–7，`hi` 对应 8–15，各自最低四位对应该组第一个格子。负数、非整数、`NaN`、无穷大、`2^32` 及以上、字符串或 BigInt 均抛出 `RangeError`，不会先用位运算默默转成另一个棋盘。`0`、`0x80000000`、`0xffffffff` 都是合法 word。若调用方用 JavaScript 位运算构造了有符号 int32 位模式，应在构造完成后用 `word >>> 0` 显式转为 uint32；不要用它掩盖任意越界输入。

默认模型的 `evaluate(board)` 在棋盘打包校验后，以及 solver 在内部生成合法 packed 局面后，调用模块私有的查表函数，不在每个搜索叶子重复公共参数校验；查表公式、顺序与非有限权重检查相同。调用方若显式包装或重写 `evaluatePacked`，内部仍沿用该方法，保留原有诊断/定制行为；包装函数转调原方法时会执行公共校验。

## 求解器

### `new NTupleSolver(model, options)`

| 参数 | 默认/范围 | 含义 |
|---|---|---|
| ply | 2；允许 1 或 2 | 常规搜索层数 |
| target | 32768 | 目标块；允许 4–32768 的 2 次幂，本项目成绩只验证 32768 |
| criticalSearch | 未开启 | true 时在困难局面增加第三层 |
| criticalEmpty | 1；0–4 | 当前真实棋盘空格数不超过此值 |
| criticalTile | 8192 | 当前真实棋盘最大块至少达到此值 |

推荐并验证的选项是：`{ply:2,target:32768,criticalSearch:true,criticalEmpty:1,criticalTile:8192}`，搭配 8x6 模型。触发条件只看调用时棋盘，不看未来随机数，不使用游戏种子。

### `solver.chooseMove(board)`

同步返回：

```js
{
  direction: 1,
  name: 'right',
  value: 272133.88,
  ply: 2,
  actualPly: 3,
  nodes: 123,
  elapsedMs: 0.8,
  complete: true,
  targetReached: false
}
```

- `actualPly` 是此次选定的层数；某分支到达目标时会提前停止，不会为了凑满深度继续走。
- 已达到目标：`direction:null,targetReached:true`。无合法移动：`direction:null,targetReached:false`。
- 已达目标或能立即合成目标的根动作使用有限的 `1e9` 终止标记值；它不会作为内部随机分支的巨大额外奖励。
- `value` 是动作的学习得分估计/搜索价值，不是概率。
- `nodes` 统计内部后续玩家节点及候选动作计数，不宜与其他算法不同口径的节点数直接比较。
- `complete:true` 表示本次配置的固定深度计算完成，不代表得到无限深度最优解。模型本身仍是学习近似。
- 核心不设随机采样、每步墙钟预算或不完整搜索回退；测试工具的整局时间上限在步与步之间检查。

## 搜索公式与目标安全

1-ply：根动作合并奖励 + 该动作 afterstate 的模型价值。

2-ply：根奖励 + 所有空位、90% 生成 2 / 10% 生成 4 的完整期望。每个生成分支中，下一个合法动作的价值为：合并奖励 + max(后续 afterstate 价值, 0) + 1；没有合法动作返回 0。这与参考实现的内部计算约定一致。

选择性 3-ply 递归多进行一次完整生成/决策，沿用同一奖励、clamp 与 +1 规则。到达目标的 afterstate 立即作为模型叶子，不再生成或移动，避免四位指数编码越过 32768 后溢出。真实根可立即达到目标时直接选择该动作。

两个 16384 可以合成 32768 并终止；两个 32768 不会在 TD 搜索中继续合成 65536。共享辅助引擎的内部 `movePacked` 故意不合并两个 rank 15；它不是通用的大数值移动接口。辅助引擎的公开数值 `Game.move` 独立实现真实移动，可以合成 65536（输入块最多 `2^52`，合并结果超出安全整数范围时拒绝），但该结果仍不能送进 TD 模型评价。

网页 `drafting-games-1.html` 中的“原有启发式”是另一套五位指数搜索实现；手动继续和切换该模式不扩展本 TD 权重或四位特征表的范围。原启发式、数值移动引擎与 TD 学习模型的能力和成绩应分别说明。本次边界校验没有修改它们或模型格式，也没有赋予 TD 模型处理 65536/131072 局面的能力。

JavaScript 为双精度求和，C++ 参考的 numeric 是 float；这里的 native-style 是公式/索引/搜索约定一致，不是承诺不同语言所有浮点位或平局决策完全一致。

## 测试与时间边界

`benchmark-ntuple.js` 参数：

- `--model FILE`：准备好的模型 manifest
- `--seed N`、`--games N`：固定种子起点与局数
- `--ply 1|2`
- `--critical-empty N`：启用选择性第三层，并设定空格阈值
- `--critical-tile N`：最大块阈值
- `--max-seconds N`：每局安全时限，默认 60 秒；在动作边界检查，当前动作可完成
- `--out FILE`：以排他创建方式写 JSONL，不覆盖旧结果

到时记 `interrupted`，停止后续游戏，不能作为普通输局。独立 100 局实验另外用监督程序确保任一进程触发时限会停止另一进程。本次未触发。

分析完整实验：

```sh
node analyze-ntuple.js --protocol results/INDEPENDENT_EVALUATION_PROTOCOL.json \
  results/independent-seeds61001-61050.jsonl \
  results/independent-seeds61051-61100.jsonl
```

分析器检查协议、版本、模型、配置、种子与每局终局、按种子生成的总质量及得分恒等式。协议缺局或存在中止，`complete` 为 false；不会伪称完整 100 局。测试随机数使用独立 Mulberry32；solver 只接收棋盘，不接收种子或未来生成序列。

## 模块与浏览器

本目录单独的 `package.json` 使用 CommonJS，不改变主仓库的 ESM 配置。Node ESM 用默认导入即可。脚本也导出浏览器全局 `NTuple2048`，须先加载相邻的游戏辅助脚本。

经过验证的运行方式是 Node.js。浏览器全局接口做了 VM smoke 检查，但没有对网页上的大文件下载、Worker/CORS 和不同设备内存做完整端到端验证。浏览器调用方需自行获得权重数组并在 Worker 中运行，避免阻塞页面；不承诺低内存移动设备可运行 512 MiB 模型。
