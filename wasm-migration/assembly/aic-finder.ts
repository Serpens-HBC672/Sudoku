// Exact grouped AIC discovery port for the frozen JS oracle.
// Candidate masks are authoritative u16 values restricted to bits 0..8.

const CELL_COUNT:i32=81;
const FACT_COUNT:i32=729;
const ALL_DIGITS:u16=0x01ff;
const MAX_NODES:i32=8;
const MAX_NODE_CELLS:i32=3;

const grid=new StaticArray<u8>(CELL_COUNT);
const masks=new StaticArray<u16>(CELL_COUNT);

let found:i32=0;
let subtype:i32=-1; // 0 type1, 1 type2
const eliminations=new StaticArray<u16>(FACT_COUNT);
let eliminationCount:i32=0;
const pathDigits=new StaticArray<u8>(MAX_NODES);
const pathCounts=new StaticArray<u8>(MAX_NODES);
const pathCells=new StaticArray<u8>(MAX_NODES*MAX_NODE_CELLS);

// Fixed non-reentrant scratch for strongPartners. Reuse avoids repeated
// managed StaticArray allocation without changing partner enumeration.
const strongPartnerRemScratch=new StaticArray<i32>(9);

// niceDfs is recursive, so its partner buffers must remain distinct per
// recursion frame. The search reaches currentPathCount 2..7, i.e. six active
// allocation frames at most under the existing MAX_NODES / maxLinks contract.
const niceDfsPartnerDigits0=new StaticArray<u8>(96);
const niceDfsPartnerDigits1=new StaticArray<u8>(96);
const niceDfsPartnerDigits2=new StaticArray<u8>(96);
const niceDfsPartnerDigits3=new StaticArray<u8>(96);
const niceDfsPartnerDigits4=new StaticArray<u8>(96);
const niceDfsPartnerDigits5=new StaticArray<u8>(96);
const niceDfsPartnerCounts0=new StaticArray<u8>(96);
const niceDfsPartnerCounts1=new StaticArray<u8>(96);
const niceDfsPartnerCounts2=new StaticArray<u8>(96);
const niceDfsPartnerCounts3=new StaticArray<u8>(96);
const niceDfsPartnerCounts4=new StaticArray<u8>(96);
const niceDfsPartnerCounts5=new StaticArray<u8>(96);
const niceDfsPartnerCells0=new StaticArray<u8>(288);
const niceDfsPartnerCells1=new StaticArray<u8>(288);
const niceDfsPartnerCells2=new StaticArray<u8>(288);
const niceDfsPartnerCells3=new StaticArray<u8>(288);
const niceDfsPartnerCells4=new StaticArray<u8>(288);
const niceDfsPartnerCells5=new StaticArray<u8>(288);

@inline function niceDfsPartnerDigits(frame:i32):StaticArray<u8>{
  if(frame==0)return niceDfsPartnerDigits0;
  if(frame==1)return niceDfsPartnerDigits1;
  if(frame==2)return niceDfsPartnerDigits2;
  if(frame==3)return niceDfsPartnerDigits3;
  if(frame==4)return niceDfsPartnerDigits4;
  return niceDfsPartnerDigits5;
}
@inline function niceDfsPartnerCounts(frame:i32):StaticArray<u8>{
  if(frame==0)return niceDfsPartnerCounts0;
  if(frame==1)return niceDfsPartnerCounts1;
  if(frame==2)return niceDfsPartnerCounts2;
  if(frame==3)return niceDfsPartnerCounts3;
  if(frame==4)return niceDfsPartnerCounts4;
  return niceDfsPartnerCounts5;
}
@inline function niceDfsPartnerCells(frame:i32):StaticArray<u8>{
  if(frame==0)return niceDfsPartnerCells0;
  if(frame==1)return niceDfsPartnerCells1;
  if(frame==2)return niceDfsPartnerCells2;
  if(frame==3)return niceDfsPartnerCells3;
  if(frame==4)return niceDfsPartnerCells4;
  return niceDfsPartnerCells5;
}

let pathCount:i32=0;

@inline function bit(d:i32):u16 {
  switch(d){
    case 1:return 0x001; case 2:return 0x002; case 3:return 0x004;
    case 4:return 0x008; case 5:return 0x010; case 6:return 0x020;
    case 7:return 0x040; case 8:return 0x080; case 9:return 0x100;
    default:return 0;
  }
}
@inline function boxOf(index:i32):i32 {
  const r=index/9,c=index%9; return (r/3)*3+c/3;
}
@inline function unitCell(unitType:i32,idx:i32,pos:i32):i32 {
  if(unitType==0)return idx*9+pos;
  if(unitType==1)return pos*9+idx;
  const br=(idx/3)*3,bc=(idx%3)*3;
  return (br+pos/3)*9+(bc+pos%3);
}
@inline function empty(index:i32):bool { return unchecked(grid[index])==0; }
@inline function maskAt(index:i32):u16 { return <u16>(unchecked(masks[index])&ALL_DIGITS); }
@inline function factIndex(index:i32,d:i32):i32 { return (index/9)*81+(index%9)*9+(d-1); }
@inline function sees(a:i32,b:i32):bool {
  return a/9==b/9 || a%9==b%9 || boxOf(a)==boxOf(b);
}
function pop9(value:u16):i32 {
  let m=<u16>(value&ALL_DIGITS),n:i32=0;
  while(m!=0){m=<u16>(m&<u16>(m-1));n++;}
  return n;
}
function singleton(mask:u16):i32 {
  for(let d:i32=1;d<=9;d++)if((mask&bit(d))!=0)return d;
  return 0;
}

export function aicResetInput():void {
  for(let i:i32=0;i<CELL_COUNT;i++){unchecked(grid[i]=0);unchecked(masks[i]=0);}
}
export function aicSetInputCell(index:i32,digit:i32):void {
  if(index>=0&&index<CELL_COUNT)unchecked(grid[index]=<u8>digit);
}
export function aicSetInputMask(index:i32,mask:i32):void {
  if(index>=0&&index<CELL_COUNT)unchecked(masks[index]=<u16>(mask&0x1ff));
}

@inline function nodeCell(node:i32,pos:i32):i32 {
  return <i32>unchecked(pathCells[node*MAX_NODE_CELLS+pos]);
}
function nodeContains(node:i32,index:i32):bool {
  const n=<i32>unchecked(pathCounts[node]);
  for(let i:i32=0;i<n;i++)if(nodeCell(node,i)==index)return true;
  return false;
}
function sameCellSet(
  countA:i32,cellsA:StaticArray<u8>,offsetA:i32,
  countB:i32,cellsB:StaticArray<u8>,offsetB:i32
):bool{
  if(countA!=countB)return false;
  for(let i:i32=0;i<countA;i++){
    const cell=<i32>unchecked(cellsA[offsetA+i]);
    let present=false;
    for(let j:i32=0;j<countB;j++)if(<i32>unchecked(cellsB[offsetB+j])==cell){present=true;break;}
    if(!present)return false;
  }
  return true;
}
function partnerVisited(
  digit:i32,count:i32,cells:StaticArray<u8>,offset:i32,currentPathCount:i32
):bool{
  for(let node:i32=0;node<currentPathCount;node++){
    if(<i32>unchecked(pathDigits[node])!=digit)continue;
    const n=<i32>unchecked(pathCounts[node]);
    if(sameCellSet(count,cells,offset,n,pathCells,node*MAX_NODE_CELLS))return true;
  }
  return false;
}

function addPartner(
  digit:i32,count:i32,c0:i32,c1:i32,c2:i32,
  pDigits:StaticArray<u8>,pCounts:StaticArray<u8>,pCells:StaticArray<u8>,pc:i32
):i32{
  const tmp=new StaticArray<u8>(MAX_NODE_CELLS);
  unchecked(tmp[0]=<u8>c0);
  if(count>1)unchecked(tmp[1]=<u8>c1);
  if(count>2)unchecked(tmp[2]=<u8>c2);
  for(let p:i32=0;p<pc;p++){
    if(<i32>unchecked(pDigits[p])!=digit||<i32>unchecked(pCounts[p])!=count)continue;
    if(sameCellSet(count,tmp,0,count,pCells,p*MAX_NODE_CELLS))return pc;
  }
  unchecked(pDigits[pc]=<u8>digit);
  unchecked(pCounts[pc]=<u8>count);
  unchecked(pCells[pc*MAX_NODE_CELLS]=<u8>c0);
  if(count>1)unchecked(pCells[pc*MAX_NODE_CELLS+1]=<u8>c1);
  if(count>2)unchecked(pCells[pc*MAX_NODE_CELLS+2]=<u8>c2);
  return pc+1;
}
function copyPartner(
  node:i32,p:i32,pDigits:StaticArray<u8>,pCounts:StaticArray<u8>,pCells:StaticArray<u8>
):void{
  unchecked(pathDigits[node]=unchecked(pDigits[p]));
  const n=<i32>unchecked(pCounts[p]);
  unchecked(pathCounts[node]=<u8>n);
  for(let i:i32=0;i<n;i++)unchecked(pathCells[node*MAX_NODE_CELLS+i]=unchecked(pCells[p*MAX_NODE_CELLS+i]));
}

function strongPartners(
  node:i32,pDigits:StaticArray<u8>,pCounts:StaticArray<u8>,pCells:StaticArray<u8>
):i32{
  let pc:i32=0;
  const d=<i32>unchecked(pathDigits[node]),db=bit(d),nc=<i32>unchecked(pathCounts[node]);

  if(nc==1){
    const index=nodeCell(node,0),m=maskAt(index);
    if(pop9(m)==2){
      const other=singleton(<u16>(m&<u16>(~db)));
      pc=addPartner(other,1,index,-1,-1,pDigits,pCounts,pCells,pc);
    }
  }

  const first=nodeCell(node,0);
  for(let unitType:i32=0;unitType<3;unitType++){
    const idx=unitType==0?first/9:unitType==1?first%9:boxOf(first);
    let inUnit=true;
    for(let i:i32=0;i<nc;i++){
      const cell=nodeCell(node,i);
      const ci=unitType==0?cell/9:unitType==1?cell%9:boxOf(cell);
      if(ci!=idx){inUnit=false;break;}
    }
    if(!inUnit)continue;

    const rem=strongPartnerRemScratch; let rn:i32=0;
    for(let pos:i32=0;pos<9;pos++){
      const cell=unitCell(unitType,idx,pos);
      if(!empty(cell)||(maskAt(cell)&db)==0||nodeContains(node,cell))continue;
      unchecked(rem[rn++]=cell);
    }
    if(rn==0)continue;
    if(unitType==2){
      if(rn==1)pc=addPartner(d,1,unchecked(rem[0]),-1,-1,pDigits,pCounts,pCells,pc);
      continue;
    }
    const b0=boxOf(unchecked(rem[0])); let oneBox=true;
    for(let i:i32=1;i<rn;i++)if(boxOf(unchecked(rem[i]))!=b0){oneBox=false;break;}
    if(oneBox){
      pc=addPartner(d,rn,unchecked(rem[0]),rn>1?unchecked(rem[1]):-1,rn>2?unchecked(rem[2]):-1,pDigits,pCounts,pCells,pc);
    }
  }
  return pc;
}

function weakPartners(
  node:i32,pDigits:StaticArray<u8>,pCounts:StaticArray<u8>,pCells:StaticArray<u8>
):i32{
  let pc:i32=0;
  const d=<i32>unchecked(pathDigits[node]),db=bit(d),nc=<i32>unchecked(pathCounts[node]);
  if(nc==1){
    const index=nodeCell(node,0),other=<u16>(maskAt(index)&<u16>(~db));
    for(let d2:i32=1;d2<=9;d2++)if((other&bit(d2))!=0)pc=addPartner(d2,1,index,-1,-1,pDigits,pCounts,pCells,pc);
  }
  for(let index:i32=0;index<CELL_COUNT;index++){
    let inNode=false;
    for(let i:i32=0;i<nc;i++)if(nodeCell(node,i)==index){inNode=true;break;}
    if(inNode||!empty(index)||(maskAt(index)&db)==0)continue;
    let all=true;
    for(let i:i32=0;i<nc;i++)if(!sees(index,nodeCell(node,i))){all=false;break;}
    if(all)pc=addPartner(d,1,index,-1,-1,pDigits,pCounts,pCells,pc);
  }
  return pc;
}

function appendElim(index:i32,d:i32):void {
  unchecked(eliminations[eliminationCount++]=<u16>factIndex(index,d));
}
function saveResult(currentPathCount:i32,kind:i32):void {
  found=1; subtype=kind; pathCount=currentPathCount;
}
function conclusion(currentPathCount:i32):bool {
  const end=currentPathCount-1;
  const sc=<i32>unchecked(pathCounts[0]),ec=<i32>unchecked(pathCounts[end]);
  for(let i:i32=0;i<sc;i++)for(let j:i32=0;j<ec;j++)if(nodeCell(0,i)==nodeCell(end,j))return false;

  const sd=<i32>unchecked(pathDigits[0]),ed=<i32>unchecked(pathDigits[end]);
  eliminationCount=0;
  if(sd==ed){
    const db=bit(sd);
    for(let index:i32=0;index<CELL_COUNT;index++){
      let chainSame=false;
      for(let node:i32=0;node<currentPathCount&&!chainSame;node++){
        if(<i32>unchecked(pathDigits[node])==sd&&nodeContains(node,index))chainSame=true;
      }
      if(chainSame||!empty(index)||(maskAt(index)&db)==0)continue;
      let allStart=true,allEnd=true;
      for(let i:i32=0;i<sc;i++)if(!sees(index,nodeCell(0,i))){allStart=false;break;}
      for(let i:i32=0;i<ec;i++)if(!sees(index,nodeCell(end,i))){allEnd=false;break;}
      if(allStart&&allEnd)appendElim(index,sd);
    }
    if(eliminationCount==0)return false;
    saveResult(currentPathCount,0); return true;
  }

  if(sc!=1||ec!=1||!sees(nodeCell(0,0),nodeCell(end,0)))return false;
  const startCell=nodeCell(0,0),endCell=nodeCell(end,0);
  if((maskAt(startCell)&bit(ed))!=0)appendElim(startCell,ed);
  if((maskAt(endCell)&bit(sd))!=0)appendElim(endCell,sd);
  if(eliminationCount==0)return false;
  saveResult(currentPathCount,1); return true;
}

function dfs(currentPathCount:i32,lastStrong:bool,remainingLinks:i32):bool {
  if(remainingLinks<=0)return false;
  const nextStrong=!lastStrong,node=currentPathCount-1;
  const frame=currentPathCount-2;
  const pDigits=niceDfsPartnerDigits(frame),pCounts=niceDfsPartnerCounts(frame),pCells=niceDfsPartnerCells(frame);
  const pc=nextStrong?strongPartners(node,pDigits,pCounts,pCells):weakPartners(node,pDigits,pCounts,pCells);
  for(let p:i32=0;p<pc;p++){
    const pd=<i32>unchecked(pDigits[p]),pn=<i32>unchecked(pCounts[p]);
    if(partnerVisited(pd,pn,pCells,p*MAX_NODE_CELLS,currentPathCount))continue;
    copyPartner(currentPathCount,p,pDigits,pCounts,pCells);
    if(nextStrong&&conclusion(currentPathCount+1))return true;
    if(dfs(currentPathCount+1,nextStrong,remainingLinks-1))return true;
  }
  return false;
}

export function aicFind():i32 {
  found=0; subtype=-1; eliminationCount=0; pathCount=0;
  for(let maxLinks:i32=3;maxLinks<=7;maxLinks+=2){
    for(let index:i32=0;index<CELL_COUNT;index++){
      if(!empty(index))continue;
      const m=maskAt(index);
      for(let d:i32=1;d<=9;d++){
        if((m&bit(d))==0)continue;
        unchecked(pathDigits[0]=<u8>d);unchecked(pathCounts[0]=1);unchecked(pathCells[0]=<u8>index);
        const pDigits=new StaticArray<u8>(32),pCounts=new StaticArray<u8>(32),pCells=new StaticArray<u8>(96);
        const pc=strongPartners(0,pDigits,pCounts,pCells);
        for(let p:i32=0;p<pc;p++){
          copyPartner(1,p,pDigits,pCounts,pCells);
          if(dfs(2,true,maxLinks-1))return found;
        }
      }
    }
  }
  return 0;
}


function sameAsStartPartner(p:i32,pDigits:StaticArray<u8>,pCounts:StaticArray<u8>,pCells:StaticArray<u8>):bool{
  if(<i32>unchecked(pDigits[p])!=<i32>unchecked(pathDigits[0]))return false;
  return sameCellSet(
    <i32>unchecked(pCounts[p]),pCells,p*MAX_NODE_CELLS,
    <i32>unchecked(pathCounts[0]),pathCells,0
  );
}

function niceDfs(currentPathCount:i32,lastStrong:bool,remainingLinks:i32):bool{
  if(remainingLinks<=0)return false;
  const nextStrong=!lastStrong,node=currentPathCount-1;
  const pDigits=new StaticArray<u8>(96),pCounts=new StaticArray<u8>(96),pCells=new StaticArray<u8>(288);
  const pc=nextStrong?strongPartners(node,pDigits,pCounts,pCells):weakPartners(node,pDigits,pCounts,pCells);
  for(let p:i32=0;p<pc;p++){
    if(nextStrong&&sameAsStartPartner(p,pDigits,pCounts,pCells)){
      copyPartner(currentPathCount,p,pDigits,pCounts,pCells);
      pathCount=currentPathCount+1;
      found=1;
      return true;
    }
    const pd=<i32>unchecked(pDigits[p]),pn=<i32>unchecked(pCounts[p]);
    if(partnerVisited(pd,pn,pCells,p*MAX_NODE_CELLS,currentPathCount))continue;
    copyPartner(currentPathCount,p,pDigits,pCounts,pCells);
    if(niceDfs(currentPathCount+1,nextStrong,remainingLinks-1))return true;
  }
  return false;
}

export function niceLoopFind():i32{
  found=0;subtype=-1;eliminationCount=0;pathCount=0;
  for(let maxLinks:i32=3;maxLinks<=7;maxLinks+=2){
    for(let index:i32=0;index<CELL_COUNT;index++){
      if(!empty(index))continue;
      const m=maskAt(index);
      for(let d:i32=1;d<=9;d++){
        if((m&bit(d))==0)continue;
        unchecked(pathDigits[0]=<u8>d);unchecked(pathCounts[0]=1);unchecked(pathCells[0]=<u8>index);
        const pDigits=new StaticArray<u8>(32),pCounts=new StaticArray<u8>(32),pCells=new StaticArray<u8>(96);
        const pc=strongPartners(0,pDigits,pCounts,pCells);
        for(let p:i32=0;p<pc;p++){
          copyPartner(1,p,pDigits,pCounts,pCells);
          if(niceDfs(2,true,maxLinks-1))return found;
        }
      }
    }
  }
  return 0;
}

export function aicResultSubtype():i32{return subtype;}
export function aicResultEliminationCount():i32{return eliminationCount;}
export function aicResultEliminationAt(i:i32):i32{return i>=0&&i<eliminationCount?<i32>unchecked(eliminations[i]):-1;}
export function aicResultNodeCount():i32{return pathCount;}
export function aicResultNodeDigit(i:i32):i32{return i>=0&&i<pathCount?<i32>unchecked(pathDigits[i]):0;}
export function aicResultNodeCellCount(i:i32):i32{return i>=0&&i<pathCount?<i32>unchecked(pathCounts[i]):0;}
export function aicResultNodeCellAt(i:i32,j:i32):i32{
  if(i<0||i>=pathCount)return -1;
  const n=<i32>unchecked(pathCounts[i]);
  return j>=0&&j<n?nodeCell(i,j):-1;
}
