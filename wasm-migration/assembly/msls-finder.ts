// Exact MSLS discovery port for the frozen JS oracle.
// Preserves size/mode/combination ordering and the JS Map/Set ordered Kuhn/Konig construction.

const CELL_COUNT:i32=81;
const ALL:u16=0x01ff;
const MAX_INTERSECTIONS:i32=81;
const MAX_EDGES_PER_DIGIT:i32=81;
const MAX_ELIMS:i32=2048;

const grid=new StaticArray<u8>(CELL_COUNT);
const masks=new StaticArray<u16>(CELL_COUNT);

const pattern=new StaticArray<u8>(MAX_INTERSECTIONS);
let patternCount:i32=0;
const eliminations=new StaticArray<u16>(MAX_ELIMS);
let eliminationCount:i32=0;
const rowsOut=new StaticArray<u8>(5);
let rowsOutCount:i32=0;
const colsOut=new StaticArray<u8>(5);
let colsOutCount:i32=0;
const boxesOut=new StaticArray<u8>(9);
let boxesOutCount:i32=0;

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
function appendElim(index:i32,d:i32):void{
  if(eliminationCount<MAX_ELIMS)unchecked(eliminations[eliminationCount++]=<u16>fact(index,d));
}

export function mslsResetInput():void{
  for(let i:i32=0;i<CELL_COUNT;i++){unchecked(grid[i]=0);unchecked(masks[i]=0);}
}
export function mslsSetInputCell(index:i32,digit:i32):void{
  if(index>=0&&index<CELL_COUNT)unchecked(grid[index]=<u8>digit);
}
export function mslsSetInputMask(index:i32,mask:i32):void{
  if(index>=0&&index<CELL_COUNT)unchecked(masks[index]=<u16>(mask&0x1ff));
}

function initCombo(idx:StaticArray<i32>,k:i32):void{
  for(let i:i32=0;i<k;i++)unchecked(idx[i]=i);
}
function nextCombo(idx:StaticArray<i32>,n:i32,k:i32):bool{
  let i=k-1;
  while(i>=0&&unchecked(idx[i])==n-k+i)i--;
  if(i<0)return false;
  unchecked(idx[i]=unchecked(idx[i])+1);
  for(let j=i+1;j<k;j++)unchecked(idx[j]=unchecked(idx[j-1])+1);
  return true;
}
function comboValue(combo:StaticArray<i32>,pos:i32):i32{return unchecked(combo[pos]);}
function comboContains(combo:StaticArray<i32>,count:i32,value:i32):bool{
  for(let i:i32=0;i<count;i++)if(unchecked(combo[i])==value)return true;
  return false;
}
function uniqueAppend(arr:StaticArray<i32>,count:i32,value:i32):i32{
  for(let i:i32=0;i<count;i++)if(unchecked(arr[i])==value)return count;
  unchecked(arr[count]=value);return count+1;
}
function inPattern(index:i32):bool{
  for(let i:i32=0;i<patternCount;i++)if(<i32>unchecked(pattern[i])==index)return true;
  return false;
}

// Edges for one digit, in intersection insertion order.
const edgeA=new StaticArray<u8>(MAX_EDGES_PER_DIGIT);
const edgeB=new StaticArray<u8>(MAX_EDGES_PER_DIGIT);
let edgeCount:i32=0;

const matchB=new StaticArray<i8>(32);
const matchBSeen=new StaticArray<u8>(32);
const visitedB=new StaticArray<u8>(32);

function resetMatching():void{
  for(let i:i32=0;i<32;i++){unchecked(matchBSeen[i]=0);unchecked(matchB[i]=-1);}
}
function neighborExistsBefore(a:i32,b:i32,edgeIndex:i32):bool{
  for(let i:i32=0;i<edgeIndex;i++)if(<i32>unchecked(edgeA[i])==a&&<i32>unchecked(edgeB[i])==b)return true;
  return false;
}
function tryKuhn(a:i32):bool{
  for(let ei:i32=0;ei<edgeCount;ei++){
    if(<i32>unchecked(edgeA[ei])!=a)continue;
    const b=<i32>unchecked(edgeB[ei]);
    if(neighborExistsBefore(a,b,ei))continue; // JS Set neighbor de-dupe
    if(unchecked(visitedB[b])!=0)continue;
    unchecked(visitedB[b]=1);
    if(unchecked(matchBSeen[b])==0||tryKuhn(<i32>unchecked(matchB[b]))){
      unchecked(matchBSeen[b]=1);unchecked(matchB[b]=<i8>a);return true;
    }
  }
  return false;
}
function matchedBForA(a:i32):i32{
  for(let b:i32=0;b<32;b++)if(unchecked(matchBSeen[b])!=0&&<i32>unchecked(matchB[b])==a)return b;
  return -1;
}
const altVisitedA=new StaticArray<u8>(32);
const altVisitedB=new StaticArray<u8>(32);
function alternate(a:i32):void{
  if(unchecked(altVisitedA[a])!=0)return;
  unchecked(altVisitedA[a]=1);
  const matched=matchedBForA(a);
  for(let ei:i32=0;ei<edgeCount;ei++){
    if(<i32>unchecked(edgeA[ei])!=a)continue;
    const b=<i32>unchecked(edgeB[ei]);
    if(neighborExistsBefore(a,b,ei)||b==matched)continue;
    if(unchecked(altVisitedB[b])!=0)continue;
    unchecked(altVisitedB[b]=1);
    if(unchecked(matchBSeen[b])!=0)alternate(<i32>unchecked(matchB[b]));
  }
}

// Returns ordered cover vertices in out[], using usedA/usedB insertion order.
function minVertexCover(
  usedA:StaticArray<i32>,usedACount:i32,
  usedB:StaticArray<i32>,usedBCount:i32,
  out:StaticArray<i32>
):i32{
  resetMatching();
  for(let i:i32=0;i<usedACount;i++){
    for(let b:i32=0;b<32;b++)unchecked(visitedB[b]=0);
    tryKuhn(unchecked(usedA[i]));
  }
  for(let i:i32=0;i<32;i++){unchecked(altVisitedA[i]=0);unchecked(altVisitedB[i]=0);}
  for(let i:i32=0;i<usedACount;i++){
    const a=unchecked(usedA[i]);
    if(matchedBForA(a)<0)alternate(a);
  }
  let count:i32=0;
  for(let i:i32=0;i<usedACount;i++){
    const a=unchecked(usedA[i]);
    if(unchecked(altVisitedA[a])==0)unchecked(out[count++]=a);
  }
  for(let i:i32=0;i<usedBCount;i++){
    const b=unchecked(usedB[i]);
    if(unchecked(altVisitedB[b])!=0)unchecked(out[count++]=b);
  }
  return count;
}

const interA=new StaticArray<u8>(MAX_INTERSECTIONS);
const interB=new StaticArray<u8>(MAX_INTERSECTIONS);

// Reusable scratch storage. MSLS enumerates tens of thousands of configurations;
// with AssemblyScript's stub runtime, allocating these arrays inside the hot
// loops monotonically consumes linear memory and can trap before the scan ends.
const impliedBoxes=new StaticArray<i32>(9);
const bands=new StaticArray<i32>(3);
const stacks=new StaticArray<i32>(3);
const digitSeen=new StaticArray<u8>(10);
const digitOrder=new StaticArray<u8>(9);
const coverCountByDigit=new StaticArray<u8>(10);
const coverByDigit=new StaticArray<u8>(10*32);
const usedA=new StaticArray<i32>(32);
const usedB=new StaticArray<i32>(32);
const cover=new StaticArray<i32>(32);
const sizesR=new StaticArray<i32>(6);
const sizesC=new StaticArray<i32>(6);
const rowCombo=new StaticArray<i32>(5);
const colCombo=new StaticArray<i32>(5);

function sectorCell(
  sector:i32,pos:i32,
  rows:StaticArray<i32>,rowCount:i32,
  cols:StaticArray<i32>,colCount:i32,
  boxes:StaticArray<i32>,boxCount:i32
):i32{
  if(sector<rowCount)return unchecked(rows[sector])*9+pos;
  if(sector<rowCount+colCount)return pos*9+unchecked(cols[sector-rowCount]);
  const bx=unchecked(boxes[sector-rowCount-colCount]),br=(bx/3)*3,bc=(bx%3)*3;
  return (br+pos/3)*9+(bc+pos%3);
}

function tryConfiguration(
  rows:StaticArray<i32>,rowCount:i32,
  cols:StaticArray<i32>,colCount:i32,
  useBoxes:bool
):bool{
  patternCount=0;
  // scratch arrays are module-scoped to avoid stub-runtime allocation growth
  let impliedBoxCount:i32=0;
  let sideACount:i32=rowCount+colCount;

  if(!useBoxes){
    for(let ri:i32=0;ri<rowCount;ri++)for(let ci:i32=0;ci<colCount;ci++){
      const index=unchecked(rows[ri])*9+unchecked(cols[ci]);
      if(!empty(index))continue;
      unchecked(pattern[patternCount]=<u8>index);
      unchecked(interA[patternCount]=<u8>ri);
      unchecked(interB[patternCount]=<u8>(rowCount+ci));
      patternCount++;
    }
  }else{
    let bandCount:i32=0,stackCount:i32=0;
    for(let ri:i32=0;ri<rowCount;ri++)bandCount=uniqueAppend(bands,bandCount,unchecked(rows[ri])/3);
    for(let ci:i32=0;ci<colCount;ci++)stackCount=uniqueAppend(stacks,stackCount,unchecked(cols[ci])/3);
    for(let bi:i32=0;bi<bandCount;bi++)for(let si:i32=0;si<stackCount;si++){
      unchecked(impliedBoxes[impliedBoxCount++]=unchecked(bands[bi])*3+unchecked(stacks[si]));
    }

    for(let ri:i32=0;ri<rowCount;ri++){
      const r=unchecked(rows[ri]);
      for(let si:i32=0;si<stackCount;si++){
        const stack=unchecked(stacks[si]);
        for(let cc:i32=stack*3;cc<stack*3+3;cc++){
          if(comboContains(cols,colCount,cc))continue;
          const index=r*9+cc;if(!empty(index))continue;
          const bx=(r/3)*3+stack;
          let bpos:i32=0;while(bpos<impliedBoxCount&&unchecked(impliedBoxes[bpos])!=bx)bpos++;
          unchecked(pattern[patternCount]=<u8>index);
          unchecked(interA[patternCount]=<u8>ri);
          unchecked(interB[patternCount]=<u8>(rowCount+colCount+bpos));
          patternCount++;
        }
      }
    }
    for(let ci:i32=0;ci<colCount;ci++){
      const c=unchecked(cols[ci]);
      for(let bi:i32=0;bi<bandCount;bi++){
        const band=unchecked(bands[bi]);
        for(let rr:i32=band*3;rr<band*3+3;rr++){
          if(comboContains(rows,rowCount,rr))continue;
          const index=rr*9+c;if(!empty(index))continue;
          const bx=band*3+c/3;
          let bpos:i32=0;while(bpos<impliedBoxCount&&unchecked(impliedBoxes[bpos])!=bx)bpos++;
          unchecked(pattern[patternCount]=<u8>index);
          unchecked(interA[patternCount]=<u8>(rowCount+ci));
          unchecked(interB[patternCount]=<u8>(rowCount+colCount+bpos));
          patternCount++;
        }
      }
    }
  }
  if(patternCount==0)return false;

  let digitCount:i32=0;
  for(let d:i32=1;d<=9;d++)unchecked(digitSeen[d]=0);
  for(let pi:i32=0;pi<patternCount;pi++){
    const m=maskAt(<i32>unchecked(pattern[pi]));
    for(let d:i32=1;d<=9;d++)if((m&bit(d))!=0&&unchecked(digitSeen[d])==0){
      unchecked(digitSeen[d]=1);unchecked(digitOrder[digitCount++]=<u8>d);
    }
  }

  let totalLinks:i32=0;

  for(let oi:i32=0;oi<digitCount;oi++){
    const d=<i32>unchecked(digitOrder[oi]),db=bit(d);
    edgeCount=0;let usedACount:i32=0,usedBCount:i32=0;
    for(let pi:i32=0;pi<patternCount;pi++){
      const index=<i32>unchecked(pattern[pi]);if((maskAt(index)&db)==0)continue;
      const a=<i32>unchecked(interA[pi]),b=<i32>unchecked(interB[pi]);
      unchecked(edgeA[edgeCount]=<u8>a);unchecked(edgeB[edgeCount]=<u8>b);edgeCount++;
      usedACount=uniqueAppend(usedA,usedACount,a);
      usedBCount=uniqueAppend(usedB,usedBCount,b);
    }
    const cc=minVertexCover(usedA,usedACount,usedB,usedBCount,cover);
    unchecked(coverCountByDigit[d]=<u8>cc);
    for(let i:i32=0;i<cc;i++)unchecked(coverByDigit[d*32+i]=<u8>unchecked(cover[i]));
    totalLinks+=cc;
  }
  if(totalLinks!=patternCount)return false;

  eliminationCount=0;
  for(let oi:i32=0;oi<digitCount;oi++){
    const d=<i32>unchecked(digitOrder[oi]),db=bit(d),cc=<i32>unchecked(coverCountByDigit[d]);
    for(let ci:i32=0;ci<cc;ci++){
      const sector=<i32>unchecked(coverByDigit[d*32+ci]);
      for(let pos:i32=0;pos<9;pos++){
        const index=sectorCell(sector,pos,rows,rowCount,cols,colCount,impliedBoxes,impliedBoxCount);
        if(!empty(index)||inPattern(index)||(maskAt(index)&db)==0)continue;
        appendElim(index,d);
      }
    }
  }
  if(eliminationCount==0)return false;

  rowsOutCount=rowCount;colsOutCount=colCount;boxesOutCount=impliedBoxCount;
  for(let i:i32=0;i<rowCount;i++)unchecked(rowsOut[i]=<u8>unchecked(rows[i]));
  for(let i:i32=0;i<colCount;i++)unchecked(colsOut[i]=<u8>unchecked(cols[i]));
  for(let i:i32=0;i<impliedBoxCount;i++)unchecked(boxesOut[i]=<u8>unchecked(impliedBoxes[i]));
  return true;
}

export function mslsFind():i32{
  patternCount=0;eliminationCount=0;rowsOutCount=0;colsOutCount=0;boxesOutCount=0;
  unchecked(sizesR[0]=3);unchecked(sizesC[0]=3);
  unchecked(sizesR[1]=3);unchecked(sizesC[1]=4);
  unchecked(sizesR[2]=4);unchecked(sizesC[2]=3);
  unchecked(sizesR[3]=4);unchecked(sizesC[3]=4);
  unchecked(sizesR[4]=4);unchecked(sizesC[4]=5);
  unchecked(sizesR[5]=5);unchecked(sizesC[5]=4);
  for(let si:i32=0;si<6;si++){
    const rn=unchecked(sizesR[si]),cn=unchecked(sizesC[si]);
    for(let mode:i32=0;mode<2;mode++){
      // JS trySizeMSLS creates complete rowCombos then colCombos and nests
      // rows outer / cols inner. Lexicographic streaming is equivalent.
      initCombo(rowCombo,rn);
      while(true){
        initCombo(colCombo,cn);
        while(true){
          if(tryConfiguration(rowCombo,rn,colCombo,cn,mode==1))return 1;
          if(!nextCombo(colCombo,9,cn))break;
        }
        if(!nextCombo(rowCombo,9,rn))break;
      }
    }
  }
  return 0;
}

export function mslsResultPatternCount():i32{return patternCount;}
export function mslsResultPatternAt(i:i32):i32{return i>=0&&i<patternCount?<i32>unchecked(pattern[i]):-1;}
export function mslsResultEliminationCount():i32{return eliminationCount;}
export function mslsResultEliminationAt(i:i32):i32{return i>=0&&i<eliminationCount?<i32>unchecked(eliminations[i]):-1;}
export function mslsResultRowCount():i32{return rowsOutCount;}
export function mslsResultRowAt(i:i32):i32{return i>=0&&i<rowsOutCount?<i32>unchecked(rowsOut[i]):-1;}
export function mslsResultColCount():i32{return colsOutCount;}
export function mslsResultColAt(i:i32):i32{return i>=0&&i<colsOutCount?<i32>unchecked(colsOut[i]):-1;}
export function mslsResultBoxCount():i32{return boxesOutCount;}
export function mslsResultBoxAt(i:i32):i32{return i>=0&&i<boxesOutCount?<i32>unchecked(boxesOut[i]):-1;}
