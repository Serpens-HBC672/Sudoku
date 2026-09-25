import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {instantiateCore,loadPosition,loadGivenGrid,materializeTechniqueFinding} from '../bridge/assembly-core.mjs';
import {loadOracle} from '../tests/load-oracle.mjs';
import {loadBenchmarkCorpus} from '../tests/benchmark-corpus.mjs';
const bytes=new Uint8Array(await readFile(new URL('../build/sudoku-techniques.wasm',import.meta.url)));
const start=performance.now(), core=await instantiateCore(bytes), initializationMs=performance.now()-start;
const oracle=await loadOracle(), corpus=await loadBenchmarkCorpus(), registry=oracle.techniqueKeys();
const clone=x=>JSON.parse(JSON.stringify(x));
const report={node:process.version,cpu:os.cpus()[0].model,platform:process.platform,budget:6790,initializationMs,wasmSha256:createHash('sha256').update(bytes).digest('hex'),methodology:'One observed positive state per workload, same individual technique JS/WASM, one untimed warmup and three timed repetitions, parity checked outside timers. Not full-solve or coarse-dispatch speedup. Input preparation includes grid/mask allocation, copy and givens. JS includes oracle normalization and solution validation.',cases:[]};
await mkdir('evidence/performance',{recursive:true});
for(const [caseId,key] of [[57,'nakedSingle'],[11,'lockedCandidate'],[22,'dynamicNishioChain'],[23,'dynamicNishioChain'],[56,'dynamicUnaryChain'],[27,'msls'],[42,'juniorExocet']]) {
  const test=corpus.find(x=>x.id===caseId);
  const {trace}=JSON.parse(await readFile('evidence/full-trace/oracle-'+caseId+'.json','utf8'));
  const step=trace.trace.find(s=>s.finding.technique===key);
  assert.ok(step,'positive observed hotspot required: '+caseId+' '+key);
  const id=registry.indexOf(key);
  const samples=[];
  for(let repeat=-1;repeat<3;repeat++) {
    let t=performance.now();
    const grid=Array.from({length:9},(_,r)=>Array.from({length:9},(_,c)=>Number(step.beforeGrid[r*9+c])));
    const masks=Array.from(step.beforeMasks,Number);
    loadPosition(core,grid,masks);loadGivenGrid(core,test.puzzle);
    const inputMs=performance.now()-t;
    t=performance.now();
    if(id===50) core.runDynamicNishioFinder(6790);
    else if(id===51) core.runDynamicUnaryFinder(6790);
    else if(id===47) core.runMslsFinder();
    else if(id===48) core.runJuniorExocetFinder();
    else core.runStandaloneTechniqueFinder(id);
    const executionMs=performance.now()-t;
    t=performance.now();const wasm=materializeTechniqueFinding(core,id,6790);const findingMs=performance.now()-t;
    t=performance.now();const js=oracle.findTechniqueFromMasks(key,grid,masks,test.puzzle,test.solution);const jsMs=performance.now()-t;
    assert.deepEqual(wasm,clone(js));assert.deepEqual(wasm,step.finding);assert.ok(wasm);
    if(repeat>=0)samples.push({inputMs,executionMs,findingMs,endToEndMs:inputMs+executionMs+findingMs,jsMs});
  }
  const median={};
  for(const k of Object.keys(samples[0]))median[k]=samples.map(x=>x[k]).sort((a,b)=>a-b)[1];
  const entry={caseId,key,step:step.step,beforeGrid:step.beforeGrid,beforeMasks:step.beforeMasks,samples,median,speedup:median.jsMs/median.endToEndMs};
  report.cases.push(entry);
  await writeFile('evidence/performance/results.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({caseId,key,median,speedup:entry.speedup}));
}
