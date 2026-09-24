// Exact SK Loop discovery port for the frozen JS oracle.
// Preserves pair ordering, byDigit insertion order, numeric cover-mask ties,
// sector traversal order and duplicate elimination entries.

const CELL_COUNT:i32=81;
const FACT_COUNT:i32=729;
const ALL:u16=0x01ff;

const grid=new StaticArray<u8>(CELL_COUNT);
const masks=new StaticArray<u16>(CELL_COUNT);

const pattern=new StaticArray<u8>(32);
let patternCount:i32=0;
const eliminations=new StaticArray<u16>(FACT_COUNT);
let eliminationCount:i32=0;
const rowsOut=new StaticArray<u8>(2);
const colsOut=new StaticArray<u8>(2);
const boxesOut=new StaticArray<u8>(4);

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
@inline function empty(index:i32):bool{return unchecked(grid[index])==0;}
@inline function maskAt(index:i32):u16{return <u16>(unchecked(masks[index])&ALL);}
@inline function fact(index:i32,d:i32):i32{return index*9+(d-1);}
function pop(value:i32):i32{
  let x=value,n:i32=0;while(x!=0){x&=x-1;n++;}return n;
}

export function skResetInput():void{
  for(let i:i32=0;i<CELL_COUNT;i++){unchecked(grid[i]=0);unchecked(masks[i]=0);}
}
export function skSetInputCell(index:i32,digit:i32):void{
  if(index>=0&&index<CELL_COUNT)unchecked(grid[index]=<u8>digit);
}
export function skSetInputMask(index:i32,mask:i32):void{
  if(index>=0&&index<CELL_COUNT)unchecked(masks[index]=<u16>(mask&0x1ff));
}

function boxPosition(boxes:StaticArray<i32>,box:i32):i32{
  for(let i:i32=0;i<4;i++)if(unchecked(boxes[i])==box)return i;
  return -1;
}
function sectorsMask(index:i32,r1:i32,r2:i32,c1:i32,c2:i32,boxes:StaticArray<i32>):i32{
  const r=index/9,c=index%9;
  let m:i32=0;
  if(r==r1)m|=1<<0;
  if(r==r2)m|=1<<1;
  if(c==c1)m|=1<<2;
  if(c==c2)m|=1<<3;
  const bi=boxPosition(boxes,boxOf(index));
  if(bi>=0)m|=1<<(4+bi);
  return m;
}
function inPattern(index:i32):bool{
  for(let i:i32=0;i<patternCount;i++)if(<i32>unchecked(pattern[i])==index)return true;
  return false;
}
function sectorCell(s:i32,pos:i32,r1:i32,r2:i32,c1:i32,c2:i32,boxes:StaticArray<i32>):i32{
  if(s==0)return r1*9+pos;
  if(s==1)return r2*9+pos;
  if(s==2)return pos*9+c1;
  if(s==3)return pos*9+c2;
  const bx=unchecked(boxes[s-4]),br=(bx/3)*3,bc=(bx%3)*3;
  return (br+pos/3)*9+(bc+pos%3);
}

export function skLoopFind():i32{
  patternCount=0;eliminationCount=0;
  const boxes=new StaticArray<i32>(4);
  const digitSeen=new StaticArray<u8>(10);
  const digitOrder=new StaticArray<u8>(9);
  const pairMasks=new StaticArray<u8>(10*32); // digit-indexed 1..9; <=16 intersection occurrences per digit
  const pairCount=new StaticArray<u8>(10);
  const coverMask=new StaticArray<u8>(10);

  for(let r1:i32=0;r1<8;r1++)for(let r2:i32=r1+1;r2<9;r2++){
    if(r1/3==r2/3)continue;
    for(let c1:i32=0;c1<8;c1++)for(let c2:i32=c1+1;c2<9;c2++){
      if(c1/3==c2/3)continue;
      unchecked(boxes[0]=boxOf(r1*9+c1));
      unchecked(boxes[1]=boxOf(r1*9+c2));
      unchecked(boxes[2]=boxOf(r2*9+c1));
      unchecked(boxes[3]=boxOf(r2*9+c2));
      let distinct=true;
      for(let i:i32=0;i<4;i++)for(let j:i32=0;j<i;j++)if(unchecked(boxes[i])==unchecked(boxes[j]))distinct=false;
      if(!distinct)continue;

      patternCount=0;
      for(let index:i32=0;index<CELL_COUNT;index++){
        if(!empty(index))continue;
        const sm=sectorsMask(index,r1,r2,c1,c2,boxes);
        if(pop(sm)==2)unchecked(pattern[patternCount++]=<u8>index);
      }
      if(patternCount==0||patternCount>16)continue;

      for(let d:i32=1;d<=9;d++){unchecked(digitSeen[d]=0);unchecked(pairCount[d]=0);unchecked(coverMask[d]=0);}
      let digitCount:i32=0;
      for(let pi:i32=0;pi<patternCount;pi++){
        const index=<i32>unchecked(pattern[pi]),m=maskAt(index);
        const sm=sectorsMask(index,r1,r2,c1,c2,boxes);
        for(let d:i32=1;d<=9;d++){
          if((m&bit(d))==0)continue;
          if(unchecked(digitSeen[d])==0){unchecked(digitSeen[d]=1);unchecked(digitOrder[digitCount++]=<u8>d);}
          const n=<i32>unchecked(pairCount[d]);
          unchecked(pairMasks[d*32+n]=<u8>sm);unchecked(pairCount[d]=<u8>(n+1));
        }
      }

      let totalLinks:i32=0,feasible=true;
      for(let oi:i32=0;oi<digitCount;oi++){
        const d=<i32>unchecked(digitOrder[oi]),n=<i32>unchecked(pairCount[d]);
        let bestMask:i32=0,bestSize:i32=99;
        for(let cm:i32=1;cm<256;cm++){
          const size=pop(cm);if(size>=bestSize)continue;
          let covers=true;
          for(let p:i32=0;p<n;p++)if((cm&<i32>unchecked(pairMasks[d*32+p]))==0){covers=false;break;}
          if(covers){bestMask=cm;bestSize=size;}
        }
        if(bestMask==0){feasible=false;break;}
        unchecked(coverMask[d]=<u8>bestMask);totalLinks+=bestSize;
      }
      if(!feasible||totalLinks!=patternCount)continue;

      eliminationCount=0;
      for(let oi:i32=0;oi<digitCount;oi++){
        const d=<i32>unchecked(digitOrder[oi]),cm=<i32>unchecked(coverMask[d]),db=bit(d);
        for(let s:i32=0;s<8;s++){
          if((cm&(1<<s))==0)continue;
          for(let pos:i32=0;pos<9;pos++){
            const index=sectorCell(s,pos,r1,r2,c1,c2,boxes);
            if(!empty(index)||inPattern(index)||(maskAt(index)&db)==0)continue;
            unchecked(eliminations[eliminationCount++]=<u16>fact(index,d));
          }
        }
      }
      if(eliminationCount==0)continue;
      unchecked(rowsOut[0]=<u8>r1);unchecked(rowsOut[1]=<u8>r2);
      unchecked(colsOut[0]=<u8>c1);unchecked(colsOut[1]=<u8>c2);
      for(let i:i32=0;i<4;i++)unchecked(boxesOut[i]=<u8>unchecked(boxes[i]));
      return 1;
    }
  }
  return 0;
}

export function skResultPatternCount():i32{return patternCount;}
export function skResultPatternAt(i:i32):i32{return i>=0&&i<patternCount?<i32>unchecked(pattern[i]):-1;}
export function skResultEliminationCount():i32{return eliminationCount;}
export function skResultEliminationAt(i:i32):i32{return i>=0&&i<eliminationCount?<i32>unchecked(eliminations[i]):-1;}
export function skResultRowAt(i:i32):i32{return i>=0&&i<2?<i32>unchecked(rowsOut[i]):-1;}
export function skResultColAt(i:i32):i32{return i>=0&&i<2?<i32>unchecked(colsOut[i]):-1;}
export function skResultBoxAt(i:i32):i32{return i>=0&&i<4?<i32>unchecked(boxesOut[i]):-1;}
