#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {analyze,verifyGame}=require('./analyze.js');
const A=require('./expectimax2048.js');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'expectimax-analyze-test-'));
let passed=0;
function check(name,fn){fn();passed++;console.log('PASS '+name);}
function game(seed,target=128,cap=2000){
  const rng=A.createRng(seed),policyRng=A.createRng(seed+123),start=A.initialBoard(rng);let board=start,moves=0,score=0,outcome='censored';
  while(moves<cap){
    if(Math.max(...board)>=target){outcome='success';break;}
    const legal=[0,1,2,3].map(d=>A.move(board,d)).filter(m=>m.moved);
    if(!legal.length){outcome='loss';break;}
    const action=legal[Math.floor(policyRng()*legal.length)];board=action.board;score+=action.score;moves++;
    if(Math.max(...board)>=target){outcome='success';break;}
    board=A.spawn(board,rng).board;
  }
  return {type:'game',seed,outcome,success:outcome==='success',maxTile:Math.max(...board),score,moves,finalBoard:board,searchMs:0,nodes:0,wallSeconds:0,cpuSeconds:0,trajectorySha256:'fixture-not-a-search-trajectory'};
}
function batch(filename,games,{finished=true,source='fixture-v1',target=128,nodeBudget=10}={}){
  const options={target,nodeBudget};
  const rows=[{type:'metadata',solverSha256:source,options,maxMoves:2000,seedRange:[games[0].seed,games.at(-1).seed],requestedGames:games.length},...games];
  if(finished)rows.push({type:'summary'});
  const file=path.join(temp,filename);fs.writeFileSync(file,rows.map(JSON.stringify).join('\n')+'\n');return file;
}
try {
  const g1=game(1),g2=game(2),one=batch('one.jsonl',[g1]),two=batch('two.jsonl',[g2]);
  const protocol={recordedAt:'fixture',sourceSha256:'fixture-v1',options:{target:128,nodeBudget:10},maxMoves:2000,games:2,seeds:[1,2]};
  check('all completed registered seeds aggregate exactly once',()=>{const r=analyze([one,two],protocol);assert.equal(r.complete,true);assert.equal(r.games,2);assert.equal(r.successes,+g1.success + +g2.success);});
  check('missing holdout seed remains incomplete',()=>{const r=analyze([one],protocol);assert.equal(r.complete,false);assert.deepEqual(r.missingSeeds,[2]);});
  check('batch without final summary remains incomplete',()=>assert.equal(analyze([batch('partial.jsonl',[g1],{finished:false})]).complete,false));
  check('duplicate seeds are rejected',()=>assert.throws(()=>analyze([one,one]),/Duplicate seed/));
  check('different versions are rejected',()=>assert.throws(()=>analyze([one,batch('other-source.jsonl',[g2],{source:'v2'})]),/different solver versions/));
  check('different configurations are rejected',()=>assert.throws(()=>analyze([one,batch('other-budget.jsonl',[g2],{nodeBudget:20})]),/different solver configurations/));
  check('wrong preregistered source is rejected',()=>assert.throws(()=>analyze([one],{...protocol,sourceSha256:'bad'}),/Wrong solver version/));
  check('unregistered seed is rejected',()=>assert.throws(()=>analyze([one],{...protocol,seeds:[99]}),/Unregistered seed/));
  check('corrupted score is caught independently',()=>assert.throws(()=>verifyGame({...g1,score:g1.score+4},128),/score identity/));
  check('corrupted spawn count is caught independently',()=>assert.throws(()=>verifyGame({...g1,moves:g1.moves+1},128),/mass mismatch/));
  check('an initial target tile uses both initial spawns',()=>{const initialWin=Array.from({length:32},(_,seed)=>game(seed,4)).find(g=>g.outcome==='success'&&g.moves===0);assert.ok(initialWin);verifyGame(initialWin,4);});
  check('a claimed loss must have no legal moves',()=>{const loss=game(10,32768);assert.equal(loss.outcome,'loss');const board=loss.finalBoard.slice();board[0]=0;assert.throws(()=>verifyGame({...loss,finalBoard:board},32768),/still has a legal move/);});
  check('censored games remain explicitly censored',()=>{const g=game(4,32768,10),r=analyze([batch('censored.jsonl',[g],{target:32768})]);assert.equal(r.censored,1);assert.equal(r.complete,false);});
  check('incomplete trailing writes are rejected',()=>{const f=path.join(temp,'truncated.jsonl');fs.writeFileSync(f,'{"type":"metadata"');assert.throws(()=>analyze([f]),/incomplete write/);});
  console.log(`${passed} aggregation tests passed.`);
} finally {fs.rmSync(temp,{recursive:true,force:true});}
