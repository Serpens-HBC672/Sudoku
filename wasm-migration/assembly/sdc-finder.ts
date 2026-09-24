// Exact Sue de Coq discovery port for the frozen JS oracle.
// Candidate masks are authoritative u16 values restricted to bits 0..8.

const CELL_COUNT:i32=81;
const FACT_COUNT:i32=729;
const ALL_DIGITS:u16=0x01ff;

const grid=new StaticArray<u8>(CELL_COUNT);
const masks=new StaticArray<u16>(CELL_COUNT);

let actionType:i32=0;
const patternCells=new StaticArray<u8>(CELL_COUNT);
let patternCount:i32=0;
const eliminations=new StaticArray<u16>(FACT_COUNT);
let eliminationCount:i32=0;
const meta=new StaticArray<i32>(8);

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
@inline function empty(index:i32):bool{return unchecked(grid[index])==0;}
@inline function maskAt(index:i32):u16{return <u16>(unchecked(masks[index])&ALL_DIGITS);}
@inline function sees(a:i32,b:i32):bool{return a/9==b/9||a%9==b%9||boxOf(a)==boxOf(b);}
@inline function factIndex(index:i32,d:i32):i32{return (index/9)*81+(index%9)*9+(d-1);}
function pop9(value:u16):i32{
  let m=<u16>(value&ALL_DIGITS),n:i32=0;
  while(m!=0){m=<u16>(m&<u16>(m-1));n++;}
  return n;
}
function appendPattern(index:i32):void{unchecked(patternCells[patternCount++]=<u8>index);}
function appendElim(index:i32,d:i32):void{unchecked(eliminations[eliminationCount++]=<u16>factIndex(index,d));}

export function sdcResetInput():void{
  for(let i:i32=0;i<CELL_COUNT;i++){unchecked(grid[i]=0);unchecked(masks[i]=0);}
}
export function sdcSetInputCell(index:i32,digit:i32):void{
  if(index>=0&&index<CELL_COUNT)unchecked(grid[index]=<u8>digit);
}
export function sdcSetInputMask(index:i32,mask:i32):void{
  if(index>=0&&index<CELL_COUNT)unchecked(masks[index]=<u16>(mask&0x1ff));
}

function buildWings(
  cells:StaticArray<i32>,cellCount:i32,
  w0:StaticArray<i32>,w1:StaticArray<i32>,wSize:StaticArray<u8>,wMask:StaticArray<u16>
):i32{
  let count:i32=0;
  for(let i:i32=0;i<cellCount;i++){
    const a=unchecked(cells[i]),m=maskAt(a);
    if(pop9(m)<=2){
      unchecked(w0[count]=a);unchecked(w1[count]=-1);unchecked(wSize[count]=1);unchecked(wMask[count]=m);count++;
    }
  }
  for(let i:i32=0;i<cellCount-1;i++)for(let j:i32=i+1;j<cellCount;j++){
    const a=unchecked(cells[i]),b=unchecked(cells[j]),m=<u16>(maskAt(a)|maskAt(b));
    if(pop9(m)<=3){
      unchecked(w0[count]=a);unchecked(w1[count]=b);unchecked(wSize[count]=2);unchecked(wMask[count]=m);count++;
    }
  }
  return count;
}
function inPattern(index:i32):bool{
  for(let i:i32=0;i<patternCount;i++)if(<i32>unchecked(patternCells[i])==index)return true;
  return false;
}

export function sdcFind():i32{
  actionType=0;patternCount=0;eliminationCount=0;
  const boxCells=new StaticArray<i32>(9);
  const lineCells=new StaticArray<i32>(9);
  const ir=new StaticArray<i32>(3);
  const lineRest=new StaticArray<i32>(9);
  const boxRest=new StaticArray<i32>(9);
  const aw0=new StaticArray<i32>(40),aw1=new StaticArray<i32>(40),bw0=new StaticArray<i32>(40),bw1=new StaticArray<i32>(40);
  const awSize=new StaticArray<u8>(40),bwSize=new StaticArray<u8>(40);
  const awMask=new StaticArray<u16>(40),bwMask=new StaticArray<u16>(40);

  for(let box:i32=0;box<9;box++){
    let boxCount:i32=0;
    for(let pos:i32=0;pos<9;pos++){
      const index=unitCell(2,box,pos);
      if(empty(index))unchecked(boxCells[boxCount++]=index);
    }
    if(boxCount<3)continue;

    for(let lineType:i32=0;lineType<2;lineType++){
      const base=lineType==0?(box/3)*3:(box%3)*3;
      for(let offset:i32=0;offset<3;offset++){
        const lineIdx=base+offset;
        let lineCount:i32=0;
        for(let pos:i32=0;pos<9;pos++){
          const index=unitCell(lineType,lineIdx,pos);
          if(empty(index))unchecked(lineCells[lineCount++]=index);
        }

        let irCount:i32=0,irMask:u16=0;
        for(let i:i32=0;i<lineCount;i++){
          const index=unchecked(lineCells[i]);
          if(boxOf(index)!=box)continue;
          unchecked(ir[irCount++]=index);irMask=<u16>(irMask|maskAt(index));
        }
        if(irCount<2||pop9(irMask)<irCount+1)continue;

        let lineRestCount:i32=0;
        for(let i:i32=0;i<lineCount;i++){
          const index=unchecked(lineCells[i]);let hit=false;
          for(let k:i32=0;k<irCount;k++)if(unchecked(ir[k])==index){hit=true;break;}
          if(!hit)unchecked(lineRest[lineRestCount++]=index);
        }
        let boxRestCount:i32=0;
        for(let i:i32=0;i<boxCount;i++){
          const index=unchecked(boxCells[i]);let hit=false;
          for(let k:i32=0;k<irCount;k++)if(unchecked(ir[k])==index){hit=true;break;}
          if(!hit)unchecked(boxRest[boxRestCount++]=index);
        }

        const ac=buildWings(lineRest,lineRestCount,aw0,aw1,awSize,awMask);
        const bc=buildWings(boxRest,boxRestCount,bw0,bw1,bwSize,bwMask);
        for(let ai:i32=0;ai<ac;ai++){
          const am=unchecked(awMask[ai]);
          if((am&irMask)!=am)continue;
          for(let bi:i32=0;bi<bc;bi++){
            const bm=unchecked(bwMask[bi]);
            if((bm&irMask)!=bm||(am&bm)!=0)continue;
            const union=<u16>(am|bm);
            if((irMask&union)!=irMask)continue;
            const as=<i32>unchecked(awSize[ai]),bs=<i32>unchecked(bwSize[bi]);
            if(pop9(union)!=irCount+as+bs)continue;

            patternCount=0;
            for(let i:i32=0;i<irCount;i++)appendPattern(unchecked(ir[i]));
            appendPattern(unchecked(aw0[ai]));if(as==2)appendPattern(unchecked(aw1[ai]));
            appendPattern(unchecked(bw0[bi]));if(bs==2)appendPattern(unchecked(bw1[bi]));

            eliminationCount=0;
            for(let d:i32=1;d<=9;d++){
              const db=bit(d);if((union&db)==0)continue;
              for(let index:i32=0;index<CELL_COUNT;index++){
                if(inPattern(index)||!empty(index)||(maskAt(index)&db)==0)continue;
                let all=true;
                for(let pi:i32=0;pi<patternCount;pi++){
                  const p=<i32>unchecked(patternCells[pi]);
                  if((maskAt(p)&db)!=0&&!sees(index,p)){all=false;break;}
                }
                if(all)appendElim(index,d);
              }
            }
            if(eliminationCount>0){
              actionType=2;
              unchecked(meta[0]=box);unchecked(meta[1]=lineType);unchecked(meta[2]=lineIdx);
              unchecked(meta[3]=irCount);unchecked(meta[4]=as);unchecked(meta[5]=bs);unchecked(meta[6]=<i32>union);
              return actionType;
            }
          }
        }
      }
    }
  }
  return 0;
}

export function sdcResultActionType():i32{return actionType;}
export function sdcResultPatternCount():i32{return patternCount;}
export function sdcResultPatternAt(i:i32):i32{return i>=0&&i<patternCount?<i32>unchecked(patternCells[i]):-1;}
export function sdcResultEliminationCount():i32{return eliminationCount;}
export function sdcResultEliminationAt(i:i32):i32{return i>=0&&i<eliminationCount?<i32>unchecked(eliminations[i]):-1;}
export function sdcResultMeta(i:i32):i32{return i>=0&&i<8?unchecked(meta[i]):0;}
