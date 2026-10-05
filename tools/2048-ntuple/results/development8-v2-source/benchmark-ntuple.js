#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{performance}=require('node:perf_hooks');
const {loadModel,NTupleSolver,MODEL_SHA}=require('./ntuple2048.js');
const Game=require('../2048-expectimax/expectimax2048.js');
function parse(args){const o={model:path.join(__dirname,'models/4x6patt.json'),seed:60001,games:1,ply:2,maxSeconds:60,out:null};for(let i=0;i<args.length;i++){const k=args[i],v=args[++i];if(v===undefined)throw new Error('Missing value for '+k);if(k==='--model')o.model=v;else if(k==='--seed')o.seed=Number(v);else if(k==='--games')o.games=Number(v);else if(k==='--ply')o.ply=Number(v);else if(k==='--max-seconds')o.maxSeconds=Number(v);else if(k==='--out')o.out=v;else throw new Error('Unknown argument '+k);}if(!Number.isInteger(o.games)||o.games<1||!Number.isInteger(o.seed)||o.seed<0||o.seed+o.games-1>0xffffffff||!Number.isFinite(o.maxSeconds)||o.maxSeconds<=0)throw new Error('Invalid game/seed/time limits.');return o;}
function main(args){
 const o=parse(args),start=performance.now(),model=loadModel(o.model),solver=new NTupleSolver(model,{ply:o.ply});const fd=o.out?fs.openSync(o.out,'wx'):null;
 const emit=r=>{const s=JSON.stringify(r);console.log(s);if(fd!==null)fs.writeSync(fd,s+'\n');};
 let cpuModel='unavailable';try{cpuModel=os.cpus()[0]?.model||cpuModel;}catch(_){}
 emit({type:'metadata',startedAt:new Date().toISOString(),command:['node','benchmark-ntuple.js',...args],runtime:process.version,platform:process.platform,cpuModel,options:solver.options,modelSha256:model.manifest.inference.sha256,sourceModelSha256:model.manifest.source.sha256,sourceModelRevision:model.manifest.source.revision,solverSha256:crypto.createHash('sha256').update(fs.readFileSync(require.resolve('./ntuple2048.js'))).digest('hex'),seedRange:[o.seed,o.seed+o.games-1],requestedGames:o.games,maxSecondsPerGame:o.maxSeconds,loadMs:performance.now()-start,memoryAfterLoadBytes:process.memoryUsage(),benchmarkSha256:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),semantics:'TD-trained afterstate future-score evaluation; native-style two-ply expected value, no TD training performed locally.'});
 const games=[];
 for(let i=0;i<o.games;i++){
  const seed=o.seed+i,rng=Game.createRng(seed),t0=performance.now(),cpu0=process.cpuUsage();let board=Game.initialBoard(rng),moves=0,score=0,nodes=0,searchMs=0,maxMoveMs=0,outcome='interrupted';const latencies=[],hash=crypto.createHash('sha256');
  while(performance.now()-t0<o.maxSeconds*1000){
   if(Math.max(...board)>=32768){outcome='success';break;}
   const d=solver.chooseMove(board);if(d.direction===null){outcome='loss';break;}
   const m=Game.move(board,d.direction);if(!m.moved)throw new Error('Illegal solver move.');board=m.board;score+=m.score;moves++;nodes+=d.nodes;searchMs+=d.elapsedMs;maxMoveMs=Math.max(maxMoveMs,d.elapsedMs);latencies.push(d.elapsedMs);
   if(Math.max(...board)>=32768){hash.update(JSON.stringify([d.direction,null,null]));outcome='success';break;}
   const spawn=Game.spawn(board,rng);board=spawn.board;hash.update(JSON.stringify([d.direction,spawn.index,spawn.value]));
  }
  const cpu=process.cpuUsage(cpu0);latencies.sort((a,b)=>a-b);const quantile=q=>latencies.length?latencies[Math.min(latencies.length-1,Math.floor(q*latencies.length))]:0;
  const r={type:'game',seed,outcome,success:outcome==='success',maxTile:Math.max(...board),score,moves,nodes,wallSeconds:(performance.now()-t0)/1000,cpuSeconds:(cpu.user+cpu.system)/1e6,searchMs,meanMoveMs:moves?searchMs/moves:0,p50MoveMs:quantile(.5),p95MoveMs:quantile(.95),maxMoveMs,trajectorySha256:hash.digest('hex'),finalBoard:board,memoryAtGameEndBytes:process.memoryUsage(),processPeakRssKiB:process.resourceUsage().maxRSS};games.push(r);emit(r);
  if(outcome==='interrupted'){emit({type:'gate_stop',reason:'Per-game wall-clock pilot limit reached; not a loss. No further games started.'});break;}
 }
 const completed=games.filter(g=>g.outcome!=='interrupted'),successes=completed.filter(g=>g.success).length;
 emit({type:'summary',requestedGames:o.games,started:games.length,completed:completed.length,interrupted:games.length-completed.length,successes,successRate:completed.length?successes/completed.length:null,wallSeconds:(performance.now()-start)/1000,note:'Bounded development/speed pilot. This small sample does not establish a population win rate; interrupted games are not losses.'});if(fd!==null)fs.closeSync(fd);
}
if(require.main===module)main(process.argv.slice(2));module.exports={parse};
