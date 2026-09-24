// Exact Tridagon Type 1/2/3 discovery port for the frozen JS oracle.
// Preserves band/stack/pattern/triple-mask ordering and Type1 > Type2 > Type3 priority.

const CELL_COUNT:i32=81;
const FACT_COUNT:i32=729;
const ALL_DIGITS:u16=0x01ff;

const grid=new StaticArray<u8>(CELL_COUNT);
const masks=new StaticArray<u16>(CELL_COUNT);

let actionType:i32=0;
let variant:i32=0;
const patternCells=new StaticArray<u8>(32);
let patternCount:i32=0;
const eliminations=new StaticArray<u16>(FACT_COUNT);
let eliminationCount:i32=0;
const guardianCells=new StaticArray<u8>(12);
let guardianCountOut:i32=0;
const subsetCells=new StaticArray<u8>(9);
let subsetCount:i32=0;
const blocksOut=new StaticArray<u8>(4);
const meta=new StaticArray<i32>(12);

@inline function bit(d:i32):u16{
  switch(d){
    case 1:return 0x001;case 2:return 0x002;case 3:return 0x004;
    case 4:return 0x008;case 5:return 0x010;case 6:return 0x020;
    case 7:return 0x040;case 8:return 0x080;case 9:return 0x100;
    default:return 0;
  }
}
@inline function boxOf(index:i32):i32{
  const r=index/9,c=index%9;return (r/3)*3+c/3;
}
@inline function unitCell(unitType:i32,idx:i32,pos:i32):i32{
  if(unitType==0)return idx*9+pos;
  if(unitType==1)return pos*9+idx;
  const br=(idx/3)*3,bc=(idx%3)*3;
  return (br+pos/3)*9+(bc+pos%3);
}
@inline function maskAt(index:i32):u16{return <u16>(unchecked(masks[index])&ALL_DIGITS);}
@inline function fact(index:i32,d:i32):i32{return index*9+(d-1);}
@inline function sees(a:i32,b:i32):bool{return a/9==b/9||a%9==b%9||boxOf(a)==boxOf(b);}
function pop9(value:u16):i32{
  let m=<u16>(value&ALL_DIGITS),n:i32=0;
  while(m!=0){m=<u16>(m&<u16>(m-1));n++;}
  return n;
}
function singletonDigit(mask:u16):i32{
  for(let d:i32=1;d<=9;d++)if((mask&bit(d))!=0)return d;
  return 0;
}
function appendElim(index:i32,d:i32):void{unchecked(eliminations[eliminationCount++]=<u16>fact(index,d));}
function resetResult():void{
  actionType=0;variant=0;patternCount=0;eliminationCount=0;guardianCountOut=0;subsetCount=0;
  for(let i:i32=0;i<12;i++)unchecked(meta[i]=0);
}

export function tridagonResetInput():void{
  for(let i:i32=0;i<CELL_COUNT;i++){unchecked(grid[i]=0);unchecked(masks[i]=0);}
}
export function tridagonSetInputCell(index:i32,digit:i32):void{
  if(index>=0&&index<CELL_COUNT)unchecked(grid[index]=<u8>digit);
}
export function tridagonSetInputMask(index:i32,mask:i32):void{
  if(index>=0&&index<CELL_COUNT)unchecked(masks[index]=<u16>(mask&0x1ff));
}

function pairFirst(pairIndex:i32):i32{return pairIndex==0?0:pairIndex==1?0:1;}
function pairSecond(pairIndex:i32):i32{return pairIndex==0?1:pairIndex==1?2:2;}

// Shape cell local offsets. orientation 0=diag,1=anti.
function shapeIndexToLocal(orientation:i32,shape:i32,pos:i32):i32{
  if(orientation==0){
    if(shape==0)return pos==0?0:pos==1?10:20;
    if(shape==1)return pos==0?1:pos==1?11:18;
    return pos==0?2:pos==1?9:19;
  }
  if(shape==0)return pos==0?0:pos==1?11:19;
  if(shape==1)return pos==0?1:pos==1?9:20;
  return pos==0?2:pos==1?10:18;
}
function patternCell(
  blockK:i32,odd:i32,oddUsesDiag:bool,combo:i32,
  br0:i32,bc0:i32,br1:i32,bc1:i32,br2:i32,bc2:i32,br3:i32,bc3:i32,
  pos:i32
):i32{
  let rest=combo;
  let shape:i32=0;
  for(let k:i32=0;k<=blockK;k++){shape=rest%3;rest=rest/3;}
  const useDiag=(blockK==odd)==oddUsesDiag;
  const local=shapeIndexToLocal(useDiag?0:1,shape,pos);
  const lr=local/9,lc=local%9;
  let br=br0,bc=bc0;
  if(blockK==1){br=br1;bc=bc1;}
  else if(blockK==2){br=br2;bc=bc2;}
  else if(blockK==3){br=br3;bc=bc3;}
  return (br*3+lr)*9+(bc*3+lc);
}

function fillBlocks(b1:i32,b2:i32,s1:i32,s2:i32):void{
  unchecked(blocksOut[0]=<u8>(b1*3+s1));
  unchecked(blocksOut[1]=<u8>(b1*3+s2));
  unchecked(blocksOut[2]=<u8>(b2*3+s1));
  unchecked(blocksOut[3]=<u8>(b2*3+s2));
}

function commonPeerElims(guards:StaticArray<i32>,gCount:i32,z:i32):i32{
  eliminationCount=0;
  const zb=bit(z);
  for(let index:i32=0;index<CELL_COUNT;index++){
    if(maskAt(index)==0||(maskAt(index)&zb)==0)continue;
    let all=true;
    for(let i:i32=0;i<gCount;i++)if(!sees(index,unchecked(guards[i]))){all=false;break;}
    if(all)appendElim(index,z);
  }
  return eliminationCount;
}

function guardianContains(guards:StaticArray<i32>,gCount:i32,index:i32):bool{
  for(let i:i32=0;i<gCount;i++)if(unchecked(guards[i])==index)return true;
  return false;
}

// Returns 1 and writes Type3 metadata/eliminations on the first JS-ordered hit.
function tryType3(guards:StaticArray<i32>,gCount:i32,ex:u16):i32{
  const first=unchecked(guards[0]),r0=first/9,c0=first%9,b0=boxOf(first);
  const houseType=new StaticArray<i32>(3),houseIdx=new StaticArray<i32>(3);
  let houseCount:i32=0;
  let sameRow=true,sameCol=true,sameBox=true;
  for(let i:i32=1;i<gCount;i++){
    const cell=unchecked(guards[i]);
    if(cell/9!=r0)sameRow=false;
    if(cell%9!=c0)sameCol=false;
    if(boxOf(cell)!=b0)sameBox=false;
  }
  if(sameRow){unchecked(houseType[houseCount]=0);unchecked(houseIdx[houseCount++]=r0);}
  if(sameCol){unchecked(houseType[houseCount]=1);unchecked(houseIdx[houseCount++]=c0);}
  if(sameBox){unchecked(houseType[houseCount]=2);unchecked(houseIdx[houseCount++]=b0);}

  const free=new StaticArray<i32>(9);
  for(let hi:i32=0;hi<houseCount;hi++){
    const ut=unchecked(houseType[hi]),idx=unchecked(houseIdx[hi]);
    let freeCount:i32=0;
    for(let pos:i32=0;pos<9;pos++){
      const index=unitCell(ut,idx,pos);
      if(guardianContains(guards,gCount,index))continue;
      if(maskAt(index)>0)unchecked(free[freeCount++]=index);
    }
    const limit=1<<freeCount;
    for(let sub:i32=1;sub<limit;sub++){
      let size:i32=0,union:u16=ex;
      for(let j:i32=0;j<freeCount;j++)if(((sub>>j)&1)!=0){
        size++;union=<u16>(union|maskAt(unchecked(free[j])));
      }
      if(size>3||pop9(union)!=size+1)continue;
      eliminationCount=0;subsetCount=0;
      for(let j:i32=0;j<freeCount;j++){
        const index=unchecked(free[j]);
        if(((sub>>j)&1)!=0){unchecked(subsetCells[subsetCount++]=<u8>index);continue;}
        const hit=<u16>(maskAt(index)&union);
        for(let d:i32=1;d<=9;d++)if((hit&bit(d))!=0)appendElim(index,d);
      }
      if(eliminationCount>0){
        unchecked(meta[4]=ut);unchecked(meta[5]=idx);unchecked(meta[6]=<i32>union);
        return 1;
      }
    }
  }
  return 0;
}

function savePattern(cells:StaticArray<i32>):void{
  patternCount=12;
  for(let i:i32=0;i<12;i++)unchecked(patternCells[i]=<u8>unchecked(cells[i]));
}
function saveGuardians(guards:StaticArray<i32>,gCount:i32):void{
  guardianCountOut=gCount;
  for(let i:i32=0;i<gCount;i++)unchecked(guardianCells[i]=<u8>unchecked(guards[i]));
}

export function tridagonFind():i32{
  resetResult();
  const cells=new StaticArray<i32>(12),cellMasks=new StaticArray<u16>(12),guards=new StaticArray<i32>(12);
  let savedType2=false,savedType3=false;
  const type2Pattern=new StaticArray<u8>(12),type2Elims=new StaticArray<u16>(FACT_COUNT),type2Guards=new StaticArray<u8>(12),type2Blocks=new StaticArray<u8>(4);
  let type2ElimCount:i32=0,type2GuardCount:i32=0,type2Triple:i32=0,type2Ex:i32=0,type2Z:i32=0;
  const type3Pattern=new StaticArray<u8>(32),type3Elims=new StaticArray<u16>(FACT_COUNT),type3Guards=new StaticArray<u8>(12),type3Subset=new StaticArray<u8>(9),type3Blocks=new StaticArray<u8>(4);
  let type3PatternCount:i32=0,type3ElimCount:i32=0,type3GuardCount:i32=0,type3SubsetCount:i32=0;
  let type3Triple:i32=0,type3Ex:i32=0,type3HouseType:i32=0,type3HouseIdx:i32=0,type3Union:i32=0;

  for(let bp:i32=0;bp<3;bp++){
    const b1=pairFirst(bp),b2=pairSecond(bp);
    for(let sp:i32=0;sp<3;sp++){
      const s1=pairFirst(sp),s2=pairSecond(sp);
      fillBlocks(b1,b2,s1,s2);
      for(let odd:i32=0;odd<4;odd++){
        for(let orient:i32=0;orient<2;orient++){
          const oddUsesDiag=orient==0; // JS [true,false]
          for(let combo:i32=0;combo<81;combo++){
            let usable=true,bigCells:i32=0,unionAll:u16=0,ci:i32=0;
            for(let k:i32=0;k<4&&usable;k++)for(let p:i32=0;p<3;p++){
              const br=k<2?b1:b2,bc=(k==0||k==2)?s1:s2;
              const index=patternCell(k,odd,oddUsesDiag,combo,b1,s1,b1,s2,b2,s1,b2,s2,p);
              const m=maskAt(index);
              if(m==0||(m&<u16>(m-1))==0){usable=false;break;}
              if(pop9(m)>4)bigCells++;
              unionAll=<u16>(unionAll|m);
              unchecked(cells[ci]=index);unchecked(cellMasks[ci]=m);ci++;
            }
            if(!usable||bigCells>4)continue;

            for(let triple:i32=0;triple<512;triple++){
              const T=<u16>triple;if(pop9(T)!=3||(unionAll&T)!=T)continue;
              let ex:u16=0,gCount:i32=0,lastGuardian:i32=-1,ok=true;
              for(let i:i32=0;i<12;i++){
                const m=unchecked(cellMasks[i]);
                if((m&T)==0){ok=false;break;}
                const e=<u16>(m&<u16>(~T));
                if(e!=0){
                  ex=<u16>(ex|e);unchecked(guards[gCount++]=unchecked(cells[i]));lastGuardian=i;
                  if(gCount>4&&pop9(ex)>1){ok=false;break;}
                }
              }
              if(!ok||gCount==0)continue;

              if(gCount==1){
                const target=unchecked(cells[lastGuardian]);
                eliminationCount=0;
                const remove=<u16>(unchecked(cellMasks[lastGuardian])&T);
                for(let d:i32=1;d<=9;d++)if((remove&bit(d))!=0)appendElim(target,d);
                if(eliminationCount>0){
                  actionType=2;variant=1;savePattern(cells);saveGuardians(guards,gCount);
                  unchecked(meta[0]=triple);unchecked(meta[1]=<i32>ex);unchecked(meta[2]=target);
                  return actionType;
                }
              }

              if(savedType2)continue;

              if(pop9(ex)==1){
                const z=singletonDigit(ex);
                if(commonPeerElims(guards,gCount,z)>0){
                  savedType2=true;type2ElimCount=eliminationCount;type2GuardCount=gCount;
                  type2Triple=triple;type2Ex=<i32>ex;type2Z=z;
                  for(let i:i32=0;i<12;i++)unchecked(type2Pattern[i]=<u8>unchecked(cells[i]));
                  for(let i:i32=0;i<gCount;i++)unchecked(type2Guards[i]=<u8>unchecked(guards[i]));
                  for(let i:i32=0;i<eliminationCount;i++)unchecked(type2Elims[i]=unchecked(eliminations[i]));
                  for(let i:i32=0;i<4;i++)unchecked(type2Blocks[i]=unchecked(blocksOut[i]));
                  continue;
                }
              }

              if(savedType3||gCount>4)continue;
              if(tryType3(guards,gCount,ex)!=0){
                savedType3=true;type3PatternCount=12+subsetCount;type3ElimCount=eliminationCount;type3GuardCount=gCount;type3SubsetCount=subsetCount;
                type3Triple=triple;type3Ex=<i32>ex;type3HouseType=unchecked(meta[4]);type3HouseIdx=unchecked(meta[5]);type3Union=unchecked(meta[6]);
                for(let i:i32=0;i<12;i++)unchecked(type3Pattern[i]=<u8>unchecked(cells[i]));
                for(let i:i32=0;i<subsetCount;i++){unchecked(type3Subset[i]=unchecked(subsetCells[i]));unchecked(type3Pattern[12+i]=unchecked(subsetCells[i]));}
                for(let i:i32=0;i<gCount;i++)unchecked(type3Guards[i]=<u8>unchecked(guards[i]));
                for(let i:i32=0;i<eliminationCount;i++)unchecked(type3Elims[i]=unchecked(eliminations[i]));
                for(let i:i32=0;i<4;i++)unchecked(type3Blocks[i]=unchecked(blocksOut[i]));
              }
            }
          }
        }
      }
    }
  }

  if(savedType2){
    actionType=2;variant=2;patternCount=12;eliminationCount=type2ElimCount;guardianCountOut=type2GuardCount;subsetCount=0;
    for(let i:i32=0;i<12;i++)unchecked(patternCells[i]=unchecked(type2Pattern[i]));
    for(let i:i32=0;i<eliminationCount;i++)unchecked(eliminations[i]=unchecked(type2Elims[i]));
    for(let i:i32=0;i<guardianCountOut;i++)unchecked(guardianCells[i]=unchecked(type2Guards[i]));
    for(let i:i32=0;i<4;i++)unchecked(blocksOut[i]=unchecked(type2Blocks[i]));
    unchecked(meta[0]=type2Triple);unchecked(meta[1]=type2Ex);unchecked(meta[3]=type2Z);
    return actionType;
  }
  if(savedType3){
    actionType=2;variant=3;patternCount=type3PatternCount;eliminationCount=type3ElimCount;guardianCountOut=type3GuardCount;subsetCount=type3SubsetCount;
    for(let i:i32=0;i<patternCount;i++)unchecked(patternCells[i]=unchecked(type3Pattern[i]));
    for(let i:i32=0;i<eliminationCount;i++)unchecked(eliminations[i]=unchecked(type3Elims[i]));
    for(let i:i32=0;i<guardianCountOut;i++)unchecked(guardianCells[i]=unchecked(type3Guards[i]));
    for(let i:i32=0;i<subsetCount;i++)unchecked(subsetCells[i]=unchecked(type3Subset[i]));
    for(let i:i32=0;i<4;i++)unchecked(blocksOut[i]=unchecked(type3Blocks[i]));
    unchecked(meta[0]=type3Triple);unchecked(meta[1]=type3Ex);unchecked(meta[4]=type3HouseType);unchecked(meta[5]=type3HouseIdx);unchecked(meta[6]=type3Union);
    return actionType;
  }
  return 0;
}

export function tridagonResultActionType():i32{return actionType;}
export function tridagonResultVariant():i32{return variant;}
export function tridagonResultPatternCount():i32{return patternCount;}
export function tridagonResultPatternAt(i:i32):i32{return i>=0&&i<patternCount?<i32>unchecked(patternCells[i]):-1;}
export function tridagonResultEliminationCount():i32{return eliminationCount;}
export function tridagonResultEliminationAt(i:i32):i32{return i>=0&&i<eliminationCount?<i32>unchecked(eliminations[i]):-1;}
export function tridagonResultGuardianCount():i32{return guardianCountOut;}
export function tridagonResultGuardianAt(i:i32):i32{return i>=0&&i<guardianCountOut?<i32>unchecked(guardianCells[i]):-1;}
export function tridagonResultSubsetCount():i32{return subsetCount;}
export function tridagonResultSubsetAt(i:i32):i32{return i>=0&&i<subsetCount?<i32>unchecked(subsetCells[i]):-1;}
export function tridagonResultBlockAt(i:i32):i32{return i>=0&&i<4?<i32>unchecked(blocksOut[i]):-1;}
export function tridagonResultMeta(i:i32):i32{return i>=0&&i<12?unchecked(meta[i]):0;}
