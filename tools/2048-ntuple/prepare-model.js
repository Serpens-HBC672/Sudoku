#!/usr/bin/env node
'use strict';
// Downloads public model data only. No authentication, training, or paid service.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const MODEL=Object.freeze({repo:'moporgic/TDL2048',revision:'0899be24f2f53d1199225960330e6742177af81d',filename:'4x6patt.w',bytes:805306497,sha256:'aa5f89ecadb9ff6d5a78db0e3c608826f275089ca6d8fdb71243a195b1fa08f1',url:'https://huggingface.co/moporgic/TDL2048/resolve/0899be24f2f53d1199225960330e6742177af81d/4x6patt.w',license:'MIT',licenseUrl:'https://huggingface.co/moporgic/TDL2048/blob/0899be24f2f53d1199225960330e6742177af81d/README.md',patterns:['012345','456789','012456','45689a']});
const MODELS=Object.freeze({'4x6':MODEL,'8x6':Object.freeze(Object.assign({},MODEL,{filename:'8x6patt.w',bytes:1610612989,sha256:'bb8678095de7b5a934be105e51f7bb13f762eeb48b42a99e0ebc0da3fcbbbe9f',url:'https://huggingface.co/moporgic/TDL2048/resolve/0899be24f2f53d1199225960330e6742177af81d/8x6patt.w',patterns:['012456','456789','012345','234569','01259a','345678','134567','01489a']}))});
function hashFile(file){const fd=fs.openSync(file,'r'),buf=Buffer.allocUnsafe(1024*1024),hash=crypto.createHash('sha256');try{let n;while((n=fs.readSync(fd,buf,0,buf.length,null)))hash.update(buf.subarray(0,n));return hash.digest('hex');}finally{fs.closeSync(fd);}}
function readExact(fd,n,offset){const b=Buffer.alloc(n);let got=0;while(got<n){const k=fs.readSync(fd,b,got,n-got,offset+got);if(!k)throw new Error('Unexpected model EOF.');got+=k;}return b;}
function convert(source,dir,network='4x6'){
  const spec=MODELS[network];if(!spec)throw new Error('network must be4x6 or8x6.');
  if(fs.statSync(source).size!==spec.bytes)throw new Error('Raw model length mismatch; expected '+spec.bytes+' bytes.');
  const rawHash=hashFile(source);if(rawHash!==spec.sha256)throw new Error('Raw model SHA-256 mismatch; refusing conversion.');
  fs.mkdirSync(dir,{recursive:true});const valuesPath=path.join(dir,network+'patt.f32'),manifestPath=path.join(dir,network+'patt.json');
  if(fs.existsSync(valuesPath)||fs.existsSync(manifestPath))throw new Error('Output already exists; use a new output directory to avoid overwriting.');
  const input=fs.openSync(source,'r'),output=fs.openSync(valuesPath,'wx'),hash=crypto.createHash('sha256');
  let offset=0,outputBytes=0;const parsed=[];
  try{
    const h=readExact(input,5,0);if(h[0]!==0||h.readUInt32LE(1)!==spec.patterns.length)throw new Error('Unexpected raw model version/table count.');offset=5;
    const chunk=Buffer.allocUnsafe(4*1024*1024);
    for(let table=0;table<spec.patterns.length;table++){
      const h=readExact(input,19,offset);const marker=h[0],signature=h.readBigUInt64LE(1),width=h.readUInt16LE(9),entries=Number(h.readBigUInt64LE(11));
      if(marker!==0x80||signature!==BigInt('0x'+spec.patterns[table])||width!==4||entries!==16777216)throw new Error('Unexpected table header at '+offset);
      offset+=19;const valueOffset=offset,bytes=entries*width;
      for(let remaining=bytes;remaining>0;){const n=Math.min(chunk.length,remaining);let got=0;while(got<n){const r=fs.readSync(input,chunk,got,n-got,offset+got);if(!r)throw new Error('Unexpected value EOF.');got+=r;}fs.writeSync(output,chunk,0,n);hash.update(chunk.subarray(0,n));offset+=n;outputBytes+=n;remaining-=n;}
      const e=readExact(input,10,offset);if(e.readUInt16LE(0)!==4||Number(e.readBigUInt64LE(2))!==33554432)throw new Error('Unexpected training extension.');
      offset+=10+4*33554432;if(readExact(input,2,offset).readUInt16LE(0)!==0)throw new Error('Missing extension terminator.');offset+=2;
      parsed.push({id:spec.patterns[table],entries,rawValueOffset:valueOffset,outputByteOffset:table*67108864});
    }
    if(offset!==spec.bytes||outputBytes!==spec.patterns.length*67108864)throw new Error('Final model length mismatch.');
  }catch(error){fs.closeSync(input);fs.closeSync(output);fs.unlinkSync(valuesPath);throw error;}
  fs.closeSync(input);fs.closeSync(output);
  const manifest={format:'tdl2048-'+network+'-f32le-v1',createdAt:new Date().toISOString(),source:spec,inference:{file:network+'patt.f32',bytes:outputBytes,sha256:hash.digest('hex'),dtype:'float32',byteOrder:'little-endian',tables:parsed,features:spec.patterns.length*8,symmetries:'All eight D4 symmetries, same weights shared across each pattern',indexOrder:'First listed pattern cell is least-significant nibble',trainingArraysIncluded:false,networkMeaning:'TD-trained afterstate future-score value; add immediate merge reward when scoring an action.'}};
  fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});return manifest;
}
function main(argv){let source=null,dir=path.join(__dirname,'models'),download=false,network='4x6';for(let i=0;i<argv.length;i++){if(argv[i]==='--network')network=argv[++i];else if(argv[i]==='--source')source=argv[++i];else if(argv[i]==='--out')dir=path.resolve(argv[++i]);else if(argv[i]==='--download')download=true;else if(argv[i]==='--help'){console.log('node prepare-model.js --download [--network 4x6|8x6] [--out models]\nnode prepare-model.js --source /path/MODELpatt.w [--network 4x6|8x6] [--out models]\n4x6: 768 MiB raw / 256 MiB inference; 8x6: 1536 MiB raw / 512 MiB inference; requires curl only for --download. Raw source is checksum-verified.');return;}else throw new Error('Unknown argument '+argv[i]);}
  const spec=MODELS[network];if(!spec)throw new Error('network must be4x6 or8x6.');
  if(download){fs.mkdirSync(dir,{recursive:true});source=path.join(dir,spec.filename);if(!fs.existsSync(source)){const partial=source+'.part';console.error('Downloading pinned public MIT model, '+spec.bytes+' bytes. A single attempt is bounded to 180 seconds; rerunning resumes partial data.');const r=spawnSync('curl',['--fail','--location','--continue-at','-','--connect-timeout','20','--max-time','180','--retry','0',spec.url,'--output',partial],{stdio:'inherit'});if(r.error)throw new Error('curl is required for --download; alternatively download the pinned URL manually and use --source.');if(r.status!==0)throw new Error('Download did not finish. Partial file preserved; rerun this command to resume.');fs.renameSync(partial,source);}}
  if(!source)throw new Error('Use --source FILE or --download. No model is downloaded implicitly.');const result=convert(path.resolve(source),dir,network);console.log(JSON.stringify(result,null,2));}
if(require.main===module)main(process.argv.slice(2));module.exports={MODEL,MODELS,hashFile,convert};
