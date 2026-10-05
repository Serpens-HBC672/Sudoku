#!/usr/bin/env node
'use strict';
// This runs the unchanged browser-worker.js in a Node worker with browser-compatible globals.
// It validates real-file/hash/inference semantics, not browser rendering or file chooser behavior.
const {Worker}=require('node:worker_threads');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const dir=__dirname;
const modelFile=process.argv[2] || path.join(dir,'models/8x6patt.f32');
const manifest=process.argv[3] || path.join(path.dirname(modelFile),'8x6patt.json');
if(!fs.existsSync(modelFile)||!fs.existsSync(manifest)){console.error('Usage: node test-browser-worker.js /path/8x6patt.f32 /path/8x6patt.json');process.exit(1);}
(async()=>{
 const w=new Worker(`const{parentPort}=require('node:worker_threads'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');const base=${JSON.stringify(dir)};const ctx=vm.createContext({console,performance,Blob,ArrayBuffer,Uint8Array,Uint32Array,Float32Array,DataView,setTimeout,clearTimeout});ctx.self=ctx;ctx.postMessage=m=>parentPort.postMessage(m);ctx.importScripts=(...names)=>{for(const name of names)vm.runInContext(fs.readFileSync(path.resolve(base,name),'utf8'),ctx,{filename:name});};ctx.importScripts('browser-worker.js');parentPort.on('message',async m=>{if(m.fileName){m.file=await fs.openAsBlob(m.fileName);delete m.fileName;}ctx.onmessage({data:m});});`,{eval:true});
 let progress=0;const queue=[],waiting=[];w.on('message',m=>{if(m.type==='progress'){progress++;return;}if(waiting.length)waiting.shift()(m);else queue.push(m);});const receive=()=>queue.length?Promise.resolve(queue.shift()):new Promise(r=>waiting.push(r));
 const start=performance.now();w.postMessage({type:'load',id:1,fileName:path.resolve(modelFile)});const loaded=await receive();assert.equal(loaded.type,'ready',JSON.stringify(loaded));assert.equal(loaded.sha256,'4e9342fa525ae41d5268e294f396dd066822cd9df88076b864d35f356f3f3297');
 const loadMs=performance.now()-start;assert.equal(progress,128);
 const N=require(path.join(dir,'ntuple2048.js')),model=N.loadModel(manifest),solver=new N.NTupleSolver(model,{ply:2,target:32768,criticalSearch:true,criticalEmpty:1,criticalTile:8192});
 const boards=[[2,4,8,16,0,2,4,8,0,0,2,4,0,0,0,2],[8192,4096,2048,1024,64,128,256,512,32,16,8,4,2,4,2,0],[16384,16384,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[32768,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[2,4,2,4,4,2,4,2,2,4,2,4,4,2,4,2]];
 for(let i=0;i<boards.length;i++){const expected=solver.chooseMove(boards[i]);w.postMessage({type:'move',id:i+2,board:boards[i]});const actual=await receive();assert.equal(actual.type,'move');for(const key of ['direction','name','value','actualPly','targetReached','nodes'])assert.equal(actual.result[key],expected[key],key);}
 await w.terminate();console.log(JSON.stringify({result:'passed',fullRealModelWorkerLoadMs:loadMs,progressChunks:progress,modelBytes:loaded.bytes,sha256:loaded.sha256,exactNodeParityFixtures:boards.length,environment:'Node worker_threads with browser globals; not a real browser'},null,2));
})().catch(e=>{console.error(e);process.exit(1);});
