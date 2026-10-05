#!/usr/bin/env node
'use strict';
// Aggregate a frozen experiment only when source/options/seeds match its protocol.
const fs = require('node:fs');
const {createRng, move} = require('./expectimax2048.js');
const {wilson} = require('./benchmark.js');
function verifyGame(game, target) {
  if (!Number.isInteger(game.seed) || !Number.isInteger(game.moves) || game.moves < 0) throw new Error('Invalid game seed or move count.');
  if (!['success','loss','censored'].includes(game.outcome)) throw new Error('Unknown game outcome.');
  if (!Array.isArray(game.finalBoard) || game.finalBoard.length !== 16) throw new Error('Missing final board.');
  move(game.finalBoard, 0); // Reuse public input validation, regardless of outcome.
  const maximum = Math.max(...game.finalBoard);
  if (maximum !== game.maxTile || (game.outcome === 'success') !== (maximum >= target)) throw new Error('Outcome / maximum-tile inconsistency for seed ' + game.seed);
  if (game.success !== (game.outcome === 'success')) throw new Error('Success flag inconsistent with outcome.');
  if (game.outcome === 'loss' && [0,1,2,3].some(d => move(game.finalBoard,d).moved)) throw new Error('Reported loss still has a legal move at seed ' + game.seed);
  // Independent conservation check: move operations conserve tile mass.
  // RNG consumes position then tile value; value stream is replayable without AI.
  const rng = createRng(game.seed);
  const spawns = 2 + game.moves - (game.outcome === 'success' && game.moves > 0 ? 1 : 0);
  let mass = 0, fours = 0;
  for (let i = 0; i < spawns; i++) { rng(); const value = rng() < 0.9 ? 2 : 4; mass += value; fours += +(value === 4); }
  if (game.finalBoard.reduce((s,v)=>s+v,0) !== mass) throw new Error('Spawn / board mass mismatch at seed ' + game.seed);
  const score = game.finalBoard.reduce((s,v)=>s+(v ? v * (Math.log2(v)-1) : 0),0) - 4*fours;
  if (score !== game.score) throw new Error('Independent score identity failed at seed ' + game.seed);
}
function analyze(files, protocol) {
  if (!files.length) throw new Error('Provide at least one JSONL file.');
  const games = [], seen = new Set(), sourceHashes = new Set();
  let batchesComplete = true, firstOptions = null;
  for (const file of files) {
    const data = fs.readFileSync(file,'utf8');
    if (data && !data.endsWith('\n')) throw new Error('JSONL ends in an incomplete write: ' + file);
    const rows = data.split('\n').filter(Boolean).map(line=>JSON.parse(line));
    const metadata = rows.filter(r=>r.type==='metadata');
    if (metadata.length !== 1) throw new Error('Expected exactly one metadata record in ' + file);
    const m=metadata[0]; sourceHashes.add(m.solverSha256);
    const optionFingerprint = JSON.stringify(Object.keys(m.options).sort().map(k=>[k,m.options[k]]));
    if (firstOptions === null) firstOptions = optionFingerprint;
    else if (optionFingerprint !== firstOptions) throw new Error('Cannot aggregate different solver configurations.');
    if (protocol) {
      if (m.solverSha256 !== protocol.sourceSha256) throw new Error('Wrong solver version in ' + file);
      for (const [key,value] of Object.entries(protocol.options)) if (m.options[key] !== value) throw new Error('Option mismatch: ' + key + ' in ' + file);
      if (m.maxMoves !== protocol.maxMoves) throw new Error('Move-limit mismatch in ' + file);
    }
    const fileGames = rows.filter(r=>r.type==='game');
    const summaries = rows.filter(r=>r.type==='summary');
    if (summaries.length > 1) throw new Error('Duplicate batch summary in ' + file);
    const complete=summaries.length===1;
    batchesComplete &&= complete;
    if (complete && fileGames.length !== m.requestedGames) throw new Error('Completed batch has wrong game count.');
    for (const game of fileGames) {
      if (seen.has(game.seed)) throw new Error('Duplicate seed ' + game.seed);
      if (game.seed < m.seedRange[0] || game.seed > m.seedRange[1]) throw new Error('Game outside declared batch seed range.');
      if (protocol && !protocol.seeds.includes(game.seed)) throw new Error('Unregistered seed ' + game.seed);
      verifyGame(game,m.options.target); seen.add(game.seed); games.push(game);
    }
  }
  if (sourceHashes.size !== 1) throw new Error('Cannot aggregate different solver versions.');
  games.sort((a,b)=>a.seed-b.seed);
  const completed=games.filter(g=>g.outcome!=='censored'), successes=completed.filter(g=>g.success).length;
  const missingSeeds=protocol?protocol.seeds.filter(seed=>!seen.has(seed)):[];
  const complete=batchesComplete && missingSeeds.length===0 && completed.length===games.length;
  const totalMoves=games.reduce((s,g)=>s+g.moves,0), totalSearchMs=games.reduce((s,g)=>s+g.searchMs,0);
  const result={type:'aggregate',protocolRecordedAt:protocol?.recordedAt||null,sourceSha256:[...sourceHashes][0],complete,expectedGames:protocol?.games||null,games:games.length,completed:completed.length,censored:games.length-completed.length,missingSeeds,successes,successRate:completed.length?successes/completed.length:null,wilson95:wilson(successes,completed.length),totalMoves,totalNodes:games.reduce((s,g)=>s+g.nodes,0),totalGameWallSeconds:games.reduce((s,g)=>s+g.wallSeconds,0),totalCpuSeconds:games.reduce((s,g)=>s+g.cpuSeconds,0),weightedMeanMoveMs:totalMoves?totalSearchMs/totalMoves:null,maxTileHistogram:games.reduce((h,g)=>(h[g.maxTile]=(h[g.maxTile]||0)+1,h),{}),validation:'Each final board, terminal state, seeded spawn mass, and score identity checked independently of the search.',note:complete?(protocol?'All registered games completed. Interpret the estimate together with its uncertainty.':'All supplied batches completed. No preregistration protocol supplied; do not infer independent holdout status.'):'Partial or censored results: do not treat this as the completed preregistered estimate.',perGame:games.map(g=>({seed:g.seed,outcome:g.outcome,maxTile:g.maxTile,score:g.score,moves:g.moves,wallSeconds:g.wallSeconds,trajectorySha256:g.trajectorySha256}))};
  return result;
}
function main(argv) {
  const files=[];let protocol=null;
  for(let i=0;i<argv.length;i++) {
    if(argv[i]==='--protocol') { if(!argv[i+1])throw new Error('Missing protocol filename.');protocol=JSON.parse(fs.readFileSync(argv[++i],'utf8')); }
    else files.push(argv[i]);
  }
  console.log(JSON.stringify(analyze(files,protocol),null,2));
}
if(require.main===module)main(process.argv.slice(2));
module.exports={analyze,verifyGame};
