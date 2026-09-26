import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadOracle} from '../tests/load-oracle.mjs';
import {loadBenchmarkCorpus} from '../tests/benchmark-corpus.mjs';
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const full=await json('evidence/full-trace/full-differential.json');
const coverage=await json('evidence/coverage.json');
const performance=await json('evidence/performance/results.json');
const bytes=await readFile('build/sudoku-techniques.wasm');
const hash=createHash('sha256').update(bytes).digest('hex');
const oracle=await loadOracle({includeSoundnessChecker:true});
const corpus=await loadBenchmarkCorpus();
assert.equal(full.cases.length,corpus.length);
assert.equal(full.totalSteps,full.passedSteps);
assert.equal(performance.wasmSha256,hash);
assert.equal(performance.cases.length,8);
let checked=0;
for(const entry of corpus){
  const saved=await json('evidence/full-trace/oracle-'+entry.id+'.json');
  const pass=await json('evidence/full-trace/case-'+entry.id+'.json');
  assert.equal(pass.status,'PASS');assert.equal(saved.identity.wasm,hash);
  assert.deepEqual(saved.identity,pass.identity);
  assert.equal(saved.trace.complete,true);
  assert.equal(saved.trace.soundnessProblem,null);
  for(const step of saved.trace.trace){
    const grid=Array.from({length:9},(_,r)=>Array.from({length:9},(_,c)=>Number(step.afterGrid[r*9+c])));
    const getCands=(r,c)=>Array.from({length:9},(_,i)=>i+1).filter(d=>step.afterMasks[r*9+c]&(1<<(d-1)));
    assert.equal(oracle.verifySoundnessAfterApply(step.finding,entry.solution,grid,getCands),null);
    for(let k=0;k<81;k++){
      assert.equal(step.afterMasks[k]&~511,0);
      if(step.afterGrid[k]==='0')assert.notEqual(step.afterMasks[k],0);
    }
    checked++;
  }
}
assert.equal(checked,full.passedSteps);
await writeFile('evidence/soundness-replay.json',JSON.stringify({status:'PASS',steps:checked,contract:'Original verifySoundnessAfterApply applied to all exact-parity selected Findings and saved post-states; all unsolved cells additionally checked nonzero.',wasmSha256:hash},null,2));
const rows=performance.cases.map(x=>`| ${x.caseId} | ${x.key} | ${x.median.jsMs.toFixed(3)} | ${x.median.inputMs.toFixed(3)} | ${x.median.executionMs.toFixed(3)} | ${x.median.findingMs.toFixed(3)} | ${x.median.endToEndMs.toFixed(3)} | ${x.speedup.toFixed(2)}x |`);
const benchmark=`# Local measured performance\n\n${performance.methodology}\n\nNode ${performance.node}; ${performance.platform}; CPU ${performance.cpu}; incremental runtime; DFC budget 6790. Module initialization ${performance.initializationMs.toFixed(3)} ms. WASM SHA-256 ${hash}.\n\nOne untimed warmup and three timed repetitions per actual positive state. Exact ordered Finding parity is required before timing acceptance. Timed runs were performed after local regression work completed. Raw samples and full input grid/masks: evidence/performance/results.json. These are representative per-technique end-to-end measurements, not whole-application or whole-puzzle speedups.\n\n| Case | Technique | JS ms | Input ms | WASM compute ms | Finding ms | WASM end-to-end ms | Ratio |\n|---:|---|---:|---:|---:|---:|---:|---:|\n${rows.join('\n')}\n\nSIMD-enabled and scalar files have identical bytes; no SIMD speedup is claimed. No cross-machine historical timings enter the ratios.\n`;
await writeFile('BENCHMARK.md',benchmark);
await writeFile('benchmark/BENCHMARK.md',benchmark);
await writeFile('COVERAGE.md',`# Local technique coverage\n\nDerived from frozen TECHNIQUE_CHAIN and this delivery's complete ${corpus.length} case traces.\n\n- Registry: ${coverage.registry.length}\n- First-match observed: ${coverage.firstMatch.length}\n- All-available observed: ${coverage.allAvailable.length}\n- Union observed: ${coverage.registry.length-coverage.notObserved.length}\n- Exact-parity trace steps: ${checked}\n- Soundness failures: 0\n\nAll-available scan: first recorded state of cases 11,34,47,53,57, at normal budget 6790. No all-technique scan at every step. Raw ordered Findings: evidence/coverage.json.\n\n## First-match\n\n${coverage.firstMatch.join(', ')}\n\n## All-available\n\n${coverage.allAvailable.join(', ')}\n\n## Not observed\n\n${coverage.notObserved.join(', ')}\n\nThese remain implemented but have no positive observation in these trace/coverage samples. Initial-state per-technique differential includes null-result parity and must not be described as positive technique coverage.\n`);
await writeFile('DELIVERY_REPORT.md',`# 本地交付验收\n\n接续点：caaef8df1b939142ac79445f33696e16bb092f78。最终源码提交和逐文件哈希见包根目录 manifest.json。\n\n## 二进制\n\nAssemblyScript 0.27.31，incremental，Node ${performance.node}。${bytes.length} bytes；SHA-256：${hash}。标量与 SIMD-enabled 构建相同，没有 SIMD 提速证据。\n\n## 本地结果\n\n- ${corpus.length}/${corpus.length} 题完整求解；${checked}/${checked} 步真实有序 Finding 完全一致；预算 6790。每题 oracle pre/post grid、81 masks、Finding 和 soundness 数据在 evidence/full-trace。\n- 三项原有 soundness 检查的负例测试通过；所有 ${checked} 个已匹配 Finding 的 post-state 重放同一检查函数，零失败；另外检查全部未解格非零候选。\n- 静态传播 1140，动态传播 228（预算64 smoke），动态 finder 171（预算64 smoke），standalone finder 2679，静态强制链 finder 171 项比较通过。初始态比较不冒充全程验证。\n- Node bridge 与 browser-safe adapter 的独立实例：#22 的非空 findAll/findNext、validator 拒绝首项继续搜索、已解无结果、三次交错调用、返回对象生命周期及输入不变测试通过，预算6790。\n- Node worker_threads parity 通过。真实 Edge 主线程/模块 Worker 使用同一字节测试通过；预算64 smoke，含 Exocet solution validator 拒绝路径。浏览器版本与返回对象保存在 evidence/browser-worker.json。\n- Coverage：${coverage.firstMatch.length}/${coverage.registry.length} first-match；${coverage.allAvailable.length}/${coverage.registry.length} all-available；合计 ${coverage.registry.length-coverage.notObserved.length}/${coverage.registry.length}。未观察：${coverage.notObserved.join(', ')}。\n\n## 性能\n\n同一机器同一 Node 进程的8个实际命中状态，预热1次、测量3次，先检查逐项一致性；初始化、输入、计算、Finding、端到端及原始样本见 BENCHMARK.md / evidence/performance/results.json。只代表所列技巧/状态，不宣称整题或 UI 加速比。\n\n## 集成范围与未覆盖项\n\n主线程适配器和浏览器 Worker 已验证可调用，使用同一个 WASM；生产适配器没有旧 JS 求解 fallback。Worker 增加可选 solution，复制冻结 oracle 的 Exocet 边界校验规则，未改技巧发现。原应用 HTML 仍是冻结 oracle，未改成已部署的 WASM 应用，也未做 UI/消息/导航验收；不能把本包测试当成原应用整体切换成功。owner 仍需完成最终 Base64 嵌入及应用发布接入。原应用的可选详细链展示和自定义技巧顺序未做集成验收。\n\n历史 CI run 36108090845 的 completed/success 来自交接文件，保留引用于 BUILD.md；本次未重新触发或等待，也不以其替代本地结果。\n\n所有文件仅在当前 Sudoku 工作区及新的交付子目录；没有 push、merge、远端分支修改或 GitHub Actions 操作。\n`);
console.log(JSON.stringify({cases:corpus.length,steps:checked,wasmSha256:hash,bytes:bytes.length,coverage:coverage.registry.length-coverage.notObserved.length}));
