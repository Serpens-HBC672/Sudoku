# 2048 固定权重搜索深度实验

2026年10月10日，对固定提交的新65536目标策略进行30个配对种子×4组实验。120局全部自然结束。首个32768：固定1层13/30、固定2层12/30、选择性3层14/30、固定3层14/30。第二个32768与65536均为0/30。固定3层没有显示相称收益，单局时间中位数约为选择性3层的13.6倍。

完整结论、边界与统计限制见[REPORT.md](REPORT.md)。正式结果见[games.csv](games.csv)、[summary.json](summary.json)；固定4层只在[pilot.json](pilot.json)作删失成本探针，不纳入胜率比较。

## 只核验数据

```sh
python3 verify.py
```

脚本不需要模型、网络或第三方包。它独立回放traces中的全部动作，核对results.jsonl。每个trace文件对应一个种子；四个值都是0上、1右、2下、3左的动作数字串。

## 复现单局

本目录只附实验包装，不重复提交游戏实现或模型。在包含固定提交的仓库内执行：

```sh
node prepare-source.cjs
node run.cjs --model /path/to/8x6patt.f32 --mode selective --seed 62002 --games 1 --max-seconds 120 --max-moves 50000 --handoff-ms 200 --out rerun-62002-selective.jsonl
```

如浅克隆不含原提交，可从[固定HTML](https://raw.githubusercontent.com/Serpens-HBC672/Sudoku/8b5a41f33a14a3132543658e32135dcfc4ab5cc4/tools/drafting-games-1.single-2.html)下载文件，再运行 node prepare-source.cjs --html /path/to/pinned.html。生成代码放在被忽略的generated目录，不更改仓库的游戏文件。

模型从[固定Release](https://github.com/Serpens-HBC672/Sudoku/releases/tag/2048-model-8x6-0899be24-v1)下载8x6patt.f32，512MiB。原加载器核验完整模型大小和官方SHA-256。无需安装npm依赖。本次环境是Linux x64、Node v24.19.0。

mode可选1、2、selective、3或4。固定3/4只放开构造器白名单，递归不变；4仅建议作有上限的成本探针。正式种子62002–62031，62001只用于成本试跑。输出使用新文件名，现有文件不会被覆盖。120秒限制在决策之间检查，单步可能略超时；并行性能包含资源竞争。启发式墙钟预算可能导致跨机器差异。

protocol.json保存原预注册顺序与截止时刻，是该次运行的记录，不会自动启动新实验。欲重跑整组，应另存新输出、日期及资源预算；不要覆盖原始证据或把新结果混入本次汇总。

## 来源与许可

- [固定提交](https://github.com/Serpens-HBC672/Sudoku/commit/8b5a41f33a14a3132543658e32135dcfc4ab5cc4)，页面内嵌TD与AI2048Kit。
- 权重来自moporgic/TDL2048固定revision0899be24f2f53d1199225960330e6742177af81d，作者Hung Guei，MIT许可见LICENSE-TDL2048.md。
- Expectimax及原启发式所用row/bitboard方法源自Robert Xiao与贡献者的2048-ai，MIT许可见LICENSE-EXPECTIMAX.txt。提取器保留原源码许可注释。
- 该目录是实验报告与复现资料，不修改页面、原求解器或训练权重。
