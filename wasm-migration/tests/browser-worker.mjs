// Usage: node tests/browser-worker.mjs <absolute path to playwright/index.mjs>
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, sep } from 'node:path';
import assert from 'node:assert/strict';
import { loadOracle } from './load-oracle.mjs';
import { loadBenchmarkCorpus } from './benchmark-corpus.mjs';
const {chromium} = await import(pathToFileURL(resolve(process.argv[2])).href);
const root = fileURLToPath(new URL('../',import.meta.url));
const server = createServer(async(req,res) => {
  try {
    if(req.url === '/') { res.setHeader('Content-Type','text/html'); res.end('<title>WASM Worker acceptance</title>'); return; }
    const file = resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(!file.startsWith(root)) throw Error('outside root');
    res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':'text/javascript');
    res.end(await readFile(file));
  } catch {res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:'+server.address().port);
  const entry = (await loadBenchmarkCorpus()).find(x=>x.id===22);
  const oracle = await loadOracle();
  const report = await page.evaluate(async({grid,masks}) => {
    const a = await import('/bridge/sudoku-wasm-adapter.js');
    const {exocetFindingMatchesSolution} = await import('/bridge/finding-validator.js');
    const bytes = new Uint8Array(await (await fetch('/build/sudoku-techniques.wasm')).arrayBuffer());
    const core = await a.instantiateCore(bytes);
    a.loadPosition(core,grid,masks); a.loadGivenGrid(core,grid);
    const worker = new Worker('/bridge/sudoku-wasm-worker.js',{type:'module'});
    let id=0;
    const call = data => new Promise((resolve,reject) => {
      const n=++id;
      const handler=e=>{if(e.data.id!==n)return;worker.removeEventListener('message',handler);e.data.ok?resolve(e.data):reject(Error(e.data.error));};
      worker.addEventListener('message',handler);worker.postMessage({id:n,...data});
    });
    try {
      await call({type:'init',wasm:bytes});
      await call({type:'loadPosition',grid,masks,givenGrid:grid});
      const pairs=[];
      for(let i=0;i<2;i++) {
        pairs.push([a.findAllAvailableStepsWasm(core,{budgetLimit:64}),(await call({type:'findAll',budgetLimit:64})).findings]);
        pairs.push([a.findNextStepWasm(core,{budgetLimit:64}),(await call({type:'findNext',budgetLimit:64})).finding]);
      }
      const positive=pairs[0][0].find(f=>f.technique==='juniorExocet');
      if(!positive)throw Error('expected positive Exocet');
      const solution=Array.from({length:9},()=>Array(9).fill(0));
      const eliminated=positive.eliminations[0];
      solution[eliminated.r][eliminated.c]=eliminated.digit;
      await call({type:'loadPosition',grid,masks,givenGrid:grid,solution});
      const options={budgetLimit:64,validator:f=>exocetFindingMatchesSolution(f,solution)};
      const filtered=[a.findAllAvailableStepsWasm(core,options),(await call({type:'findAll',budgetLimit:64})).findings];
      const next=[a.findNextStepWasm(core,options),(await call({type:'findNext',budgetLimit:64})).finding];
      return {userAgent:navigator.userAgent,budget:64,scope:'bounded smoke; real browser module Worker; benchmark 22',pairs,filtered,next};
    } finally {worker.terminate();}
  },{grid:entry.puzzle,masks:Array.from(oracle.candidateMasksForGrid(entry.puzzle),Number)});
  for(const [main,worker] of report.pairs) {assert.ok(main);assert.deepEqual(main,worker);}
  assert.ok(report.pairs[0][0].length>0);
  assert.deepEqual(...report.filtered);assert.deepEqual(...report.next);
  assert.ok(report.filtered[0].length<report.pairs[0][0].length,'solution validator must reject positive Exocet');
  await writeFile(new URL('../evidence/browser-worker.json',import.meta.url),JSON.stringify(report,null,2));
  console.log('PASS real Edge main/module-Worker parity; budget 64 smoke');
} finally {await browser.close(); await new Promise(r=>server.close(r));}
