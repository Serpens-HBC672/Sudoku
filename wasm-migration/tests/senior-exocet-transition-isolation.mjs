import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  instantiateCore,
  loadPosition,
  loadGivenGrid,
  runStandaloneTechniqueFinder,
} from "../bridge/assembly-core.mjs";
import { loadOracle } from "./load-oracle.mjs";
import { loadBenchmarkCorpus } from "./benchmark-corpus.mjs";

const TECHNIQUES = [
  [0,"nakedSingle"],[1,"hiddenSingle"],[2,"lockedCandidate"],[3,"gsp"],
  [4,"nakedPair"],[5,"hiddenPair"],[6,"nakedTriple"],[7,"hiddenTriple"],
  [8,"nakedQuad"],[9,"hiddenQuad"],[10,"xWing"],[11,"swordfish"],
  [12,"skyscraper"],[13,"twoStringKite"],[14,"emptyRectangle"],[15,"jellyfish"],
  [16,"squirmbagFish"],[17,"finnedXWing"],[18,"finnedSwordfish"],[19,"finnedJellyfish"],
  [20,"uniqueRectangleType1"],[21,"uniqueRectangleType2"],[22,"hiddenUniqueRectangle"],
  [23,"bugPlusOne"],[24,"xyzWing"],[25,"wWing"],[26,"wxyzWing"],[27,"xyChain"],
  [28,"aic"],[29,"niceLoop"],[30,"sueDeCoq"],[31,"fireworkTriple"],
  [32,"fireworkQuadruple"],[33,"fireworkWWing"],[34,"fireworkAlp"],[35,"pom"],
  [36,"alsXZ"],[37,"ahsXZ"],[38,"alsChain"],[39,"deathBlossom"],[40,"medusa3D"],
  [41,"tridagon"],[45,"tridagonForce"],[46,"skLoop"],[47,"msls"],
  [48,"juniorExocet"],[49,"seniorExocet"],
];

const TARGET_CASE = 4;
const TARGET_ID = 49;
const wasmPath = new URL("../build/sudoku-techniques.wasm", import.meta.url);
const outDir = resolve("senior-exocet-transition-results");
await mkdir(outDir, { recursive: true });

const oracle = await loadOracle();
const corpus = await loadBenchmarkCorpus();
const target = corpus.find((x) => x.id === TARGET_CASE);
const targetMasks = Array.from(oracle.candidateMasksForGrid(target.puzzle), Number);
const targetExpected = oracle.findTechniqueFromMasks(
  "seniorExocet", target.puzzle, targetMasks, target.puzzle, target.solution,
);

function clone(v){ return v == null ? v : JSON.parse(JSON.stringify(v)); }
function normalize(key, raw, solution) {
  return key === "juniorExocet" || key === "seniorExocet"
    ? clone(oracle.validateFindingAgainstSolution(raw, solution))
    : raw;
}
function mem(core){
  const bytes=core.memory.buffer.byteLength;
  return {bytes,pages:bytes/65536};
}
function ordinalDescriptor(ordinal) {
  const zero = ordinal - 1;
  const caseId = Math.floor(zero / TECHNIQUES.length) + 1;
  const pos = zero % TECHNIQUES.length;
  const [id,key] = TECHNIQUES[pos];
  return {ordinal,caseId,positionWithinCase:pos+1,techniqueId:id,techniqueKey:key};
}

async function testPrefix(prefixCount) {
  const core = await instantiateCore(wasmPath);
  let ordinal=0;

  outer:
  for (const testCase of corpus) {
    if (testCase.id > TARGET_CASE) break;
    const masks=Array.from(oracle.candidateMasksForGrid(testCase.puzzle),Number);
    loadPosition(core,testCase.puzzle,masks);
    loadGivenGrid(core,testCase.puzzle);

    for (const [id,key] of TECHNIQUES) {
      if (testCase.id === TARGET_CASE && id === TARGET_ID) break outer;
      if (ordinal >= prefixCount) break outer;
      ordinal++;
      const raw=runStandaloneTechniqueFinder(core,id);
      const normalized=normalize(key,raw,testCase.solution);
      const expected=oracle.findTechniqueFromMasks(
        key,testCase.puzzle,masks,testCase.puzzle,testCase.solution,
      );
      assert.deepEqual(normalized,clone(expected),
        "prefix parity mismatch at ordinal "+ordinal+" "+key);
    }
  }
  assert.equal(ordinal,prefixCount);

  loadPosition(core,target.puzzle,targetMasks);
  loadGivenGrid(core,target.puzzle);
  const before=mem(core);
  let raw=null,error=null,after=null;
  try{
    raw=runStandaloneTechniqueFinder(core,TARGET_ID);
    after=mem(core);
  }catch(e){
    error={name:e?.name??null,message:String(e?.message||e),stack:String(e?.stack||""),memory:mem(core)};
  }
  let parity=false;
  if(!error){
    const normalized=normalize("seniorExocet",raw,target.solution);
    try{ assert.deepEqual(normalized,clone(targetExpected)); parity=true; }catch{}
  }
  const result={
    prefixCount,
    lastPrefixCall:prefixCount?ordinalDescriptor(prefixCount):null,
    memoryBeforeTarget:before,
    memoryAfterTarget:after,
    targetSucceeded:!error,
    exactTargetParity:parity,
    error,
  };
  console.log("TRANSITION_POINT "+JSON.stringify(result));
  return result;
}

const observations=[];
const cache=new Map();
async function observe(n){
  if(cache.has(n)) return cache.get(n);
  const r=await testPrefix(n);
  cache.set(n,r); observations.push(r); return r;
}

const good141=await observe(141);
const bad186=await observe(186);
assert.equal(good141.targetSucceeded,true,"expected prefix 141 to be safe");
assert.equal(bad186.targetSucceeded,false,"expected prefix 186 to reproduce");

let lo=141, hi=186;
while(hi-lo>1){
  const mid=Math.floor((lo+hi)/2);
  const r=await observe(mid);
  if(r.targetSucceeded) lo=mid;
  else hi=mid;
}
const neighborGood=await observe(lo);
const firstBad=await observe(hi);

const out={
  schema:"incremental-senior-exocet-transition/v1",
  target:{caseId:4,techniqueId:49,jsOracleFinding:clone(targetExpected)},
  lastKnownGoodPrefix:neighborGood,
  firstBadPrefix:firstBad,
  firstBadIntroducedCall:ordinalDescriptor(hi),
  observations:observations.sort((a,b)=>a.prefixCount-b.prefixCount),
  note:"Binary search assumes corruption persists once introduced; adjacent good/bad prefixes are explicitly rechecked.",
};
await writeFile(resolve(outDir,"transition.json"),JSON.stringify(out,null,2)+"\n","utf8");
console.log("TRANSITION_RESULT "+JSON.stringify(out));
