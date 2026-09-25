import {readFile,writeFile} from 'node:fs/promises';
import {loadOracle} from '../tests/load-oracle.mjs';
import {loadBenchmarkCorpus} from '../tests/benchmark-corpus.mjs';
const oracle=await loadOracle(), corpus=await loadBenchmarkCorpus(), registry=Array.from(oracle.techniqueKeys());
const first=new Set(),available=new Set(),cases=[];
for(const entry of corpus){
  const record=JSON.parse(await readFile('evidence/full-trace/case-'+entry.id+'.json','utf8'));
  if(record.status!=='PASS')throw Error('missing pass '+entry.id);
  const {trace}=JSON.parse(await readFile('evidence/full-trace/oracle-'+entry.id+'.json','utf8'));
  for(const step of trace.trace)first.add(step.finding.technique);
  if([11,34,47,53,57].includes(entry.id)){
    const step=trace.trace[0];
    const grid=Array.from({length:9},(_,r)=>Array.from({length:9},(_,c)=>Number(step.beforeGrid[r*9+c])));
    const findings=oracle.enumerateAvailableFromMasks(grid,step.beforeMasks,entry.puzzle,entry.solution);
    for(const f of findings)available.add(f.technique);
    cases.push({id:entry.id,step:step.step,findings});
  }
}
const union=new Set([...first,...available]);
const report={registry,firstMatch:registry.filter(k=>first.has(k)),allAvailable:registry.filter(k=>available.has(k)),notObserved:registry.filter(k=>!union.has(k)),cases,policy:'57 hash-validated complete traces, all-available at first state of 11,34,47,53,57'};
await writeFile('evidence/coverage.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({registry:registry.length,first:first.size,all:available.size,union:union.size,notObserved:report.notObserved}));
