# 2048 N-tuple + TD 求解器

**推荐版本：8x6 预训练 N-tuple 网络 + 常规 2-ply、困难局面 3-ply 搜索。** 独立固定的 100 局测试中，**49 局合成 32768，成功率 49.0%**；95% Wilson 区间 **39.4%–58.7%**，下界高于 1/3。全部 100 局完整结束，无超时中止。两进程总耗时约 **4 分 49 秒**，单局平均 **5.64 秒**。

这满足本次标准规则测试的目标，不保证任意连续三局必胜一局。规则、版本、种子与原始数据见 [EXPERIMENTS.md](EXPERIMENTS.md)。上游模型历史成绩没有当作这里的实测成绩。

上述 49/100 属于原冻结求解器 SHA-256 `ab2e0c4eca2e84061602f9d4b80a45debd9986a35a618f32478cb0ae097261ed`。当前新增的 packed 输入校验和边界回归测试保持合法棋盘的查表与决策行为，不改权重或搜索策略；没有重跑一百局，不能将旧成绩标为修改后源码的新实测结果。

这套脚本与数独页面独立。先前的纯启发式 Expectimax 长测试已按用户要求停止，保留在相邻目录用于审计；当前推荐使用本目录的 TD 学习模型路线。

## 一次准备，随后本地运行

要求：64 位 Node.js ≥ 22；本次验证使用 Node.js 24.19.0。推理无 npm 运行时依赖；自动下载只需要系统 `curl`，也支持手动下载再转换。

```sh
cd tools/2048-ntuple
node prepare-model.js --network 8x6 --download
node benchmark-ntuple.js --model models/8x6patt.json \
  --seed 42 --games 1 --ply 2 --critical-empty 1 --critical-tile 8192 \
  --max-seconds 15 --out results/local-seed42.jsonl
```

准备命令下载作者公开的 **1.5 GiB** 模型，校验 SHA-256，再去掉仅用于训练的状态，生成 **512 MiB** 推理文件。原始文件与转换结果一起保留时约需 **2 GiB 磁盘**。实测单进程峰值约 **641 MiB RSS**；建议留出至少 1 GiB 可用运行内存，多进程/完整模型测试需要更多。

- 权重不进入 Git，`models/`、`.w`、`.f32` 已加入忽略规则。
- 没有隐式下载。只有显式执行准备命令才会下载；无需账号、API key 或付费服务。
- 单次自动下载最长 180 秒，未完成时保留 `.part`；重新执行相同命令会续传。
- 输出目录已存在完整转换文件时不会擅自覆盖；正常后续使用直接加载 `.json`。
- 本机较慢时可调整测试的 `--max-seconds`。它是整局测试的安全时限，不改变落子策略；触发时记为中止并停止后续局数，不能算作普通失败或忽略后宣称完整评估。

较小的 4x6 模型也受支持：原始下载 768 MiB，推理表 256 MiB。它是低内存备选，不是上面的 49% 推荐配置。

## 作为代码接口调用

```js
const { loadModel, NTupleSolver } = require('./ntuple2048.js');
const model = loadModel('./models/8x6patt.json');
const solver = new NTupleSolver(model, {
  ply: 2,
  target: 32768,
  criticalSearch: true,
  criticalEmpty: 1,
  criticalTile: 8192
});

const answer = solver.chooseMove([
  2, 4, 8, 16,
  0, 2, 4, 8,
  0, 0, 2, 4,
  0, 0, 0, 2
]);
console.log(answer.direction, answer.name, answer.actualPly);
```

方向：**0=上、1=右、2=下、3=左**。棋盘是行优先的 16 个真实块值，空格写 0。求解器返回建议，不修改输入、不自动落子或生成随机块。`value` 是学习到的得分估计，不是获胜概率。

推荐配置必须显式开启 `criticalSearch`；默认普通 2-ply 不等于经过 49% 测试的选择性 3-ply 配置。输入已达目标或无合法动作时，`direction` 为 `null`，用 `targetReached` 区分。

TD 模型的直接评价/特征索引最多支持 **32768（rank 15）**，65536 和 131072 会被拒绝。`chooseMove` 遇到已达目标的合法棋盘会直接终止，不会评价大块；`target` 也不能高于 32768。网页手动继续或切回原有启发式使用不同路径，不代表这份权重能处理更高块。低级 packed 接口的 uint32 范围、符号位和逐方法边界见 [API.md](API.md)。

Node.js ESM 可以默认导入本目录的 CommonJS 模块：

```js
import NTuple2048 from './tools/2048-ntuple/ntuple2048.js';
```

完整契约、搜索深度与浏览器边界见 [API.md](API.md)。

## 验证

无需权重的接口/合成数据测试：

```sh
npm test
```

准备模型后，运行真实权重和原始二进制的独立核验：

```sh
node test-ntuple8.js --model models/8x6patt.json --raw-model models/8x6patt.w
node test-selective.js --model models/8x6patt.json
```

4x6 对应 `test-ntuple.js --model models/4x6patt.json --raw-model models/4x6patt.w`。测试覆盖原始权重抽样、64 项模式索引、对称变换、独立数组棋盘、奖励、期望值及目标叶终止。模型不存在时不会偷偷下载，实际权重测试是否跳过会明确输出。

`npm test` 也运行 `test-boundaries.js`：覆盖 uint32 两端和高符号位、非法 packed 参数、32768 最后一个合法索引、两个 16384 的目标终止、超界数值评价拒绝及终止根零查表；用合成权重逐次检查索引，并与原冻结求解器比较合法输入的精确决策和值。它是回归检查，不是新的胜率实验。

## 文件与授权

- `ntuple2048.js`：模型加载、N-tuple 推理、选择性搜索
- `prepare-model.js`：固定版本下载、完整哈希验证、流式转换
- `benchmark-ntuple.js`：可复现短时实验，完整记录胜负/中止、耗时与内存
- `analyze-ntuple.js`：协议一致性、种子唯一性、生成质量及得分守恒检查、Wilson 区间
- `reference-ntuple.js` / `test-*.js`：独立参考与测试
- `results/`：协议、逐局 JSONL、汇总、版本档案；没有大权重
- 相邻 `../2048-expectimax/expectimax2048.js`：已独立验证的 2048 移动/生成引擎

使用作者发布、以 Optimistic TD Learning 训练的 MIT 基线模型；本项目没有伪称重新训练。原始模型来源、字节布局、固定版本和全部哈希见 [MODEL-PROVENANCE.md](MODEL-PROVENANCE.md)。
