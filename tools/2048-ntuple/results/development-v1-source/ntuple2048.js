/* MIT License. N-tuple TD inference adapter for moporgic/TDL2048 baseline weights.
 * Afterstate values are learned future scores, not win probabilities.
 * Node: require('./ntuple2048.js'); browser: load Expectimax2048 game helper first.
 */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(require('../2048-expectimax/expectimax2048.js'),require);else root.NTuple2048=factory(root.Expectimax2048,null);})(typeof globalThis!=='undefined'?globalThis:this,function(Game,nodeRequire){
  'use strict';
  if(!Game)throw new Error('Load the standalone Expectimax2048 game helper before NTuple2048.');
  const PATTERNS=Object.freeze(['012345','456789','012456','45689a']);
  const TABLE_LENGTH=16777216, MODEL_BYTES=268435456;
  const MODEL_SHA='01cbe0f0cf523c75947e0c449520399068a4f4bab73ae0d894cabc95ffcfd629';
  const SOURCE_SHA='aa5f89ecadb9ff6d5a78db0e3c608826f275089ca6d8fdb71243a195b1fa08f1';
  const TERMINAL_VALUE=1000000000;
  const now=()=>typeof performance!=='undefined'?performance.now():Date.now();
  // Each map says which original cell occupies a transformed-board cell.
  const SYMMETRIES=[];let map=Array.from({length:16},(_,i)=>i);
  for(let rotation=0;rotation<4;rotation++){
    SYMMETRIES.push(map.slice());
    SYMMETRIES.push(Array.from({length:16},(_,i)=>map[(i&12)+3-(i&3)]));
    map=Array.from({length:16},(_,i)=>map[(3-(i&3))*4+(i>>>2)]);
  }
  const CELLS=new Uint8Array(32*6);
  for(let p=0;p<4;p++)for(let s=0;s<8;s++)for(let k=0;k<6;k++)CELLS[(p*8+s)*6+k]=SYMMETRIES[s][parseInt(PATTERNS[p][k],16)];
  const POTENTIAL=new Float64Array(65536),EMPTY=new Uint8Array(65536);
  for(let row=0;row<65536;row++){let score=0,empty=0;for(let k=0;k<4;k++){const rank=(row>>>(4*k))&15;if(rank)score+=(rank-1)*2**rank;else empty++;}POTENTIAL[row]=score;EMPTY[row]=empty;}
  function rankAt(lo,hi,index){return ((index<8?lo:hi)>>>((index&7)*4))&15;}
  function potential(lo,hi){return POTENTIAL[lo&65535]+POTENTIAL[lo>>>16]+POTENTIAL[hi&65535]+POTENTIAL[hi>>>16];}
  function countEmpty(lo,hi){return EMPTY[lo&65535]+EMPTY[lo>>>16]+EMPTY[hi&65535]+EMPTY[hi>>>16];}
  function tupleIndices(board){const[lo,hi]=Game._internals.pack(board),result=[];for(let i=0;i<32;i++){let index=0;for(let k=0;k<6;k++)index|=rankAt(lo,hi,CELLS[i*6+k])<<(k*4);result.push(index);}return result;}
  class NTupleModel{
    constructor(tables){if(!Array.isArray(tables)||tables.length!==4||tables.some(t=>!(t instanceof Float32Array)||t.length!==TABLE_LENGTH))throw new TypeError('Expected four Float32Array tables, each with 16^6 entries.');this.tables=tables;}
    evaluate(board){const[lo,hi]=Game._internals.pack(board);return this.evaluatePacked(lo,hi);}
    evaluatePacked(lo,hi){
      let sum=0;
      for(let i=0;i<32;i++){
        const offset=i*6;
        const index=rankAt(lo,hi,CELLS[offset])|(rankAt(lo,hi,CELLS[offset+1])<<4)|(rankAt(lo,hi,CELLS[offset+2])<<8)|(rankAt(lo,hi,CELLS[offset+3])<<12)|(rankAt(lo,hi,CELLS[offset+4])<<16)|(rankAt(lo,hi,CELLS[offset+5])<<20);
        sum+=this.tables[i>>>3][index];
      }
      if(!Number.isFinite(sum))throw new Error('Model contains a non-finite weight at an evaluated feature.');
      return sum;
    }
  }
  function loadModel(manifestPath){
    if(!nodeRequire)throw new Error('loadModel(path) is Node-only. In a browser supply Float32Array tables to NTupleModel.');
    const fs=nodeRequire('node:fs'),path=nodeRequire('node:path'),crypto=nodeRequire('node:crypto');
    const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    if(manifest.format!=='tdl2048-4x6-f32le-v1'||manifest.source.sha256!==SOURCE_SHA||manifest.inference.sha256!==MODEL_SHA||manifest.inference.bytes!==MODEL_BYTES)throw new Error('Manifest does not describe the pinned, verified 4x6 baseline model.');
    if(new Uint8Array(new Uint32Array([0x01020304]).buffer)[0]!==4)throw new Error('This loader currently requires a little-endian host.');
    let bytes=fs.readFileSync(path.resolve(path.dirname(manifestPath),manifest.inference.file));
    if(bytes.byteLength!==MODEL_BYTES||crypto.createHash('sha256').update(bytes).digest('hex')!==MODEL_SHA)throw new Error('Inference model size or SHA-256 mismatch.');
    if(bytes.byteOffset%4){const aligned=new Uint8Array(bytes.byteLength);aligned.set(bytes);bytes=aligned;}
    const tables=Array.from({length:4},(_,i)=>new Float32Array(bytes.buffer,bytes.byteOffset+i*TABLE_LENGTH*4,TABLE_LENGTH));
    const model=new NTupleModel(tables);model.manifest=manifest;return model;
  }
  function validateBoard(board){
    if((!Array.isArray(board)&&!ArrayBuffer.isView(board))||board.length!==16)throw new TypeError('Expected sixteen row-major tile values.');
    for(const v of board)if(!Number.isSafeInteger(v)||v<0||(v!==0&&(v<2||!Number.isInteger(Math.log2(v))||2**Math.log2(v)!==v)))throw new RangeError('Tiles must be zero or exact positive powers of two.');
  }
  class NTupleSolver{
    constructor(model,options={}){
      if(!(model instanceof NTupleModel))throw new TypeError('Supply an NTupleModel, loaded explicitly.');
      this.options=Object.freeze(Object.assign({ply:2,target:32768},options));
      if(![1,2].includes(this.options.ply))throw new RangeError('ply must be 1 or 2.');
      if(!Number.isInteger(Math.log2(this.options.target))||this.options.target<4||this.options.target>32768)throw new RangeError('target must be a power of two from4 through32768.');
      this.model=model;Game._internals.initTables();
    }
    _bestAfterSpawn(lo,hi){
      this.nodes++;let best=0;const before=potential(lo,hi);
      for(let d=0;d<4;d++){
        const[nl,nh]=Game._internals.movePacked(lo,hi,d);if(nl===lo&&nh===hi)continue;
        this.nodes++;const reward=potential(nl,nh)-before;
        // Reproduce native inner search semantics: reward + max(afterstateV,0) +1.
        const value=reward+Math.max(this.model.evaluatePacked(nl,nh),0)+1;
        if(value>best)best=value;
      }
      return best;
    }
    _expectation(lo,hi){
      const empty=countEmpty(lo,hi);if(!empty)throw new Error('A changed nonterminal move must leave a spawn cell.');
      let sum=0;
      for(let i=0;i<8;i++){
        const shift=i*4;
        if(((lo>>>shift)&15)===0){sum+=0.9*this._bestAfterSpawn((lo|(1<<shift))>>>0,hi);sum+=0.1*this._bestAfterSpawn((lo|(2<<shift))>>>0,hi);}
        if(((hi>>>shift)&15)===0){sum+=0.9*this._bestAfterSpawn(lo,(hi|(1<<shift))>>>0);sum+=0.1*this._bestAfterSpawn(lo,(hi|(2<<shift))>>>0);}
      }
      return sum/empty;
    }
    chooseMove(board){
      const start=now();
      validateBoard(board);this.nodes=0;
      if(Array.from(board).some(v=>v>=this.options.target))return{direction:null,name:null,value:TERMINAL_VALUE,ply:this.options.ply,nodes:0,elapsedMs:now()-start,complete:true,targetReached:true};
      const[lo,hi]=Game._internals.pack(board),before=potential(lo,hi),candidates=[];
      for(let d=0;d<4;d++){
        const[nl,nh]=Game._internals.movePacked(lo,hi,d);if(nl===lo&&nh===hi)continue;
        const after=Game._internals.unpack(nl,nh);
        if(after.some(v=>v>=this.options.target))return{direction:d,name:Game.DIRECTIONS[d],value:TERMINAL_VALUE,ply:this.options.ply,nodes:0,elapsedMs:now()-start,complete:true,targetReached:false};
        candidates.push({d,lo:nl,hi:nh,reward:potential(nl,nh)-before});
      }
      if(!candidates.length)return{direction:null,name:null,value:0,ply:this.options.ply,nodes:0,elapsedMs:now()-start,complete:true,targetReached:false};
      let best=null,value=-Infinity;
      for(const c of candidates){
        const q=c.reward+(this.options.ply===1?this.model.evaluatePacked(c.lo,c.hi):this._expectation(c.lo,c.hi));
        if(q>value){best=c;value=q;}
      }
      return{direction:best.d,name:Game.DIRECTIONS[best.d],value,ply:this.options.ply,nodes:this.nodes,elapsedMs:now()-start,complete:true,targetReached:false};
    }
  }
  return Object.freeze({NTupleModel,NTupleSolver,loadModel,tupleIndices,PATTERNS,MODEL_BYTES,MODEL_SHA,SOURCE_SHA,_internals:Object.freeze({SYMMETRIES,CELLS,potential})});
});
