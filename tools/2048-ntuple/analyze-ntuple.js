#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const {verifyGame}=require('../2048-expectimax/analyze.js');
const {wilson}=require('../2048-expectimax/benchmark.js');
function analyze(files,protocol){
 if(!files.length)throw new Error('Supply JSONL result files.');
 const games=[],seen=new Set();let completeBatches=true,fingerprint=null,metadata=null;
 for(const file of files){
  const text=fs.readFileSync(file,'utf8');if(!text.endsWith('\n'))throw new Error('Incomplete trailing JSONL write.');const rows=text.trim().split('\n').map(JSON.parse),m=rows[0];
  if(m.type!=='metadata')throw new Error('Missing experiment metadata.');
  const key=JSON.stringify([m.solverSha256,m.modelSha256,m.sourceModelSha256,m.options]);if(fingerprint===null){fingerprint=key;metadata=m;}else if(key!==fingerprint)throw new Error('Cannot mix source, model, or options.');
  if(protocol){
   if(m.solverSha256!==protocol.sourceSha256||m.modelSha256!==protocol.modelSha256||m.benchmarkSha256!==protocol.benchmarkSha256)throw new Error('Source/model/benchmark does not match protocol.');
   for(const[k,v]of Object.entries(protocol.options))if(m.options[k]!==v)throw new Error('Protocol option mismatch: '+k);
   if(m.maxSecondsPerGame!==protocol.maxSecondsPerGame)throw new Error('Protocol runtime-cap mismatch.');
  }
  const batch=rows.filter(r=>r.type==='game'),summary=rows.find(r=>r.type==='summary');completeBatches&&=!!summary;
  if(summary&&batch.length!==summary.started)throw new Error('Batch summary/count mismatch.');
  for(const g of batch){
   if(seen.has(g.seed))throw new Error('Duplicate seed '+g.seed);if(g.seed<m.seedRange[0]||g.seed>m.seedRange[1])throw new Error('Seed outside batch range.');if(protocol&&!protocol.seeds.includes(g.seed))throw new Error('Unregistered seed '+g.seed);
   verifyGame(g.outcome==='interrupted'?Object.assign({},g,{outcome:'censored'}):g,32768);seen.add(g.seed);games.push(g);
  }
 }
 games.sort((a,b)=>a.seed-b.seed);const done=games.filter(g=>g.outcome!=='interrupted'),successes=done.filter(g=>g.success).length,missing=protocol?protocol.seeds.filter(s=>!seen.has(s)):[];
 const totalMoves=games.reduce((s,g)=>s+g.moves,0),searchMs=games.reduce((s,g)=>s+g.searchMs,0),totalSeconds=games.reduce((s,g)=>s+g.wallSeconds,0),interrupted=games.length-done.length;
 return{type:'aggregate',complete:completeBatches&&!missing.length&&!interrupted,protocolRecordedAt:protocol?.recordedAt||null,sourceSha256:metadata.solverSha256,modelSha256:metadata.modelSha256,options:metadata.options,requestedGames:protocol?.games||null,started:games.length,completed:done.length,interrupted,missingSeeds:missing,successes,successRate:done.length?successes/done.length:null,wilson95:wilson(successes,done.length),totalMoves,totalGameWallSeconds:totalSeconds,meanGameWallSeconds:games.length?totalSeconds/games.length:null,weightedMeanMoveMs:totalMoves?searchMs/totalMoves:null,peakProcessRssMiB:games.length?Math.max(...games.map(g=>(g.processPeakRssKiB||0)/1024)):null,maxTileHistogram:games.reduce((h,g)=>(h[g.maxTile]=(h[g.maxTile]||0)+1,h),{}),actualPlyHistogram:games.reduce((h,g)=>{for(const[k,v]of Object.entries(g.actualPlyHistogram||{}))h[k]=(h[k]||0)+v;return h;},{}),validation:'All recorded game outcomes, final boards, seeded spawn mass, and merge-score identities verified independently of search.',note:protocol?'Interpret the proportion together with the confidence interval and completion status.':'Development-only aggregate without an independent evaluation protocol.',perGame:games.map(g=>({seed:g.seed,outcome:g.outcome,maxTile:g.maxTile,score:g.score,moves:g.moves,wallSeconds:g.wallSeconds,trajectorySha256:g.trajectorySha256}))};
}
function main(args){let protocol=null;const files=[];for(let i=0;i<args.length;i++){if(args[i]==='--protocol')protocol=JSON.parse(fs.readFileSync(args[++i],'utf8'));else files.push(args[i]);}console.log(JSON.stringify(analyze(files,protocol),null,2));}
if(require.main===module)main(process.argv.slice(2));module.exports={analyze};
