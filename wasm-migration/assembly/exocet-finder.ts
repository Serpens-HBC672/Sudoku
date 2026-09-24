// Exact Junior/Senior Exocet behavioral port for the frozen JS oracle.
// The JS solution validator remains outside WASM; this module preserves raw
// discovery, sanitize-zero-candidate behavior, row-first orientation and order.

const CELL_COUNT:i32=81;
const FACT_COUNT:i32=729;
const ALL:u16=0x01ff;
const MAX_LIST:i32=256;

const grid=new StaticArray<u8>(CELL_COUNT);
const masks=new StaticArray<u16>(CELL_COUNT);

let resultTechnique:i32=0; // 48 JE, 49 SE
let resultSubtype:i32=-1;
let resultOrientation:i32=0; // 0 row, 1 col
const resultPattern=new StaticArray<u8>(16);
let resultPatternCount:i32=0;
const resultElims=new StaticArray<u16>(FACT_COUNT);
let resultElimCount:i32=0;
const resultBase=new StaticArray<u8>(2);
const resultTargets=new StaticArray<u8>(2);
let resultBaseMask:i32=0;
let resultTrueBaseDigit:i32=0;
let rejectedRaw:bool=false;

@inline function bit(d:i32):u16{
  switch(d){
    case 1:return 0x001;case 2:return 0x002;case 3:return 0x004;
    case 4:return 0x008;case 5:return 0x010;case 6:return 0x020;
    case 7:return 0x040;case 8:return 0x080;case 9:return 0x100;
    default:return 0;
  }
}
@inline function vActual(v:i32,transpose:bool):i32{
  const r=v/9,c=v%9;return transpose?c*9+r:v;
}
@inline function vGrid(v:i32,transpose:bool):i32{return <i32>unchecked(grid[vActual(v,transpose)]);}
@inline function vMask(v:i32,transpose:bool):u16{return vGrid(v,transpose)==0?<u16>(unchecked(masks[vActual(v,transpose)])&ALL):0;}
@inline function vBox(v:i32):i32{const r=v/9,c=v%9;return (r/3)*3+c/3;}
@inline function vSees(a:i32,b:i32):bool{return a/9==b/9||a%9==b%9||vBox(a)==vBox(b);}
@inline function fact(v:i32,d:i32):i32{return v*9+(d-1);}
function pop9(value:u16):i32{let m=<u16>(value&ALL),n:i32=0;while(m!=0){m=<u16>(m&<u16>(m-1));n++;}return n;}
function singleDigit9(mask:u16):i32{
  for(let d:i32=1;d<=9;d++)if((mask&bit(d))!=0)return d;
  return 0;
}
function appendFact(buf:StaticArray<u16>,count:i32,v:i32,d:i32):i32{unchecked(buf[count]=<u16>fact(v,d));return count+1;}
function resetResult():void{
  resultTechnique=0;resultSubtype=-1;resultOrientation=0;resultPatternCount=0;resultElimCount=0;resultBaseMask=0;resultTrueBaseDigit=0;rejectedRaw=false;
}

export function exocetResetInput():void{for(let i:i32=0;i<CELL_COUNT;i++){unchecked(grid[i]=0);unchecked(masks[i]=0);}}
export function exocetSetInputCell(index:i32,digit:i32):void{if(index>=0&&index<CELL_COUNT)unchecked(grid[index]=<u8>digit);}
export function exocetSetInputMask(index:i32,mask:i32):void{if(index>=0&&index<CELL_COUNT)unchecked(masks[index]=<u16>(mask&0x1ff));}

function listContains(list:StaticArray<i32>,count:i32,value:i32):bool{
  for(let i:i32=0;i<count;i++)if(unchecked(list[i])==value)return true;return false;
}
function uniqueAppend(list:StaticArray<i32>,count:i32,value:i32):i32{
  if(listContains(list,count,value))return count;unchecked(list[count]=value);return count+1;
}
function cellsAnySee(list:StaticArray<i32>,count:i32):bool{
  for(let i:i32=0;i<count;i++)for(let j:i32=i+1;j<count;j++)if(vSees(unchecked(list[i]),unchecked(list[j])))return true;
  return false;
}
function comboInit(idx:StaticArray<i32>,k:i32):void{for(let i:i32=0;i<k;i++)unchecked(idx[i]=i);}
function comboNext(idx:StaticArray<i32>,n:i32,k:i32):bool{
  let i=k-1;while(i>=0&&unchecked(idx[i])==n-k+i)i--;if(i<0)return false;
  unchecked(idx[i]=unchecked(idx[i])+1);for(let j=i+1;j<k;j++)unchecked(idx[j]=unchecked(idx[j-1])+1);return true;
}

// AppearingTimesOf without materializing peer Sets. "covered by combo peers"
// is exactly "equals or sees at least one combo member".
function appearingTimes(d:i32,cells:StaticArray<i32>,cellCount:i32,transpose:bool):i32{
  const db=bit(d),active=new StaticArray<i32>(32);let activeCount:i32=0,inactive:i32=0;
  for(let i:i32=0;i<cellCount;i++){
    const v=unchecked(cells[i]),gv=vGrid(v,transpose);
    if(gv==d)inactive++;
    else if(gv==0&&(vMask(v,transpose)&db)!=0)unchecked(active[activeCount++]=v);
  }
  const maxK=activeCount<3?activeCount:3,combo=new StaticArray<i32>(3),chosen=new StaticArray<i32>(3);
  for(let k:i32=maxK;k>=1;k--){
    comboInit(combo,k);
    while(true){
      for(let i:i32=0;i<k;i++)unchecked(chosen[i]=unchecked(active[unchecked(combo[i])]));
      if(!cellsAnySee(chosen,k)){
        let covered=true;
        for(let ai:i32=0;ai<activeCount;ai++){
          const v=unchecked(active[ai]);let hit=false;
          for(let ci:i32=0;ci<k;ci++){const q=unchecked(chosen[ci]);if(v==q||vSees(v,q)){hit=true;break;}}
          if(!hit){covered=false;break;}
        }
        if(covered)return k+inactive;
      }
      if(!comboNext(combo,activeCount,k))break;
    }
  }
  return 0;
}
function exactAppearingTimes(d:i32,cells:StaticArray<i32>,cellCount:i32,limit:i32,transpose:bool):bool{
  const db=bit(d);let active=0,inactive=0;
  for(let i:i32=0;i<cellCount;i++){
    const v=unchecked(cells[i]),gv=vGrid(v,transpose);
    if(gv==d)inactive++;else if(gv==0&&(vMask(v,transpose)&db)!=0)active++;
  }
  if(active==0)return limit==inactive;
  return appearingTimes(d,cells,cellCount,transpose)==limit;
}
function lockedMember(d:i32,bandStart:i32,colStart:i32,excludeV:i32,baseRow:i32,transpose:bool):bool{
  const db=bit(d);let found=false;
  for(let r:i32=bandStart;r<bandStart+3;r++)for(let c:i32=colStart;c<colStart+3;c++){
    const v=r*9+c;if(v==excludeV)continue;
    if(vGrid(v,transpose)==0&&(vMask(v,transpose)&db)!=0){found=true;if(r!=baseRow)return false;}
  }
  return found;
}
function maskHasSolvedDigit(mask:u16,cells:StaticArray<i32>,count:i32,transpose:bool):bool{
  for(let d:i32=1;d<=9;d++)if((mask&bit(d))!=0)for(let i:i32=0;i<count;i++)if(vGrid(unchecked(cells[i]),transpose)==d)return true;
  return false;
}

function buildPeers(v:i32,out:StaticArray<i32>):i32{
  const seen=new StaticArray<u8>(CELL_COUNT);for(let i:i32=0;i<CELL_COUNT;i++)unchecked(seen[i]=0);
  const r=v/9,c=v%9;let n=0;
  for(let i:i32=0;i<9;i++){
    const a=r*9+i;if(a!=v&&unchecked(seen[a])==0){unchecked(seen[a]=1);unchecked(out[n++]=a);}
    const b=i*9+c;if(b!=v&&unchecked(seen[b])==0){unchecked(seen[b]=1);unchecked(out[n++]=b);}
  }
  const br=(r/3)*3,bc=(c/3)*3;
  for(let dr:i32=0;dr<3;dr++)for(let dc:i32=0;dc<3;dc++){
    const q=(br+dr)*9+bc+dc;if(q!=v&&unchecked(seen[q])==0){unchecked(seen[q]=1);unchecked(out[n++]=q);}
  }
  return n;
}
function commonPeerConclusions(a:i32,b:i32,pairMask:u16,transpose:bool,buf:StaticArray<u16>,count:i32):i32{
  const pa=new StaticArray<i32>(20),pb=new StaticArray<i32>(20),mark=new StaticArray<u8>(CELL_COUNT);
  const na=buildPeers(a,pa),nb=buildPeers(b,pb);for(let i:i32=0;i<CELL_COUNT;i++)unchecked(mark[i]=0);
  for(let i:i32=0;i<na;i++)unchecked(mark[unchecked(pa[i])]=1);
  for(let i:i32=0;i<nb;i++){
    const v=unchecked(pb[i]);if(unchecked(mark[v])==0||vGrid(v,transpose)!=0)continue;
    const m=<u16>(vMask(v,transpose)&pairMask);for(let d:i32=1;d<=9;d++)if((m&bit(d))!=0)count=appendFact(buf,count,v,d);
  }
  return count;
}
function dedupFacts(src:StaticArray<u16>,srcCount:i32,transpose:bool,dst:StaticArray<u16>):i32{
  const seen=new StaticArray<u8>(FACT_COUNT);for(let i:i32=0;i<FACT_COUNT;i++)unchecked(seen[i]=0);
  let n=0;
  for(let i:i32=0;i<srcCount;i++){
    const k=<i32>unchecked(src[i]),v=k/9;
    if(vGrid(v,transpose)!=0||unchecked(seen[k])!=0)continue;
    unchecked(seen[k]=1);unchecked(dst[n++]=<u16>k);
  }
  return n;
}
function sanitize(elims:StaticArray<u16>,count:i32,transpose:bool):bool{
  const removed=new StaticArray<u16>(CELL_COUNT);
  for(let i:i32=0;i<CELL_COUNT;i++)unchecked(removed[i]=0);
  for(let i:i32=0;i<count;i++){
    const k=<i32>unchecked(elims[i]),v=k/9,d=k%9+1;
    unchecked(removed[v]=<u16>(unchecked(removed[v])|bit(d)));
  }
  for(let v:i32=0;v<CELL_COUNT;v++){
    const rm=unchecked(removed[v]);if(rm!=0&&(vMask(v,transpose)&<u16>(~rm))==0)return false;
  }
  return true;
}
function saveCommonResult(
  technique:i32,subtype:i32,transpose:bool,
  pattern:StaticArray<i32>,patternCount:i32,
  elims:StaticArray<u16>,elimCount:i32,
  base1:i32,base2:i32,baseMask:u16,target1:i32,target2:i32,
  trueBaseDigit:i32=0
):i32{
  if(elimCount==0)return 0;
  if(!sanitize(elims,elimCount,transpose)){rejectedRaw=true;return 0;}
  resultTechnique=technique;resultSubtype=subtype;resultOrientation=transpose?1:0;
  resultPatternCount=patternCount;for(let i:i32=0;i<patternCount;i++)unchecked(resultPattern[i]=<u8>unchecked(pattern[i]));
  resultElimCount=elimCount;for(let i:i32=0;i<elimCount;i++)unchecked(resultElims[i]=unchecked(elims[i]));
  unchecked(resultBase[0]=<u8>base1);unchecked(resultBase[1]=<u8>base2);
  unchecked(resultTargets[0]=<u8>target1);unchecked(resultTargets[1]=<u8>target2);
  resultBaseMask=<i32>baseMask;resultTrueBaseDigit=trueBaseDigit;
  return 1;
}
function bandOtherRow(bandStart:i32,baseRow:i32,ordinal:i32):i32{
  let n=0;for(let r:i32=bandStart;r<bandStart+3;r++)if(r!=baseRow){if(n==ordinal)return r;n++;}return -1;
}
function remainingBox(base:i32,ordinal:i32):i32{
  let n=0;for(let b:i32=0;b<3;b++)if(b!=base){if(n==ordinal)return b;n++;}return -1;
}
function pairCol(baseStart:i32,pair:i32,which:i32):i32{
  if(pair==0)return baseStart+(which==0?0:which==1?1:2);
  if(pair==1)return baseStart+(which==0?0:which==1?2:1);
  return baseStart+(which==0?1:which==1?2:0);
}

function juniorRow(transpose:bool):i32{
  const cross=new StaticArray<i32>(18),mirror1=new StaticArray<i32>(2),mirror2=new StaticArray<i32>(2);
  const temp=new StaticArray<u16>(MAX_LIST),dedup=new StaticArray<u16>(MAX_LIST);
  const pattern=new StaticArray<i32>(10);

  for(let bandIdx:i32=0;bandIdx<3;bandIdx++){
    const bandStart=bandIdx*3;
    for(let baseBox:i32=0;baseBox<3;baseBox++){
      const baseStart=baseBox*3;
      for(let baseRow:i32=bandStart;baseRow<bandStart+3;baseRow++){
        const or0=bandOtherRow(bandStart,baseRow,0),or1=bandOtherRow(bandStart,baseRow,1);
        for(let pair:i32=0;pair<3;pair++){
          const bc1=pairCol(baseStart,pair,0),bc2=pairCol(baseStart,pair,1),clb=pairCol(baseStart,pair,2);
          const base1=baseRow*9+bc1,base2=baseRow*9+bc2;
          if(vGrid(base1,transpose)!=0||vGrid(base2,transpose)!=0)continue;
          const baseMask=<u16>(vMask(base1,transpose)|vMask(base2,transpose));if(pop9(baseMask)<2)continue;

          const rb0=remainingBox(baseBox,0),rb1=remainingBox(baseBox,1);
          for(let swap:i32=0;swap<2;swap++){
            const t1Box=swap==0?rb0:rb1,t2Box=swap==0?rb1:rb0,t1Start=t1Box*3,t2Start=t2Box*3;
            for(let t1c:i32=t1Start;t1c<t1Start+3;t1c++)for(let t1ri:i32=0;t1ri<2;t1ri++){
              const t1r=t1ri==0?or0:or1,t1=t1r*9+t1c;if(vGrid(t1,transpose)!=0)continue;
              const c1r=t1r==or0?or1:or0,c1=c1r*9+t1c;
              if(vGrid(c1,transpose)!=0){if((baseMask&bit(vGrid(c1,transpose)))!=0)continue;}
              else if((vMask(c1,transpose)&baseMask)!=0)continue;
              const t1Mask=vMask(t1,transpose);

              for(let t2c:i32=t2Start;t2c<t2Start+3;t2c++)for(let t2ri:i32=0;t2ri<2;t2ri++){
                const t2r=t2ri==0?or0:or1,t2=t2r*9+t2c;if(vGrid(t2,transpose)!=0)continue;
                const c2r=t2r==or0?or1:or0,c2=c2r*9+t2c;
                if(vGrid(c2,transpose)!=0){if((baseMask&bit(vGrid(c2,transpose)))!=0)continue;}
                else if((vMask(c2,transpose)&baseMask)!=0)continue;
                const t2Mask=vMask(t2,transpose);

                let mi=0;
                for(let c:i32=t2Start;c<t2Start+3;c++)if(c!=t2c)unchecked(mirror1[mi++]=t2r*9+c);
                mi=0;for(let c:i32=t1Start;c<t1Start+3;c++)if(c!=t1c)unchecked(mirror2[mi++]=t1r*9+c);
                const mirror1Union=<u16>((vGrid(unchecked(mirror1[0]),transpose)!=0?bit(vGrid(unchecked(mirror1[0]),transpose)):vMask(unchecked(mirror1[0]),transpose))|
                  (vGrid(unchecked(mirror1[1]),transpose)!=0?bit(vGrid(unchecked(mirror1[1]),transpose)):vMask(unchecked(mirror1[1]),transpose)));
                const mirror2Union=<u16>((vGrid(unchecked(mirror2[0]),transpose)!=0?bit(vGrid(unchecked(mirror2[0]),transpose)):vMask(unchecked(mirror2[0]),transpose))|
                  (vGrid(unchecked(mirror2[1]),transpose)!=0?bit(vGrid(unchecked(mirror2[1]),transpose)):vMask(unchecked(mirror2[1]),transpose)));

                let crossCount=0;
                for(let obi:i32=0;obi<3;obi++)if(obi!=bandIdx){
                  const bs=obi*3;for(let r:i32=bs;r<bs+3;r++){
                    unchecked(cross[crossCount++]=r*9+clb);unchecked(cross[crossCount++]=r*9+t1c);unchecked(cross[crossCount++]=r*9+t2c);
                  }
                }

                let valid=true;
                for(let d:i32=1;d<=9;d++)if((baseMask&bit(d))!=0){
                  if(exactAppearingTimes(d,cross,crossCount,2,transpose))continue;
                  if(lockedMember(d,bandStart,t1Start,t1,baseRow,transpose))continue;
                  if(lockedMember(d,bandStart,t2Start,t2,baseRow,transpose))continue;
                  valid=false;break;
                }
                if(!valid)continue;

                let activeMask:u16=0;
                for(let d:i32=1;d<=9;d++)if((baseMask&bit(d))!=0){
                  const db=bit(d);
                  const ok1=(t1Mask&db)!=0&&(mirror1Union&db)!=0;
                  const ok2=(t2Mask&db)!=0&&(mirror2Union&db)!=0;
                  if(ok1||ok2)activeMask=<u16>(activeMask|db);
                }
                if(activeMask==0)continue;
                const baseInT1=<u16>(t1Mask&activeMask),baseInT2=<u16>(t2Mask&activeMask);
                if((mirror1Union&baseInT1)!=baseInT1||(mirror2Union&baseInT2)!=baseInT2||((t1Mask|t2Mask)&activeMask)!=activeMask)continue;

                // Pattern is fixed once a conclusion path succeeds.
                unchecked(pattern[0]=base1);unchecked(pattern[1]=base2);unchecked(pattern[2]=t1);unchecked(pattern[3]=t2);
                unchecked(pattern[4]=c1);unchecked(pattern[5]=c2);
                unchecked(pattern[6]=unchecked(mirror1[0]));unchecked(pattern[7]=unchecked(mirror1[1]));
                unchecked(pattern[8]=unchecked(mirror2[0]));unchecked(pattern[9]=unchecked(mirror2[1]));

                // 1) MirrorSync.
                let tc=0;
                if(!maskHasSolvedDigit(activeMask,cross,crossCount,transpose)){
                  for(let side:i32=0;side<2;side++){
                    const target=side==0?t1:t2,mir=side==0?mirror2:mirror1;
                    let emptyCount=0,mv=-1;
                    for(let j:i32=0;j<2;j++){const v=unchecked(mir[j]);if(vGrid(v,transpose)==0){emptyCount++;mv=v;}}
                    if(emptyCount!=1)continue;
                    const mirrorBase=<u16>(vMask(mv,transpose)&baseMask);if(mirrorBase==baseMask)continue;
                    const tm=vMask(target,transpose),remove=<u16>(tm&<u16>(~mirrorBase));
                    if(remove==0)continue;
                    for(let d:i32=1;d<=9;d++)if((remove&bit(d))!=0)tc=appendFact(temp,tc,target,d);
                    const last=<u16>((tm&baseMask)&<u16>(~remove));
                    const mm=vMask(mv,transpose);for(let d:i32=1;d<=9;d++)if((mm&bit(d))!=0&&(last&bit(d))==0)tc=appendFact(temp,tc,mv,d);
                  }
                }
                let dc=dedupFacts(temp,tc,transpose,dedup);
                if(dc>0)return saveCommonResult(48,0,transpose,pattern,10,dedup,dc,base1,base2,activeMask,t1,t2);

                // 2) Base Rule3/4.
                tc=0;
                for(let side:i32=0;side<2;side++){
                  const target=side==0?t1:t2,tm=side==0?t1Mask:t2Mask,remove=<u16>(tm&<u16>(~activeMask));
                  for(let d:i32=1;d<=9;d++)if((remove&bit(d))!=0)tc=appendFact(temp,tc,target,d);
                }
                const t1rem=<u16>(t1Mask&activeMask),t2rem=<u16>(t2Mask&activeMask);
                if(pop9(t1rem)==1&&pop9(t2rem)>=1){
                  const d=singleDigit9(t1rem);
                  if((t2rem&bit(d))!=0)tc=appendFact(temp,tc,t2,d);
                }
                if(pop9(t2rem)==1&&pop9(t1rem)>=1){
                  const d=singleDigit9(t2rem);
                  if((t1rem&bit(d))!=0)tc=appendFact(temp,tc,t1,d);
                }
                dc=dedupFacts(temp,tc,transpose,dedup);
                if(dc>0)return saveCommonResult(48,1,transpose,pattern,10,dedup,dc,base1,base2,activeMask,t1,t2);

                // 3) MirrorConjugatePair.
                tc=0;
                for(let side:i32=0;side<2;side++){
                  const target=side==0?t1:t2,mir=side==0?mirror1:mirror2;
                  const empties=new StaticArray<i32>(2);let ec=0,otherMask:u16=0;
                  for(let j:i32=0;j<2;j++){const v=unchecked(mir[j]);if(vGrid(v,transpose)==0){unchecked(empties[ec++]=v);otherMask=<u16>(otherMask|vMask(v,transpose));}}
                  if(ec==0)continue;
                  const houses=new StaticArray<i32>(3);let hc=0; // 0 row,1 col,2 box
                  unchecked(houses[hc++]=0);
                  if(ec==2){if(vBox(unchecked(empties[0]))==vBox(unchecked(empties[1])))unchecked(houses[hc++]=2);}
                  else {unchecked(houses[hc++]=1);unchecked(houses[hc++]=2);}
                  for(let hi:i32=0;hi<hc;hi++){
                    const ht=unchecked(houses[hi]),ref=unchecked(empties[0]),hidx=ht==0?ref/9:ht==1?ref%9:vBox(ref);
                    for(let d:i32=1;d<=9;d++)if((otherMask&bit(d))!=0){
                      let any=false,allIn=true;
                      for(let pos:i32=0;pos<9;pos++){
                        const v=ht==0?hidx*9+pos:ht==1?pos*9+hidx:((hidx/3)*3+pos/3)*9+(hidx%3)*3+pos%3;
                        if(v==target||vGrid(v,transpose)!=0||(vMask(v,transpose)&bit(d))==0)continue;
                        any=true;if(!listContains(empties,ec,v)){allIn=false;break;}
                      }
                      if(!any||!allIn)continue;
                      for(let ei:i32=0;ei<ec;ei++){
                        const v=unchecked(empties[ei]),remove=<u16>(vMask(v,transpose)&<u16>(~baseMask)&<u16>(~bit(d)));
                        for(let x:i32=1;x<=9;x++)if((remove&bit(x))!=0)tc=appendFact(temp,tc,v,x);
                      }
                    }
                  }
                }
                dc=dedupFacts(temp,tc,transpose,dedup);
                if(dc>0)return saveCommonResult(48,2,transpose,pattern,10,dedup,dc,base1,base2,activeMask,t1,t2);

                // 4) AdjacentTarget.
                tc=0;
                for(let side:i32=0;side<2;side++){
                  const otherTarget=side==0?t2:t1,mir=side==0?mirror1:mirror2;
                  let ec=0,mv=-1;for(let j:i32=0;j<2;j++){const v=unchecked(mir[j]);if(vGrid(v,transpose)==0){ec++;mv=v;}}
                  if(ec!=1)continue;
                  const mm=vMask(mv,transpose),outside=<u16>(mm&<u16>(~baseMask)),inside=<u16>(mm&baseMask);
                  for(let d:i32=1;d<=9;d++)if((outside&bit(d))!=0)tc=appendFact(temp,tc,mv,d);
                  const tm=vMask(otherTarget,transpose),remove=<u16>(tm&<u16>(~inside));
                  for(let d:i32=1;d<=9;d++)if((remove&bit(d))!=0)tc=appendFact(temp,tc,otherTarget,d);
                }
                dc=dedupFacts(temp,tc,transpose,dedup);
                if(dc>0)return saveCommonResult(48,3,transpose,pattern,10,dedup,dc,base1,base2,activeMask,t1,t2);

                // 5) IncompatiblePair + TargetPair + GeneralizedFish.
                tc=0;let inferred:u16=0;
                if(!maskHasSolvedDigit(activeMask,cross,crossCount,transpose)){
                  const valueCells=new StaticArray<i32>(12);let vc=0;
                  for(let obi:i32=0;obi<3;obi++)if(obi!=bandIdx){
                    const bs=obi*3;for(let r:i32=bs;r<bs+3;r++){
                      const a=r*9+t1c,b=r*9+t2c;if(vGrid(a,transpose)!=0)unchecked(valueCells[vc++]=a);if(vGrid(b,transpose)!=0)unchecked(valueCells[vc++]=b);
                    }
                  }
                  const valueRows=new StaticArray<i32>(6),valueCols=new StaticArray<i32>(2);let vrc=0,vcc=0;
                  for(let i:i32=0;i<vc;i++){const v=unchecked(valueCells[i]);vrc=uniqueAppend(valueRows,vrc,v/9);vcc=uniqueAppend(valueCols,vcc,v%9);}
                  if(vc==4&&vrc==2&&vcc==2){
                    const otherBand=new StaticArray<i32>(2);let obc=0;for(let bi:i32=0;bi<3;bi++)if(bi!=bandIdx)unchecked(otherBand[obc++]=bi);
                    const diagMask=new StaticArray<u16>(4); // ob0/t1, ob0/t2, ob1/t1, ob1/t2
                    for(let q:i32=0;q<4;q++)unchecked(diagMask[q]=0);
                    for(let obi:i32=0;obi<2;obi++){
                      const bs=unchecked(otherBand[obi])*3;
                      for(let r:i32=bs;r<bs+3;r++){
                        if(listContains(valueRows,vrc,r))continue;
                        for(let c:i32=t1Start;c<t1Start+3;c++)if(c!=t1c){const v=r*9+c,gv=vGrid(v,transpose);if(gv!=0)unchecked(diagMask[obi*2]=<u16>(unchecked(diagMask[obi*2])|bit(gv)));}
                        for(let c:i32=t2Start;c<t2Start+3;c++)if(c!=t2c){const v=r*9+c,gv=vGrid(v,transpose);if(gv!=0)unchecked(diagMask[obi*2+1]=<u16>(unchecked(diagMask[obi*2+1])|bit(gv)));}
                      }
                    }
                    const d1=<u16>(unchecked(diagMask[0])&unchecked(diagMask[3])),d2=<u16>(unchecked(diagMask[1])&unchecked(diagMask[2]));
                    if(d1!=0&&d2!=0){
                      const incompatible=new StaticArray<u16>(10);for(let d:i32=1;d<=9;d++)unchecked(incompatible[d]=0);
                      for(let x:i32=1;x<=9;x++)if((d1&bit(x))!=0)for(let y:i32=1;y<=9;y++)if((d2&bit(y))!=0){
                        unchecked(incompatible[x]=<u16>(unchecked(incompatible[x])|bit(y)));unchecked(incompatible[y]=<u16>(unchecked(incompatible[y])|bit(x)));
                      }
                      for(let side:i32=0;side<2;side++){
                        const ev=side==0?base1:base2,ov=side==0?base2:base1,em=vMask(ev,transpose),om=vMask(ov,transpose);
                        for(let d:i32=1;d<=9;d++)if((em&bit(d))!=0){
                          const expect=<u16>(om&<u16>(~bit(d)));if(unchecked(incompatible[d])==expect)tc=appendFact(temp,tc,ev,d);
                        }
                      }
                      if(tc>0){
                        let last=baseMask,targetDigits=<u16>(t1Mask|t2Mask);
                        for(let d:i32=1;d<=9;d++)if((targetDigits&bit(d))!=0){
                          let hits=0,h1=false,h2=false;
                          for(let i:i32=0;i<tc;i++){const k=<i32>unchecked(temp[i]);if(k%9+1!=d)continue;hits++;if(k/9==base1)h1=true;if(k/9==base2)h2=true;}
                          if(hits==2&&h1&&h2)last=<u16>(last&<u16>(~bit(d)));
                        }
                        if(pop9(last)==2)inferred=last;
                      }
                    }
                  }
                }
                if(inferred!=0){
                  for(let vIdx:i32=0;vIdx<4;vIdx++){
                    const v=vIdx==0?base1:vIdx==1?base2:vIdx==2?t1:t2,remove=<u16>(vMask(v,transpose)&<u16>(~inferred));
                    for(let d:i32=1;d<=9;d++)if((remove&bit(d))!=0)tc=appendFact(temp,tc,v,d);
                  }
                  tc=commonPeerConclusions(t1,t2,inferred,transpose,temp,tc);
                  tc=commonPeerConclusions(base1,base2,inferred,transpose,temp,tc);
                  const s0=clb,s1=t1c,s2=t2c;
                  for(let si:i32=0;si<3;si++){
                    const c=si==0?s0:si==1?s1:s2;let has=false;
                    for(let ci:i32=0;ci<crossCount;ci++){const v=unchecked(cross[ci]);if(v%9==c&&vGrid(v,transpose)==0&&(vMask(v,transpose)&inferred)!=0){has=true;break;}}
                    if(!has)continue;
                    for(let r:i32=bandStart;r<bandStart+3;r++){
                      const v=r*9+c;if(v==t1||v==t2||vGrid(v,transpose)!=0)continue;
                      const rm=<u16>(vMask(v,transpose)&inferred);for(let d:i32=1;d<=9;d++)if((rm&bit(d))!=0)tc=appendFact(temp,tc,v,d);
                    }
                  }
                }
                dc=dedupFacts(temp,tc,transpose,dedup);
                if(dc>0)return saveCommonResult(48,4,transpose,pattern,10,dedup,dc,base1,base2,activeMask,t1,t2);

                // 6) MirrorAlmostHiddenSet.
                tc=0;
                for(let side:i32=0;side<2;side++){
                  const target=side==0?t1:t2,mir=side==0?mirror1:mirror2;
                  const emptyMir=new StaticArray<i32>(2);let emc=0;for(let j:i32=0;j<2;j++){const v=unchecked(mir[j]);if(vGrid(v,transpose)==0)unchecked(emptyMir[emc++]=v);}
                  if(emc==0)continue;
                  const houseTypes=new StaticArray<i32>(3);let hc=0;unchecked(houseTypes[hc++]=0);
                  if(emc==2){if(vBox(unchecked(emptyMir[0]))==vBox(unchecked(emptyMir[1])))unchecked(houseTypes[hc++]=2);}
                  else {unchecked(houseTypes[hc++]=1);unchecked(houseTypes[hc++]=2);}
                  for(let hi:i32=0;hi<hc;hi++){
                    const ht=unchecked(houseTypes[hi]),ref=unchecked(emptyMir[0]),hidx=ht==0?ref/9:ht==1?ref%9:vBox(ref);
                    const others=new StaticArray<i32>(9);let oc=0;
                    for(let pos:i32=0;pos<9;pos++){
                      const v=ht==0?hidx*9+pos:ht==1?pos*9+hidx:((hidx/3)*3+pos/3)*9+(hidx%3)*3+pos%3;
                      if(vGrid(v,transpose)!=0||v==target||listContains(mir,2,v))continue;
                      unchecked(others[oc++]=v);
                    }
                    if(oc<2)continue;
                    const cidx=new StaticArray<i32>(8),didx=new StaticArray<i32>(9),extra=new StaticArray<i32>(8),digitList=new StaticArray<i32>(9);
                    for(let size:i32=2;size<=oc-1;size++){
                      const extraN=size-1;comboInit(cidx,extraN);
                      while(true){
                        let ahsMask:u16=0;
                        for(let i:i32=0;i<extraN;i++){const v=unchecked(others[unchecked(cidx[i])]);unchecked(extra[i]=v);ahsMask=<u16>(ahsMask|vMask(v,transpose));}
                        for(let i:i32=0;i<emc;i++)ahsMask=<u16>(ahsMask|vMask(unchecked(emptyMir[i]),transpose));
                        ahsMask=<u16>(ahsMask&<u16>(~baseMask));
                        let dn=0;for(let d:i32=1;d<=9;d++)if((ahsMask&bit(d))!=0)unchecked(digitList[dn++]=d);
                        if(dn>=size){
                          comboInit(didx,size);
                          while(true){
                            let dm:u16=0;for(let i:i32=0;i<size;i++)dm=<u16>(dm|bit(unchecked(digitList[unchecked(didx[i])])));
                            let coverCount=0,allAllowed=true;
                            for(let pos:i32=0;pos<9;pos++){
                              const v=ht==0?hidx*9+pos:ht==1?pos*9+hidx:((hidx/3)*3+pos/3)*9+(hidx%3)*3+pos%3;
                              if(v==target||vGrid(v,transpose)!=0||(vMask(v,transpose)&dm)==0)continue;
                              coverCount++;
                              if(!listContains(extra,extraN,v)&&!listContains(emptyMir,emc,v)){allAllowed=false;break;}
                            }
                            if(allAllowed&&coverCount==extraN+emc){
                              for(let i:i32=0;i<extraN;i++){
                                const v=unchecked(extra[i]),rm=<u16>(vMask(v,transpose)&<u16>(~dm));
                                for(let d:i32=1;d<=9;d++)if((rm&bit(d))!=0)tc=appendFact(temp,tc,v,d);
                              }
                            }
                            if(!comboNext(didx,dn,size))break;
                          }
                        }
                        if(!comboNext(cidx,oc,extraN))break;
                      }
                    }
                  }
                }
                dc=dedupFacts(temp,tc,transpose,dedup);
                if(dc>0)return saveCommonResult(48,5,transpose,pattern,10,dedup,dc,base1,base2,activeMask,t1,t2);
              }
            }
          }
        }
      }
    }
  }
  return 0;
}

function hasValidTargetInBox(baseMask:u16,bandStart:i32,baseRow:i32,boxIdx:i32,transpose:bool):bool{
  const start=boxIdx*3,or0=bandOtherRow(bandStart,baseRow,0),or1=bandOtherRow(bandStart,baseRow,1);
  for(let c:i32=start;c<start+3;c++)for(let ri:i32=0;ri<2;ri++){
    const r=ri==0?or0:or1,v=r*9+c;if(vGrid(v,transpose)!=0)continue;
    const cr=r==or0?or1:or0,comp=cr*9+c;
    if(vGrid(comp,transpose)!=0){if((baseMask&bit(vGrid(comp,transpose)))!=0)continue;}
    else if((vMask(comp,transpose)&baseMask)!=0)continue;
    return true;
  }
  return false;
}

function seniorRow(transpose:bool):i32{
  const cross=new StaticArray<i32>(22),reduced=new StaticArray<i32>(22),temp=new StaticArray<u16>(128),dedup=new StaticArray<u16>(128),pattern=new StaticArray<i32>(4);
  for(let bandIdx:i32=0;bandIdx<3;bandIdx++){
    const bandStart=bandIdx*3;
    for(let baseBox:i32=0;baseBox<3;baseBox++){
      const baseStart=baseBox*3;
      for(let baseRow:i32=bandStart;baseRow<bandStart+3;baseRow++){
        const or0=bandOtherRow(bandStart,baseRow,0),or1=bandOtherRow(bandStart,baseRow,1);
        for(let pair:i32=0;pair<3;pair++){
          const bc1=pairCol(baseStart,pair,0),bc2=pairCol(baseStart,pair,1),clb=pairCol(baseStart,pair,2);
          const base1=baseRow*9+bc1,base2=baseRow*9+bc2;if(vGrid(base1,transpose)!=0||vGrid(base2,transpose)!=0)continue;
          const baseMask=<u16>(vMask(base1,transpose)|vMask(base2,transpose));if(pop9(baseMask)<2)continue;
          const rb0=remainingBox(baseBox,0),rb1=remainingBox(baseBox,1);
          for(let swap:i32=0;swap<2;swap++){
            const primary=swap==0?rb0:rb1,other=swap==0?rb1:rb0;
            if(hasValidTargetInBox(baseMask,bandStart,baseRow,other,transpose))continue;
            const pStart=primary*3,oStart=other*3;
            for(let tc:i32=pStart;tc<pStart+3;tc++)for(let tri:i32=0;tri<2;tri++){
              const tr=tri==0?or0:or1,target=tr*9+tc;if(vGrid(target,transpose)!=0)continue;
              const cr=tr==or0?or1:or0,comp=cr*9+tc;
              if(vGrid(comp,transpose)!=0){if((baseMask&bit(vGrid(comp,transpose)))!=0)continue;}
              else if((vMask(comp,transpose)&baseMask)!=0)continue;
              const targetMask=vMask(target,transpose);

              for(let oc:i32=oStart;oc<oStart+3;oc++){
                let smallCount=0;
                for(let obi:i32=0;obi<3;obi++)if(obi!=bandIdx){
                  const bs=obi*3;for(let r:i32=bs;r<bs+3;r++){
                    unchecked(cross[smallCount++]=r*9+clb);unchecked(cross[smallCount++]=r*9+tc);unchecked(cross[smallCount++]=r*9+oc);
                  }
                }
                let largeCount=smallCount;
                for(let ri:i32=0;ri<2;ri++){
                  const r=ri==0?or0:or1;unchecked(cross[largeCount++]=r*9+tc);unchecked(cross[largeCount++]=r*9+oc);
                }
                let regionCount=0;
                for(let i:i32=0;i<largeCount;i++){const v=unchecked(cross[i]);if(v!=target)unchecked(reduced[regionCount++]=v);}
                const valueDigits=new StaticArray<i32>(9);let valueCount=0;
                for(let d:i32=1;d<=9;d++)if((baseMask&bit(d))!=0){
                  let present=false;for(let i:i32=0;i<regionCount;i++)if(vGrid(unchecked(reduced[i]),transpose)==d){present=true;break;}
                  if(present)unchecked(valueDigits[valueCount++]=d);
                }

                unchecked(pattern[0]=base1);unchecked(pattern[1]=base2);unchecked(pattern[2]=target);

                if(valueCount==1){
                  const trueD=unchecked(valueDigits[0]);let valid=true;
                  for(let d:i32=1;d<=9;d++)if((baseMask&bit(d))!=0&&d!=trueD&&!exactAppearingTimes(d,reduced,regionCount,2,transpose)){valid=false;break;}
                  if(!valid)continue;
                  let endo=-1,count=0;for(let i:i32=0;i<smallCount;i++){const v=unchecked(cross[i]);if(vGrid(v,transpose)==trueD){endo=v;count++;}}
                  if(count!=1)continue;
                  let n=0;const otherBase=<u16>(baseMask&<u16>(~bit(trueD))),rm=<u16>(targetMask&otherBase);
                  for(let d:i32=1;d<=9;d++)if((rm&bit(d))!=0)n=appendFact(temp,n,target,d);
                  if((vMask(base1,transpose)&bit(trueD))!=0)n=appendFact(temp,n,base1,trueD);
                  if((vMask(base2,transpose)&bit(trueD))!=0)n=appendFact(temp,n,base2,trueD);
                  const dc=dedupFacts(temp,n,transpose,dedup);if(dc==0)continue;
                  unchecked(pattern[3]=endo);
                  return saveCommonResult(49,0,transpose,pattern,4,dedup,dc,base1,base2,baseMask,target,endo,trueD);
                }
                if(valueCount!=0)continue;

                for(let ei:i32=0;ei<smallCount;ei++){
                  const endo=unchecked(cross[ei]);if(vGrid(endo,transpose)!=0||endo==target)continue;
                  const endoMask=vMask(endo,transpose);
                  if(((targetMask|endoMask)&baseMask)!=baseMask||(targetMask&endoMask&baseMask)==0)continue;
                  let rc=0;for(let i:i32=0;i<largeCount;i++){const v=unchecked(cross[i]);if(v!=target&&v!=endo)unchecked(reduced[rc++]=v);}
                  const locked=new StaticArray<i32>(9);let lc=0,valid=true;
                  for(let d:i32=1;d<=9;d++)if((baseMask&bit(d))!=0){
                    if(exactAppearingTimes(d,reduced,rc,2,transpose))continue;
                    if(lockedMember(d,bandStart,pStart,target,baseRow,transpose)){unchecked(locked[lc++]=d);continue;}
                    valid=false;break;
                  }
                  if(!valid||lc>1)continue;
                  let n=0,sub=2;
                  if(lc==1){
                    sub=1;const ld=unchecked(locked[0]),otherBase=<u16>(baseMask&<u16>(~bit(ld))),rm1=<u16>(endoMask&otherBase),rm2=<u16>(targetMask&<u16>(~baseMask));
                    for(let d:i32=1;d<=9;d++)if((rm1&bit(d))!=0)n=appendFact(temp,n,endo,d);
                    for(let d:i32=1;d<=9;d++)if((rm2&bit(d))!=0)n=appendFact(temp,n,target,d);
                    if(appearingTimes(ld,reduced,rc,transpose)<2){
                      const vs=new StaticArray<i32>(4);unchecked(vs[0]=base1);unchecked(vs[1]=base2);unchecked(vs[2]=target);unchecked(vs[3]=endo);
                      for(let q:i32=0;q<4;q++){const v=unchecked(vs[q]);if((vMask(v,transpose)&bit(ld))!=0)n=appendFact(temp,n,v,ld);}
                    }
                  }else{
                    const rm1=<u16>(targetMask&<u16>(~baseMask)),rm2=<u16>(endoMask&<u16>(~baseMask));
                    for(let d:i32=1;d<=9;d++)if((rm1&bit(d))!=0)n=appendFact(temp,n,target,d);
                    for(let d:i32=1;d<=9;d++)if((rm2&bit(d))!=0)n=appendFact(temp,n,endo,d);
                    const tr=<u16>(targetMask&baseMask),er=<u16>(endoMask&baseMask);
                    if(pop9(tr)==1){let d=0;for(let x:i32=1;x<=9;x++)if((tr&bit(x))!=0)d=x;if((er&bit(d))!=0)n=appendFact(temp,n,endo,d);}
                    if(pop9(er)==1){let d=0;for(let x:i32=1;x<=9;x++)if((er&bit(x))!=0)d=x;if((tr&bit(d))!=0)n=appendFact(temp,n,target,d);}
                  }
                  const dc=dedupFacts(temp,n,transpose,dedup);if(dc==0)continue;
                  unchecked(pattern[3]=endo);
                  return saveCommonResult(49,sub,transpose,pattern,4,dedup,dc,base1,base2,baseMask,target,endo);
                }
              }
            }
          }
        }
      }
    }
  }
  return 0;
}

export function juniorExocetFind():i32{
  resetResult();
  const row=juniorRow(false);
  if(row!=0)return row;
  if(rejectedRaw)return 0;
  return juniorRow(true);
}
export function seniorExocetFind():i32{
  resetResult();
  const row=seniorRow(false);
  if(row!=0)return row;
  if(rejectedRaw)return 0;
  return seniorRow(true);
}

export function exocetResultTechnique():i32{return resultTechnique;}
export function exocetResultSubtype():i32{return resultSubtype;}
export function exocetResultOrientation():i32{return resultOrientation;}
export function exocetResultPatternCount():i32{return resultPatternCount;}
export function exocetResultPatternAt(i:i32):i32{return i>=0&&i<resultPatternCount?<i32>unchecked(resultPattern[i]):-1;}
export function exocetResultEliminationCount():i32{return resultElimCount;}
export function exocetResultEliminationAt(i:i32):i32{return i>=0&&i<resultElimCount?<i32>unchecked(resultElims[i]):-1;}
export function exocetResultBaseAt(i:i32):i32{return i>=0&&i<2?<i32>unchecked(resultBase[i]):-1;}
export function exocetResultTargetAt(i:i32):i32{return i>=0&&i<2?<i32>unchecked(resultTargets[i]):-1;}
export function exocetResultBaseMask():i32{return resultBaseMask;}
export function exocetResultTrueBaseDigit():i32{return resultTrueBaseDigit;}
