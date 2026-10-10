'use strict';
// Experiment reproduction wrapper. Source is extracted from pinned HTML by prepare-source.cjs.
// Publication packaging changes module paths only; search algorithms are unchanged.
const fs = require('node:fs'), path = require('node:path');
const {performance} = require('node:perf_hooks');
const worker = fs.readFileSync(path.join(__dirname,'generated/embedded-worker.js'),'utf8');
const divider = worker.indexOf('/* MIT License. N-tuple');
const endTD = worker.indexOf('/* MIT. Incremental SHA-256');
function build({extended=false}={}) {
  // Same extracted algorithms in the normal CommonJS realm; avoids VM global lookup overhead.
  return {
    Game:require('./generated/2048-expectimax/expectimax2048.js'),
    TD:require(extended?'./generated/2048-ntuple/ntuple2048-depth-experiment.js':'./generated/2048-ntuple/ntuple2048.js'),
    AI:require('./generated/heuristic2048.js')
  };
}
function pack5(board) { const rows=[0,0,0,0];board.forEach((v,i)=>{rows[i>>>2]|=(v?Math.log2(v):0)<<((i&3)*5);});return rows; }
function unpack5(rows) { return Array.from({length:16},(_,i)=>{const r=(rows[i>>>2]>>>((i&3)*5))&31;return r?2**r:0;}); }
function loadWeights(TD,file) {
  // Use the unmodified built-in Node model loader and its required integrity check.
  const spec=TD.MODEL_CATALOG['8x6'];
  const manifest={format:'tdl2048-8x6-f32le-v1',source:{sha256:spec.sourceSha256},inference:{sha256:spec.sha256,bytes:spec.bytes,file:path.resolve(file)}};
  const manifestFile=path.join(__dirname,'local-model-manifest-'+process.pid+'.json');
  fs.writeFileSync(manifestFile,JSON.stringify(manifest));
  try { return TD.loadModel(manifestFile); } finally { fs.unlinkSync(manifestFile); }
}
function pilot(args) {
  const o={model:null,mode:'selective',seed:62001,games:1,maxSeconds:30,maxMoves:2000,handoffMs:200,out:null,resume:null};
  for(let i=0;i<args.length;i+=2){const k=args[i].slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());if(!(k in o)||args[i+1]===undefined)throw new Error('Unknown/missing argument '+args[i]);o[k]=typeof o[k]==='number'?Number(args[i+1]):args[i+1];}
  if(!o.model)throw new Error('--model requires the actual pinned 8x6patt.f32; no synthetic pilot');
  if(!['1','2','3','4','selective'].includes(o.mode)||!Number.isInteger(o.games)||o.games<1||o.games>10||!Number.isInteger(o.seed)||o.seed<0||o.seed+o.games-1>0xffffffff||!Number.isFinite(o.maxSeconds)||o.maxSeconds<=0||o.maxSeconds>3600||!Number.isInteger(o.maxMoves)||o.maxMoves<1||!Number.isFinite(o.handoffMs)||o.handoffMs<200)throw new Error('Invalid bounded pilot options');
  const {Game,TD,AI}=build({extended:['3','4'].includes(o.mode)}),start=performance.now(),model=loadWeights(TD,o.model);
  const solver=new TD.NTupleSolver(model,{ply:o.mode==='selective'?2:Number(o.mode),target:65536,criticalSearch:o.mode==='selective',criticalEmpty:1,criticalTile:8192});
  const fd=o.out?fs.openSync(o.out,'wx'):null,emit=r=>{const s=JSON.stringify(r);console.log(s);if(fd!==null)fs.writeSync(fd,s+'\n');};
  emit({type:'metadata',sourceCommit:'8b5a41f33a14a3132543658e32135dcfc4ab5cc4',runtime:process.version,options:o,solverOptions:solver.options,depthExtension:['3','4'].includes(o.mode)?'Constructor whitelist only; same recursion':null,loadMs:performance.now()-start,memory:process.memoryUsage(),cpu:require('node:os').cpus()[0].model,semantics:'TD until second 32768; original 5-bit heuristic after handoff; stop at first 65536. Mixed policy.'});
  const restore=o.resume?JSON.parse(fs.readFileSync(o.resume,'utf8')):null;
  if(restore&&(restore.mode!==o.mode||restore.handoffMs!==o.handoffMs||o.games!==1))throw new Error('Resume requires the same mode/budget and --games 1');
  for(let g=0;g<o.games;g++) {
    const seed=restore?restore.seed:o.seed+g;let rngCalls=0;const raw=Game.createRng(seed),rng=()=>{rngCalls++;return raw();};
    if(restore)for(let i=0;i<restore.rngCalls;i++)rng();
    let board=restore?restore.board:Game.initialBoard(rng),moves=restore?restore.moves:0,score=restore?restore.score:0,events=restore?restore.events:[],heuristic=null;
    const directions=[]; const t0=performance.now(),cpu0=process.cpuUsage(),cost={td:[],heuristic:[]},hist={},nodes={td:0,heuristic:0};let outcome='interrupted',movesThisRun=0;
    const observe=()=>{for(const [name,hit] of [['first32768',board.some(v=>v>=32768)],['second32768',board.filter(v=>v===32768).length>=2],['first65536',board.some(v=>v>=65536)]])if(hit&&!events.some(e=>e.name===name)){const e={name,moves,score,board:board.slice()};events.push(e);emit({type:'event',seed,...e});}};
    observe();
    while(performance.now()-t0<o.maxSeconds*1000&&movesThisRun<o.maxMoves) {
      if(Math.max(...board)>=65536){outcome='success';break;}
      const handoff=board.filter(v=>v===32768).length>=2;
      let d,engine=handoff?'heuristic':'td',r,ts=performance.now();
      if(handoff){if(!heuristic){const init=performance.now();heuristic=AI({tableBits:18});emit({type:'handoff',seed,moves,score,board:board.slice(),buildMs:performance.now()-init,budgetMs:o.handoffMs});}r=heuristic.bestMove(pack5(board),o.handoffMs);d=r.dir;}
      else {r=solver.chooseMove(board);d=r.direction;hist[r.actualPly]=(hist[r.actualPly]||0)+1;}
      cost[engine].push(performance.now()-ts);nodes[engine]+=r.nodes;
      if(d===null){outcome='loss';break;}
      directions.push(typeof d==='string'?Game.DIRECTIONS.indexOf(d):d); const m=Game.move(board,d);if(!m.moved)throw new Error('Illegal move');board=m.board;score+=m.score;moves++;movesThisRun++;observe();
      if(Math.max(...board)>=65536){outcome='success';break;}
      board=Game.spawn(board,rng).board;
    }
    const quant=a=>{a.sort((x,y)=>x-y);return {decisions:a.length,totalMs:a.reduce((x,y)=>x+y,0),meanMs:a.length?a.reduce((x,y)=>x+y,0)/a.length:0,p50Ms:a[Math.floor(a.length*.5)]||0,p95Ms:a[Math.floor(a.length*.95)]||0,maxMs:a.at(-1)||0};};
    if(o.out)fs.writeFileSync(o.out+'.moves.txt',directions.join('')); const cpu=process.cpuUsage(cpu0),checkpoint={seed,rngCalls,board,moves,score,events,mode:o.mode,handoffMs:o.handoffMs};
    if(outcome==='interrupted'&&o.out)fs.writeFileSync(o.out+'.checkpoint.json',JSON.stringify(checkpoint,null,2));
    emit({type:'game',seed,outcome,stopReason:outcome==='success'?'target_65536':outcome==='loss'?'no_legal_moves':movesThisRun>=o.maxMoves?'move_cap':'time_cap',censored:outcome==='interrupted',handedOff:events.some(e=>e.name==='second32768'),moves,movesThisRun,score,maxTile:Math.max(...board),events,wallSeconds:(performance.now()-t0)/1000,cpuSeconds:(cpu.user+cpu.system)/1e6,cost:{td:quant(cost.td),heuristic:quant(cost.heuristic)},nodes,actualPlyHistogram:hist,memory:process.memoryUsage(),peakRssKiB:process.resourceUsage().maxRSS,finalBoard:board,rngCalls});
    if(outcome==='interrupted')break;
  }
  if(fd!==null)fs.closeSync(fd);
}
if(require.main===module)pilot(process.argv.slice(2));
module.exports={build,pack5,unpack5,worker,loadWeights};
