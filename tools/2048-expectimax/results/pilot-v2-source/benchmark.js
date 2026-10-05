#!/usr/bin/env node
'use strict';
// Each game has its own RNG. No randomness enters the solver itself.
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const {performance} = require('node:perf_hooks');
const {Solver, initialBoard, createRng, move, spawn} = require('./expectimax2048.js');
function parse(argv) {
  const o = {games: 1, seed: 1, profile: 'balanced', out: '', progress: 1000, maxMoves: 100000, options: {}};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--help') { console.log('node benchmark.js --games 10 --seed 1 --profile strong --out results.jsonl [--nodes 8000000] [--depth 10] [--cutoff 0.00005] [--time-ms 0] [--table-bits 18] [--no-iterative] [--fixed-depth] [--progress 1000] [--max-moves 100000]'); process.exit(0); }
    if (key === '--no-iterative') { o.options.iterative = false; continue; }
    if (key === '--fixed-depth') { o.options.adaptiveDepth = false; continue; }
    const value = argv[++i];
    if (value === undefined) throw new Error('Missing value for ' + key);
    const ints = {'--games':'games','--seed':'seed','--progress':'progress','--max-moves':'maxMoves'};
    const keys = {'--nodes':'nodeBudget','--depth':'maxDepth','--cutoff':'probabilityCutoff','--time-ms':'timeBudgetMs','--table-bits':'tableBits'};
    if (ints[key]) o[ints[key]] = Number(value);
    else if (keys[key]) o.options[keys[key]] = Number(value);
    else if (key === '--profile') o.profile = value;
    else if (key === '--out') o.out = value;
    else throw new Error('Unknown argument ' + key);
  }
  for (const k of ['games','seed','progress','maxMoves']) if (!Number.isInteger(o[k]) || o[k] < (k === 'seed' || k === 'progress' ? 0 : 1)) throw new Error(k + ' must be a suitable nonnegative integer.');
  if (o.seed + o.games - 1 > 0xffffffff) throw new Error('Seed range must fit uint32.');
  return o;
}
function wilson(successes, total) {
  if (!total) return [null, null];
  const z = 1.959963984540054, p = successes / total, d = 1 + z * z / total;
  const c = (p + z * z / (2 * total)) / d;
  const h = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / d;
  return [Math.max(0,c-h), Math.min(1,c+h)];
}
function main() {
  const args = parse(process.argv.slice(2));
  const solver = new Solver(Object.assign({profile: args.profile}, args.options));
  let fd = null;
  if (args.out) fd = fs.openSync(args.out, 'wx'); // Never silently overwrite an experiment.
  const emit = data => { const line = JSON.stringify(data); console.log(line); if (fd !== null) fs.writeSync(fd, line + '\n'); };
  let cpuModel = 'unavailable'; try { cpuModel = os.cpus()[0]?.model || cpuModel; } catch (_) {}
  const start = performance.now();
  emit({type:'metadata', schema:1, startedAt:new Date().toISOString(), command:process.argv, runtime:process.version, platform:process.platform, architecture:process.arch, cpuModel, cpuParallelism:os.availableParallelism(), options:solver.options, rules:{size:4, initialTiles:2, spawn2:0.9, spawn4:0.1, emptyCell:'uniform', spawnOnlyAfterChangedMove:true, target:32768}, seedRange:[args.seed,args.seed+args.games-1], requestedGames:args.games,maxMoves:args.maxMoves, solverSha256:crypto.createHash('sha256').update(fs.readFileSync(require.resolve('./expectimax2048.js'))).digest('hex')});
  const results = [];
  for (let game = 0; game < args.games; game++) {
    const seed = args.seed + game, rng = createRng(seed), gameStart = performance.now();
    const cpuStart = process.cpuUsage(); let board = initialBoard(rng), score = 0, moves = 0, nodes = 0, cacheHits = 0, truncatedMoves = 0, depthSum = 0, searchMs = 0, worstMoveMs = 0;
    const latencies = [], depthHistogram = {}, hash = crypto.createHash('sha256');
    let outcome = 'censored', maxTile = Math.max(...board);
    while (moves < args.maxMoves) {
      if (maxTile >= solver.options.target) { outcome='success'; break; }
      const decision = solver.chooseMove(board);
      if (decision.direction === null) { outcome='loss'; break; }
      const moved = move(board,decision.direction);
      if (!moved.moved) throw new Error('Solver selected illegal move at seed ' + seed + ', move ' + moves);
      score += moved.score; board=moved.board; moves++;
      nodes += decision.nodes; cacheHits += decision.cacheHits; truncatedMoves += +!decision.complete;
      depthSum += decision.depth; depthHistogram[decision.depth]=(depthHistogram[decision.depth]||0)+1;
      searchMs+=decision.elapsedMs; worstMoveMs=Math.max(worstMoveMs,decision.elapsedMs); latencies.push(decision.elapsedMs);
      maxTile=Math.max(...board);
      // Stop before spawning on first target achievement; this cannot alter success.
      if (maxTile >= solver.options.target) { hash.update(JSON.stringify([decision.direction,null,null])); outcome='success'; break; }
      const spawned=spawn(board,rng); if (!spawned) throw new Error('Changed move failed to free a spawn square.');
      board=spawned.board; hash.update(JSON.stringify([decision.direction,spawned.index,spawned.value]));
      if (args.progress && moves % args.progress === 0) console.error(JSON.stringify({type:'progress',seed,moves,maxTile,score,seconds:+((performance.now()-gameStart)/1000).toFixed(1),meanDepth:+(depthSum/moves).toFixed(2),truncatedMoves}));
    }
    const cpu=process.cpuUsage(cpuStart); latencies.sort((a,b)=>a-b);
    const quantile=q=>latencies.length?latencies[Math.min(latencies.length-1,Math.floor(q*latencies.length))]:0;
    const result={type:'game',seed,outcome,success:outcome==='success',maxTile,score,moves,wallSeconds:(performance.now()-gameStart)/1000,cpuSeconds:(cpu.user+cpu.system)/1e6,nodes,cacheHits,searchMs,meanMoveMs:moves?searchMs/moves:0,p50MoveMs:quantile(.5),p95MoveMs:quantile(.95),maxMoveMs:worstMoveMs,meanDepth:moves?depthSum/moves:0,depthHistogram,truncatedMoves,trajectorySha256:hash.digest('hex'),finalBoard:board};
    results.push(result); emit(result);
  }
  const completed=results.filter(r=>r.outcome!=='censored'),successes=completed.filter(r=>r.success).length;
  const summary={type:'summary',games:results.length,completed:completed.length,censored:results.length-completed.length,successes,successRate:completed.length?successes/completed.length:null,wilson95:wilson(successes,completed.length),wallSeconds:(performance.now()-start)/1000,meanScore:results.reduce((s,r)=>s+r.score,0)/results.length,meanMoves:results.reduce((s,r)=>s+r.moves,0)/results.length,totalMoves:results.reduce((s,r)=>s+r.moves,0),totalNodes:results.reduce((s,r)=>s+r.nodes,0),maxTileHistogram:results.reduce((h,r)=>(h[r.maxTile]=(h[r.maxTile]||0)+1,h),{}),note:results.some(r=>r.outcome==='censored')?'Censored games excluded from completed-game rate; this is not an unbiased full-game success estimate.':'All requested games completed. A point estimate alone is not proof of a population success probability.'};
  emit(summary); if(fd!==null)fs.closeSync(fd);
}
if(require.main===module)main();
module.exports={wilson,parse};
