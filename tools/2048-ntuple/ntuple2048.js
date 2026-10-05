/* MIT License. N-tuple TD inference adapter for moporgic/TDL2048 baseline weights.
 * Afterstate values are learned future scores, not win probabilities.
 * Node: require('./ntuple2048.js'); browser: load Expectimax2048 game helper first.
 */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(require('../2048-expectimax/expectimax2048.js'),require);else root.NTuple2048=factory(root.Expectimax2048,null);})(typeof globalThis!=='undefined'?globalThis:this,function(Game,nodeRequire){
  'use strict';
  if(!Game)throw new Error('Load the standalone Expectimax2048 game helper before NTuple2048.');
  const PATTERNS=Object.freeze(['012345','456789','012456','45689a']);
  const TABLE_LENGTH=16777216, MODEL_BYTES=268435456;
  const MODEL_CATALOG = Object.freeze({ '4x6': Object.freeze({patterns:PATTERNS, bytes:268435456, sourceSha256:'aa5f89ecadb9ff6d5a78db0e3c608826f275089ca6d8fdb71243a195b1fa08f1', sha256:'01cbe0f0cf523c75947e0c449520399068a4f4bab73ae0d894cabc95ffcfd629'}), '8x6': Object.freeze({patterns:Object.freeze(['012456','456789','012345','234569','01259a','345678','134567','01489a']),bytes:536870912,sourceSha256:'bb8678095de7b5a934be105e51f7bb13f762eeb48b42a99e0ebc0da3fcbbbe9f',sha256:'4e9342fa525ae41d5268e294f396dd066822cd9df88076b864d35f356f3f3297'}) });
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
  function featureCells(patterns){
    const cells=new Uint8Array(patterns.length*8*6);
    for(let p=0;p<patterns.length;p++)for(let s=0;s<8;s++)for(let k=0;k<6;k++)cells[(p*8+s)*6+k]=SYMMETRIES[s][parseInt(patterns[p][k],16)];
    return cells;
  }
  const CELLS=featureCells(PATTERNS);
  const POTENTIAL=new Float64Array(65536),EMPTY=new Uint8Array(65536);
  for(let row=0;row<65536;row++){let score=0,empty=0;for(let k=0;k<4;k++){const rank=(row>>>(4*k))&15;if(rank)score+=(rank-1)*2**rank;else empty++;}POTENTIAL[row]=score;EMPTY[row]=empty;}
  function rankAt(lo,hi,index){return ((index<8?lo:hi)>>>((index&7)*4))&15;}
  function potential(lo,hi){return POTENTIAL[lo&65535]+POTENTIAL[lo>>>16]+POTENTIAL[hi&65535]+POTENTIAL[hi>>>16];}
  function countEmpty(lo,hi){return EMPTY[lo&65535]+EMPTY[lo>>>16]+EMPTY[hi&65535]+EMPTY[hi>>>16];}
  function tupleIndices(board,patterns=PATTERNS){const[lo,hi]=Game._internals.pack(board),result=[],cells=featureCells(patterns);for(let i=0;i<patterns.length*8;i++){let index=0;for(let k=0;k<6;k++)index|=rankAt(lo,hi,cells[i*6+k])<<(k*4);result.push(index);}return result;}
  function validatePackedWord(word,name){
    if(!Number.isFinite(word)||!Number.isInteger(word)||word<0||word>0xffffffff)throw new RangeError(name+' must be an unsigned 32-bit integer (0..4294967295).');
  }
  // Private hot path: pack/movePacked/spawn already produce unsigned words.
  // Each six-nibble index remains in 0..16^6-1, including rank 15 (32768).
  function evaluatePackedUnchecked(model,lo,hi){
    let sum=0;const cells=model.cells;
    for(let i=0;i<model.tables.length*8;i++){
      const offset=i*6;
      const index=rankAt(lo,hi,cells[offset])|(rankAt(lo,hi,cells[offset+1])<<4)|(rankAt(lo,hi,cells[offset+2])<<8)|(rankAt(lo,hi,cells[offset+3])<<12)|(rankAt(lo,hi,cells[offset+4])<<16)|(rankAt(lo,hi,cells[offset+5])<<20);
      sum+=model.tables[i>>>3][index];
    }
    if(!Number.isFinite(sum))throw new Error('Model contains a non-finite weight at an evaluated feature.');
    return sum;
  }
  class NTupleModel{
    constructor(tables,patterns=PATTERNS){if(!Array.isArray(patterns)||!patterns.length||patterns.length>16||patterns.some(p=>typeof p!=='string'||!/^[0-9a-f]{6}$/i.test(p)))throw new TypeError('Expected six-cell hexadecimal pattern IDs.');if(!Array.isArray(tables)||tables.length!==patterns.length||tables.some(t=>!(t instanceof Float32Array)||t.length!==TABLE_LENGTH))throw new TypeError('Expected one Float32Array of16^6 entries per pattern.');this.tables=tables;this.patterns=Object.freeze(patterns.slice());this.cells=featureCells(patterns);}
    evaluate(board){const[lo,hi]=Game._internals.pack(board);return evaluateTrusted(this,lo,hi);}
    evaluatePacked(lo,hi){
      validatePackedWord(lo,'lo');validatePackedWord(hi,'hi');
      return evaluatePackedUnchecked(this,lo,hi);
    }
  }
  const defaultEvaluatePacked=NTupleModel.prototype.evaluatePacked;
  function evaluateTrusted(model,lo,hi){
    // Retain caller-supplied diagnostic/custom wrappers without charging normal
    // search leaves for the checked public boundary.
    return model.evaluatePacked===defaultEvaluatePacked?evaluatePackedUnchecked(model,lo,hi):model.evaluatePacked(lo,hi);
  }
  function loadModel(manifestPath){
    if(!nodeRequire)throw new Error('loadModel(path) is Node-only. In a browser supply Float32Array tables to NTupleModel.');
    const fs=nodeRequire('node:fs'),path=nodeRequire('node:path'),crypto=nodeRequire('node:crypto');
    const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    const specification=Object.values(MODEL_CATALOG).find(m=>m.sourceSha256===manifest.source.sha256);
    if(!specification||!/^tdl2048-[48]x6-f32le-v1$/.test(manifest.format)||manifest.inference.sha256!==specification.sha256||manifest.inference.bytes!==specification.bytes)throw new Error('Manifest does not describe a pinned, verified baseline model.');
    if(new Uint8Array(new Uint32Array([0x01020304]).buffer)[0]!==4)throw new Error('This loader currently requires a little-endian host.');
    let bytes=fs.readFileSync(path.resolve(path.dirname(manifestPath),manifest.inference.file));
    if(bytes.byteLength!==specification.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==specification.sha256)throw new Error('Inference model size or SHA-256 mismatch.');
    if(bytes.byteOffset%4){const aligned=new Uint8Array(bytes.byteLength);aligned.set(bytes);bytes=aligned;}
    const tables=Array.from({length:specification.patterns.length},(_,i)=>new Float32Array(bytes.buffer,bytes.byteOffset+i*TABLE_LENGTH*4,TABLE_LENGTH));
    const model=new NTupleModel(tables,specification.patterns);model.manifest=manifest;return model;
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
      if(this.options.criticalSearch!==undefined&&typeof this.options.criticalSearch!=='boolean')throw new TypeError('criticalSearch must be boolean.');
      const empty=this.options.criticalEmpty??1,tile=this.options.criticalTile??8192;
      if(!Number.isInteger(empty)||empty<0||empty>4||!Number.isInteger(Math.log2(tile))||tile<2||tile>16384)throw new RangeError('Invalid critical-search thresholds.');
      this.criticalEmpty=empty;this.criticalTile=tile;this.targetRank=Math.log2(this.options.target);
      this.model=model;Game._internals.initTables();
    }
    _afterValue(lo,hi,remaining){
      if(remaining<=0)return evaluateTrusted(this.model,lo,hi);
      // Goal states remain leaves; never expand a rank15 board toward rank16.
      for(let i=0;i<8;i++)if(((lo>>>(i*4))&15)>=this.targetRank||((hi>>>(i*4))&15)>=this.targetRank)return evaluateTrusted(this.model,lo,hi);
      return this._expectation(lo,hi,remaining);
    }
    _bestAfterSpawn(lo,hi,remaining){
      this.nodes++;let best=0;const before=potential(lo,hi);
      for(let d=0;d<4;d++){
        const[nl,nh]=Game._internals.movePacked(lo,hi,d);if(nl===lo&&nh===hi)continue;
        this.nodes++;const reward=potential(nl,nh)-before;
        // Reproduce native inner search semantics: reward + max(afterstateV,0) +1.
        const value=reward+Math.max(this._afterValue(nl,nh,remaining-1),0)+1;
        if(value>best)best=value;
      }
      return best;
    }
    _expectation(lo,hi,remaining){
      const empty=countEmpty(lo,hi);if(!empty)throw new Error('A changed nonterminal move must leave a spawn cell.');
      let sum=0;
      for(let i=0;i<8;i++){
        const shift=i*4;
        if(((lo>>>shift)&15)===0){sum+=0.9*this._bestAfterSpawn((lo|(1<<shift))>>>0,hi,remaining);sum+=0.1*this._bestAfterSpawn((lo|(2<<shift))>>>0,hi,remaining);}
        if(((hi>>>shift)&15)===0){sum+=0.9*this._bestAfterSpawn(lo,(hi|(1<<shift))>>>0,remaining);sum+=0.1*this._bestAfterSpawn(lo,(hi|(2<<shift))>>>0,remaining);}
      }
      return sum/empty;
    }
    chooseMove(board){
      const start=now();
      validateBoard(board);this.nodes=0;
      const actualPly=this.options.criticalSearch&&Array.from(board).filter(v=>v===0).length<=this.criticalEmpty&&Math.max(...board)>=this.criticalTile?3:this.options.ply;
      if(Array.from(board).some(v=>v>=this.options.target))return{direction:null,name:null,value:TERMINAL_VALUE,ply:this.options.ply,actualPly,nodes:0,elapsedMs:now()-start,complete:true,targetReached:true};
      const[lo,hi]=Game._internals.pack(board),before=potential(lo,hi),candidates=[];
      for(let d=0;d<4;d++){
        const[nl,nh]=Game._internals.movePacked(lo,hi,d);if(nl===lo&&nh===hi)continue;
        const after=Game._internals.unpack(nl,nh);
        if(after.some(v=>v>=this.options.target))return{direction:d,name:Game.DIRECTIONS[d],value:TERMINAL_VALUE,ply:this.options.ply,actualPly,nodes:0,elapsedMs:now()-start,complete:true,targetReached:false};
        candidates.push({d,lo:nl,hi:nh,reward:potential(nl,nh)-before});
      }
      if(!candidates.length)return{direction:null,name:null,value:0,ply:this.options.ply,actualPly,nodes:0,elapsedMs:now()-start,complete:true,targetReached:false};
      let best=null,value=-Infinity;
      for(const c of candidates){
        const q=c.reward+this._afterValue(c.lo,c.hi,actualPly-1);
        if(q>value){best=c;value=q;}
      }
      return{direction:best.d,name:Game.DIRECTIONS[best.d],value,ply:this.options.ply,actualPly,nodes:this.nodes,elapsedMs:now()-start,complete:true,targetReached:false};
    }
  }
  return Object.freeze({NTupleModel,NTupleSolver,loadModel,tupleIndices,PATTERNS,MODEL_BYTES,MODEL_SHA,SOURCE_SHA,MODEL_CATALOG,_internals:Object.freeze({SYMMETRIES,CELLS,potential})});
});
