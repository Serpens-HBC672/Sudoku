#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const Adapter=require('./browser-adapter.js'),SHA256=require('./browser-sha256.js'),Game=require('../2048-expectimax/expectimax2048.js');
const html=fs.readFileSync(path.join(__dirname,'../drafting-games-1.html'),'utf8');
const logic=html.slice(html.indexOf('  function linesFor(dir){'),html.indexOf('  // Game state + rendering'));
const context=vm.createContext({});vm.runInContext(logic+';globalThis.apply=applyRealMove;',context);
let checks=0;
function tilesFromBoard(board){return board.flatMap((v,i)=>v?[{id:i+1,r:i>>>2,c:i%4,exp:Math.log2(v)}]:[]);}
for(const len of [0,1,3,55,56,63,64,65,127,128,1000,1000000]){
  const bytes=Buffer.alloc(len);for(let i=0;i<len;i++)bytes[i]=(i*137+11)%256;
  const expected=crypto.createHash('sha256').update(bytes).digest('hex');
  for(const step of [1,7,64,1000]){const hash=new SHA256();for(let i=0;i<len;i+=step)hash.update(bytes.subarray(i,i+step));assert.equal(hash.hex(),expected);checks++;}
}
const random=Game.createRng(7182);
for(let fixture=0;fixture<200;fixture++){
  const board=Array.from({length:16},()=>{const n=Math.floor(random()*15);return n<4?0:2**(n-3);});
  const tiles=tilesFromBoard(board);assert.deepEqual(Adapter.boardFromTiles(tiles),board);
  for(let d=0;d<4;d++){
    let id=100;const actual=context.apply(tiles,Adapter.directionName(d),()=>++id),expected=Game.move(board,d);
    assert.deepEqual(Adapter.boardFromTiles(actual.resultTiles),expected.board);assert.equal(actual.gained,expected.score);assert.equal(actual.moved,expected.moved);checks++;
  }
}
assert.throws(()=>Adapter.boardFromTiles([{r:0,c:0,exp:0}]));
assert.throws(()=>Adapter.boardFromTiles([{r:0,c:0,exp:1},{r:0,c:0,exp:2}]));
assert.throws(()=>Adapter.directionName(4));assert.equal(Adapter.directionName(null),null);
class FakeWorker{constructor(){this.messages=[];this.terminated=false;}postMessage(m){this.messages.push(m);}terminate(){this.terminated=true;}emit(m){this.onmessage({data:m});}}
(async()=>{
  const workers=[],states=[];const client=Adapter.createClient({createWorker:()=>{const w=new FakeWorker();workers.push(w);return w;},onState:s=>states.push(s)});
  client.load({size:4});assert.equal(client.state.status,'error');assert.equal(workers.length,0);
  client.load({size:536870912});let w=workers.at(-1),load=w.messages[0];assert.equal(client.state.status,'loading');
  w.emit({type:'progress',id:load.id,progress:0.5});assert.equal(client.state.progress,0.5);
  w.emit({type:'ready',id:load.id});assert.equal(client.state.status,'ready');
  const board=new Array(16).fill(0);board[0]=2;
  const first=client.ask(board),old=w.messages.at(-1);client.cancel();assert.deepEqual(await first,{cancelled:true});
  const next=client.ask(board),request=w.messages.at(-1);w.emit({type:'move',id:old.id,result:{direction:3,actualPly:2}});
  w.emit({type:'move',id:request.id,result:{direction:1,actualPly:3}});assert.equal((await next).dir,'right');
  const pending=client.ask(board);client.load({size:536870912});assert.deepEqual(await pending,{cancelled:true});assert(w.terminated);
  w.emit({type:'ready',id:load.id});assert.equal(client.state.status,'loading');
  w=workers.at(-1);load=w.messages[0];w.emit({type:'error',id:load.id,message:'SHA mismatch'});assert.equal(client.state.status,'error');assert(w.terminated);
  client.unload();assert.equal(client.state.status,'empty');
  const unavailable=Adapter.createClient({createWorker:()=>{throw Error('unavailable');}});unavailable.load({size:536870912});assert.equal(unavailable.state.status,'error');unavailable.unload();
  assert.deepEqual(Object.keys(request).sort(),['board','id','type']);assert.deepEqual(request.board,board);
  console.log('PASS: '+checks+' SHA/direction/move checks; exponent conversion; file validation; Worker ready/error/unavailable; cancel/reload/stale responses; current-board-only message contract.');
})().catch(error=>{console.error(error);process.exitCode=1;});
