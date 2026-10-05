#!/usr/bin/env node
'use strict';
// Deterministic DOM/clock simulation of the actual uploaded game's script. This is not rendered browser QA.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Adapter=require('./browser-adapter.js');
class Element{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.listeners={};this.children=[];this.style={};this.dataset={};this.attrs={};this.value='';this.textContent='';this.className='';this.clientWidth=500;this.disabled=false;this.hidden=false;this.files=[];
 this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(' '),...names])].join(' ');},remove:(...names)=>{this.className=this.className.split(' ').filter(x=>!names.includes(x)).join(' ');},contains:n=>this.className.split(' ').includes(n)};}
 set innerHTML(v){this.children=[];this._html=v;}get innerHTML(){return this._html||'';}
 appendChild(el){el.parent=this;this.children.push(el);return el;}remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
 addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}removeEventListener(){}
 dispatchEvent(e){for(const fn of this.listeners[e.type]||[])fn(e);}click(){if(!this.disabled)this.dispatchEvent({type:'click'});}
 setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k]??null;}
}
const html=fs.readFileSync(path.join(__dirname,'../drafting-games-1.html'),'utf8'),scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const elements={};for(const m of html.matchAll(/<([a-z]+)[^>]*id="([^"]+)"[^>]*>/g))elements[m[2]]=new Element(m[1]);
elements.engine2048.value='heuristic';elements.panel2048.className='active';elements.hint2048.textContent='手动移动';
const document=new Element();document.getElementById=id=>elements[id];document.createElement=tag=>new Element(tag);
let time=0,nextTimer=0;const timers=new Map();function schedule(fn,ms=0){const id=++nextTimer;timers.set(id,{fn,at:time+ms});return id;}
async function advance(ms){await Promise.resolve();const end=time+ms;for(;;){let next=[...timers.entries()].filter(([id,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();await Promise.resolve();}time=end;await Promise.resolve();}
let state={status:'empty',message:'未加载',progress:0},pending=null,notify,sequence=0;
const fakeClient={get state(){return {...state};},cancel(){if(pending){pending.resolve({cancelled:true});pending=null;}},load(file){this.cancel();state={status:'loading',message:'加载中',progress:0};notify(state);},unload(){this.cancel();state={status:'empty',message:'未加载',progress:0};notify(state);},ask(board){this.cancel();return new Promise(resolve=>{pending={id:++sequence,resolve,board};});}};
const window=new Element(),context=vm.createContext({document,window,console,Math:Object.create(Math),performance:{now:()=>time},getComputedStyle:()=>({getPropertyValue:k=>k==='--pad'?'14':'12'}),ResizeObserver:class{observe(){}},setTimeout:schedule,clearTimeout:id=>timers.delete(id),requestAnimationFrame:fn=>schedule(fn,16),NTupleBrowser:{...Adapter,createClient:opts=>{notify=opts.onState;return fakeClient;}}});
context.Math.random=()=>0.1;
vm.runInContext(scripts[0],context); // Actual shared slider/gesture/layout helpers.
let game=scripts.find(s=>s.includes('  const SIZE = 4;'));
// Fixture setup belongs only to this test context, never to the delivered game/API.
game=game.replace('  window.Drafting2048=Object.freeze({',`  window.Drafting2048=Object.freeze({
 __fixture(board){stopAuto();boardVersion++;clearTimeout(moveTimer);moveCompletion=null;tiles=board.flatMap((v,i)=>v?[{id:nextTileId++,r:i>>2,c:i%4,exp:Math.log2(v)}]:[]);over=false;score=0;stepsPlayed=0;fullRender();syncModelUI();},`);
vm.runInContext(game,context);
const api=window.Drafting2048,snapshot=()=>JSON.parse(JSON.stringify(api.getState()));
function ready(){state={status:'ready',message:'已就绪',progress:1};notify(state);}
function answer(dir,request=pending){assert(request);if(request===pending)pending=null;request.resolve({dir,depth:2,engine:'td8',elapsedMs:1,mode:'worker'});}
(async()=>{
 assert.equal(snapshot().board.filter(Boolean).length,2);
 api.move('left');api.newGame();const reset=snapshot();await advance(500);assert.deepEqual(snapshot(),reset);assert.equal(elements.tiles2048.children.length,2);
 elements.engine2048.value='td8';elements.engine2048.dispatchEvent({type:'change'});assert(elements.playBtn2048.disabled);ready();assert(!elements.playBtn2048.disabled);assert(elements.dynBtn2048.disabled);
 api.start();const old=pending;api.newGame();const fresh=snapshot();answer('right',old);await advance(500);assert.deepEqual(snapshot(),fresh);
 api.start();const oldManual=pending;api.move('right');const manual=snapshot();answer('down',oldManual);await advance(500);assert.deepEqual(snapshot(),manual);
 // One model answer applies one real move and one spawn.
 api.__fixture([2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);api.start();answer('left');await Promise.resolve();api.stop();await advance(500);assert.equal(snapshot().steps,1);assert.equal(snapshot().score,4);assert.equal(snapshot().board.reduce((a,b)=>a+b),6);
 // Rapid manual inputs retain one spawn per moved turn, and old visual completions cannot corrupt state.
 api.newGame();for(const direction of ['left','down','right','up'])api.move(direction);const rapid=snapshot();await advance(500);assert.deepEqual(snapshot(),rapid);
 // Goal success stops TD at32768 and does not stop manual continuation.
 api.__fixture([16384,16384,2,0,0,0,0,0,0,0,0,0,0,0,0,0]);api.start();answer('left');await advance(200);assert(snapshot().board.includes(32768));assert(!snapshot().autoPlaying);assert(elements.playBtn2048.disabled);assert.match(elements.hint2048.textContent,/32768/);assert.match(elements.tally2048.textContent,/自动对局 1 局/);
 api.move('down');await advance(200);assert(snapshot().board.includes(32768));
 // Batch target completion starts a new game once; explicit stop/new game cancels the delayed restart.
 elements.batchBtn2048.click();api.__fixture([16384,16384,2,0,0,0,0,0,0,0,0,0,0,0,0,0]);api.start();answer('left');await advance(200);api.stop();const stopped=snapshot();await advance(2000);assert.deepEqual(snapshot(),stopped);
 api.__fixture([16384,16384,2,0,0,0,0,0,0,0,0,0,0,0,0,0]);api.start();answer('left');await advance(2000);assert(snapshot().autoPlaying);assert.equal(snapshot().steps,0);assert.equal(snapshot().board.filter(Boolean).length,2);api.stop();
 api.start();document.dispatchEvent({type:'panelchange',detail:'panel15'});assert(!snapshot().autoPlaying);assert.equal(fakeClient.state.status,'ready');
 api.start();fakeClient.unload();state={status:'error',message:'worker failed',progress:0};notify(state);assert(!snapshot().autoPlaying);assert(elements.playBtn2048.disabled);
 // A select/keyboard interaction must not move the board.
 const prior=snapshot();document.dispatchEvent({type:'keydown',key:'ArrowDown',target:elements.engine2048,preventDefault(){}});assert.deepEqual(snapshot(),prior);
 api.newGame();document.dispatchEvent({type:'keydown',key:'ArrowRight',target:elements.newGameBtn2048,preventDefault(){}});assert.equal(snapshot().steps,1);await advance(200);
 console.log('PASS: actual HTML DOM/clock simulation: restart animation race, loading gate, TD moves, manual/search cancellation, rapid moves,32768 goal, batch restart/cancel, panel switch, error UI, select keyboard guard.');
})().catch(e=>{console.error(e);process.exitCode=1;});
