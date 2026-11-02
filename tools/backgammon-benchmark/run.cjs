'use strict';
// Headless evaluation of the original HTML engine; no game/search code is reimplemented.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const htmlPath=path.resolve(__dirname,'../../Backgammon(Single File Ver) - Built by Claude.html');
const resultDir=path.join(__dirname,'results');
const PAIRS={
 'td1-em1':[['gnubg',1],['emm',1]],'td1-em6':[['gnubg',1],['emm',6]],
 'td5-em1':[['gnubg',5],['emm',1]],'td5-em6':[['gnubg',5],['emm',6]],
 'td1-td5':[['gnubg',1],['gnubg',5]],'em1-em6':[['emm',1],['emm',6]],
 'td4-td5':[['gnubg',4],['gnubg',5]],'em5-em6':[['emm',5],['emm',6]]
};
function arg(k,d){const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];}
function num(k,d,max){const n=Number(arg(k,d));if(!Number.isSafeInteger(n)||n<0||n>max)throw Error('Invalid '+k);return n;}
const pair=arg('pair','td1-em1'),mode=arg('mode','games'),games=num('games',100,100000),
 seed0=num('seed',910001,2140000000),budget=num('budget-seconds',0,21600);
if(!PAIRS[pair]||!['games','probe','summarize'].includes(mode)||games<1)throw Error('Bad config');
fs.mkdirSync(resultDir,{recursive:true});
const recordsFile=path.join(resultDir,pair+'.jsonl'),summaryFile=path.join(resultDir,pair+'.summary.json');
const read=()=>fs.existsSync(recordsFile)?fs.readFileSync(recordsFile,'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse):[];
function summary(){
 const records=read(),done=records.filter(x=>x.winner!==null),wins={A:done.filter(x=>x.winner==='A').length,B:done.filter(x=>x.winner==='B').length};
 const o={pair,configuration:PAIRS[pair],requestedGames:games,recordedGames:records.length,completedGames:done.length,wins,
  incomplete:records.filter(x=>x.winner===null).length,winRateA:done.length?wins.A/done.length:null,
  avgThinkSeconds:records.length?records.reduce((a,x)=>a+x.thinkSeconds,0)/records.length:null,
  maxMoveSeconds:Math.max(0,...records.map(x=>x.maxMoveSeconds)),sourceSha256:[...new Set(records.map(x=>x.sourceSha256))],
  protocol:'Seed 910001+floor(i/2); swap colors on odd games; original Rules, SEARCH and WASM evaluation; cube and take copied from original UI'};
 fs.writeFileSync(summaryFile,JSON.stringify(o,null,2)+'\n');console.log('SUMMARY '+JSON.stringify(o));return o;
}
function rngFor(seed){return()=>{let t=seed+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function dice(rng){return[1+Math.floor(rng()*6),1+Math.floor(rng()*6)];}
function init(){
 const html=fs.readFileSync(htmlPath,'utf8'),hash=crypto.createHash('sha256').update(html).digest('hex');
 const embedded=id=>{const marker=new RegExp('<script[^>]*\\bid=["\x27]'+id+'["\x27][^>]*>([\\s\\S]*?)<\\/script>','i'),m=html.match(marker);
  if(!m)throw Error('Missing embedded '+id);return m[1].trim();};
 const api=new Function(embedded('engine')+'\nreturn {Rules,SEARCH,loadBG,nnOut,bearP,winP,BG};')();
 return {api,assets:id=>embedded(id.slice(1)),hash};
}
function choose(api,id,level,b,side,roll,stats){
 const start=performance.now(),seqs=api.Rules.gen(b,side,roll,true),S=api.SEARCH[id],p=S.plan({seqs,s:side,b,p:{level}});
 if(!seqs.length)throw Error('No legal outcomes');
 let best=p.bi;
 if(p.ord){let max=-Infinity;for(const i of p.ord){const v=S.score(seqs[i].b,side,p.deep,p.db);
  if(!Number.isFinite(v))throw Error('Invalid search value');
  if(v>max){best=i;max=v;}}}
 if(!Number.isInteger(best)||best<0||best>=seqs.length)throw Error('Invalid choice');
 const sec=(performance.now()-start)/1000;stats.moves++;stats.thinkSeconds+=sec;stats.maxMoveSeconds=Math.max(stats.maxMoveSeconds,sec);
 return seqs[best].b;
}
function wantsDouble(api,id,b,s){
 if(id==='gnubg'){const p=api.nnOut(b[s],b[1-s])[0];return p>=.7&&p<.92;}
 const e=api.bearP(b,s),p=e>=0?e:api.winP(b,s);return p>=.7&&p<.92;
}
function takesDouble(api,id,b,s){
 if(id==='gnubg')return api.nnOut(b[s],b[1-s])[0]<=.75;
 const e=api.bearP(b,1-s);return(e>=0?1-e:api.winP(b,s))>=.25;
}
function game(api,hash,index){
 const swap=!!(index%2),seed=seed0+Math.floor(index/2),rng=rngFor(seed);
 const sides=swap?[PAIRS[pair][1],PAIRS[pair][0]]:PAIRS[pair],b0=api.Rules.init();
 let b=b0,open;do{open=dice(rng);}while(open[0]===open[1]);
 let s=open[0]>open[1]?0:1,cube={v:1,o:-1},winner=null,reason='max-turns',type=0,points=0,doubles=0,t=0;
 const st={moves:0,thinkSeconds:0,maxMoveSeconds:0};
 for(t=0;t<1200;t++){
  const [id,level]=sides[s],other=1-s;
  if(t>0&&(cube.o<0||cube.o===s)&&wantsDouble(api,id,b,s)){
   doubles++;
   if(!takesDouble(api,sides[other][0],b,other)){winner=s;reason='double-declined';type=1;points=cube.v;break;}
   cube={v:cube.v*2,o:other};if(cube.v>2**40)throw Error('Cube overflow');
  }
  b=choose(api,id,level,b,s,t?dice(rng):open,st);
  if(api.Rules.off(b[s])===15){winner=s;reason='borne-off';type=api.Rules.result(b,s,cube).type;points=type*cube.v;break;}
  s=other;
 }
 return{pair,index,seed,swap,sourceSha256:hash,sides,winnerSide:winner,
  winner:winner===null?null:(winner===(swap?1:0)?'A':'B'),reason,type,points,doubles,turns:t+(winner===null?0:1),...st};
}
(async()=>{
 if(mode==='summarize'){summary();return;}
 const {api,assets,hash}=init();await api.loadBG(assets);
 const p=api.nnOut(api.Rules.init()[0],api.Rules.init()[1])[0];
 if(!Number.isFinite(p)||p<0||p>1||!api.BG.bo)throw Error('GNUBG WASM / bearoff database did not load');
 console.log('BACKEND '+JSON.stringify({wasmLoaded:!!api.BG.x,bearoffLoaded:!!api.BG.bo,simd:!!api.BG.simd,node:process.version}));
 if(mode==='probe'){
  for(let i=0;i<2;i++){const st={moves:0,thinkSeconds:0,maxMoveSeconds:0},[id,level]=PAIRS[pair][i];
   choose(api,id,level,api.Rules.init(),i,[3,1],st);
   console.log(JSON.stringify({pair,id,level,sourceSha256:hash,probeThinkSeconds:st.thinkSeconds}));}
  return;
 }
 const existing=new Map(read().map(r=>[r.index,r]));
 for(const r of existing.values())if(r.sourceSha256!==hash)throw Error('Source hash changed; use new results directory');
 const start=performance.now();
 for(let i=0;i<games;i++){
  if(existing.has(i))continue;
  if(budget&&(performance.now()-start)/1000>=budget){console.log('BUDGET_EXCEEDED');break;}
  const r=game(api,hash,i);fs.appendFileSync(recordsFile,JSON.stringify(r)+'\n');
  console.log('GAME '+(i+1)+'/'+games+' '+r.winner+' '+r.reason+' '+r.thinkSeconds.toFixed(2)+'s');
 }
 summary();
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
