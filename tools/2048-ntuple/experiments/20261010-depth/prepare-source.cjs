'use strict';
// Materialize only the experiment's pinned source, not the current branch implementation.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const SHA='8b5a41f33a14a3132543658e32135dcfc4ab5cc4';
let html;
if(process.argv[2]==='--html' && process.argv[3]) html=fs.readFileSync(process.argv[3],'utf8');
else if(process.argv.length===2) html=cp.execFileSync('git',['show',SHA+':tools/drafting-games-1.single-2.html'],{encoding:'utf8',maxBuffer:2*1024*1024});
else throw new Error('Usage: node prepare-source.cjs [--html pinned-page.html]');
const match=html.match(/window\.__NTUPLE_WORKER_SOURCE__=("(?:[^"\\]|\\.)*");/);
if(!match)throw new Error('Pinned worker source not found');
const worker=JSON.parse(match[1]),a=worker.indexOf(';\n/* MIT License. N-tuple'),b=worker.indexOf(';\n/* MIT. Incremental SHA-256');
if(a<0||b<a)throw new Error('Module separators changed');
const game=worker.slice(0,a),td=worker.slice(a+2,b),anchor='if(![1,2].includes(this.options.ply))';
if(td.split(anchor).length!==2)throw new Error('Depth parameter anchor changed');
const start=html.indexOf('function AI2048Kit(cfg)'),end=html.indexOf('</script>',start);
if(start<0||end<start)throw new Error('Heuristic source not found');
const files={'embedded-worker.js':worker,'2048-expectimax/expectimax2048.js':game,'2048-ntuple/ntuple2048.js':td,'2048-ntuple/ntuple2048-depth-experiment.js':td.replace(anchor,'if(![1,2,3,4].includes(this.options.ply))'),'heuristic2048.js':html.slice(start,end)+'\nmodule.exports=AI2048Kit;\n'};
for(const [name,content]of Object.entries(files)){const dest=path.join(__dirname,'generated',name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content);}
console.log('Prepared pinned source '+SHA+' in generated/.');
