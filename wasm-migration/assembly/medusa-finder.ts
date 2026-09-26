// Exact 3D Medusa discovery port.
// Preserves JS strong-link insertion order, BFS component order, rule order,
// pattern cell insertion order, and first visible reason-node selection.

const CELL_COUNT:i32=81;
const FACT_COUNT:i32=729;
const ALL:u16=0x01ff;
const MAX_DEGREE:i32=4;

const grid=new StaticArray<u8>(CELL_COUNT);
const masks=new StaticArray<u16>(CELL_COUNT);

const adj=new StaticArray<u16>(FACT_COUNT*MAX_DEGREE);
const adjCount=new StaticArray<u8>(FACT_COUNT);
const allNodes=new StaticArray<u16>(FACT_COUNT);
let allNodeCount:i32=0;

const visited=new StaticArray<u8>(FACT_COUNT);
const colorSeen=new StaticArray<u8>(FACT_COUNT);
const colorValue=new StaticArray<u8>(FACT_COUNT);
const queue=new StaticArray<u16>(FACT_COUNT);
const component=new StaticArray<u16>(FACT_COUNT);
let componentCount:i32=0;

let actionType:i32=0;
const pattern=new StaticArray<u8>(CELL_COUNT);
let patternCount:i32=0;
const eliminations=new StaticArray<u16>(FACT_COUNT);
let eliminationCount:i32=0;
const reasonNodes=new StaticArray<u16>(FACT_COUNT);
const reasonColors=new StaticArray<i8>(FACT_COUNT);
let reasonCount:i32=0;
let ruleType:i32=-1; // 0 cell,1 unit,2 twoColorsInCell,3 seesTwoColors
let badColor:i32=-1;

@inline function bit(d:i32):u16 {
  switch(d){
    case 1:return 0x001;case 2:return 0x002;case 3:return 0x004;
    case 4:return 0x008;case 5:return 0x010;case 6:return 0x020;
    case 7:return 0x040;case 8:return 0x080;case 9:return 0x100;
    default:return 0;
  }
}
@inline function fact(r:i32,c:i32,d:i32):i32{return r*81+c*9+(d-1);}
@inline function nodeD(k:i32):i32{return k%9+1;}
@inline function nodeCell(k:i32):i32{return (k-(nodeD(k)-1))/9;}
@inline function nodeC(k:i32):i32{return nodeCell(k)%9;}
@inline function nodeR(k:i32):i32{return nodeCell(k)/9;}
@inline function boxIndex(r:i32,c:i32):i32{return (r/3)*3+c/3;}
@inline function empty(index:i32):bool{return unchecked(grid[index])==0;}
@inline function maskAt(index:i32):u16{return <u16>(unchecked(masks[index])&ALL);}
@inline function sees(a:i32,b:i32):bool{
  const ar=a/9, ac=a%9, br=b/9, bc=b%9;
  return ar==br||ac==bc||boxIndex(ar,ac)==boxIndex(br,bc);
}
function popcount(m0:u16):i32{
  let m=<u16>(m0&ALL),n:i32=0;
  while(m!=0){m=<u16>(m&<u16>(m-1));n++;}
  return n;
}

export function medusaResetInput():void{
  for(let i:i32=0;i<CELL_COUNT;i++){unchecked(grid[i]=0);unchecked(masks[i]=0);}
}
export function medusaSetInputCell(index:i32,d:i32):void{
  if(index>=0&&index<CELL_COUNT)unchecked(grid[index]=<u8>d);
}
export function medusaSetInputMask(index:i32,m:i32):void{
  if(index>=0&&index<CELL_COUNT)unchecked(masks[index]=<u16>(m&0x1ff));
}

function clearState():void{
  for(let i:i32=0;i<FACT_COUNT;i++){
    unchecked(adjCount[i]=0);unchecked(visited[i]=0);unchecked(colorSeen[i]=0);
  }
  allNodeCount=0;componentCount=0;actionType=0;patternCount=0;eliminationCount=0;
  reasonCount=0;ruleType=-1;badColor=-1;
}

function addNeighbor(a:i32,b:i32):void{
  const count=<i32>unchecked(adjCount[a]);
  for(let i:i32=0;i<count;i++) if(<i32>unchecked(adj[a*MAX_DEGREE+i])==b)return;
  if(count>=MAX_DEGREE) unreachable();
  unchecked(adj[a*MAX_DEGREE+count]=<u16>b);
  unchecked(adjCount[a]=<u8>(count+1));
}
function addLink(a:i32,b:i32):void{addNeighbor(a,b);addNeighbor(b,a);}

function buildGraph():void{
  // JS allNodes row-major, digit-ascending; bivalue links are inserted first.
  for(let index:i32=0;index<CELL_COUNT;index++){
    if(!empty(index))continue;
    const m=maskAt(index);
    let first:i32=-1,second:i32=-1,n:i32=0;
    for(let d:i32=1;d<=9;d++) if((m&bit(d))!=0){
      const k=fact(index/9,index%9,d);
      unchecked(allNodes[allNodeCount++]=<u16>k);
      if(n==0)first=k;else if(n==1)second=k;
      n++;
    }
    if(n==2)addLink(first,second);
  }

  // Conjugate links: digit -> rows -> cols -> boxes.
  for(let d:i32=1;d<=9;d++){
    const db=bit(d);
    for(let r:i32=0;r<9;r++){
      let a:i32=-1,b:i32=-1,n:i32=0;
      for(let c:i32=0;c<9;c++){
        const index=r*9+c;
        if(empty(index)&&(maskAt(index)&db)!=0){if(n==0)a=fact(r,c,d);else if(n==1)b=fact(r,c,d);n++;}
      }
      if(n==2)addLink(a,b);
    }
    for(let c:i32=0;c<9;c++){
      let a:i32=-1,b:i32=-1,n:i32=0;
      for(let r:i32=0;r<9;r++){
        const index=r*9+c;
        if(empty(index)&&(maskAt(index)&db)!=0){if(n==0)a=fact(r,c,d);else if(n==1)b=fact(r,c,d);n++;}
      }
      if(n==2)addLink(a,b);
    }
    for(let br:i32=0;br<9;br+=3)for(let bc:i32=0;bc<9;bc+=3){
      let a:i32=-1,b:i32=-1,n:i32=0;
      for(let r:i32=br;r<br+3;r++)for(let c:i32=bc;c<bc+3;c++){
        const index=r*9+c;
        if(empty(index)&&(maskAt(index)&db)!=0){if(n==0)a=fact(r,c,d);else if(n==1)b=fact(r,c,d);n++;}
      }
      if(n==2)addLink(a,b);
    }
  }
}

function buildComponent(start:i32):void{
  // Clear only colors for this component; nodes from older components are no
  // longer queried after visited has excluded them.
  componentCount=0;
  let qHead:i32=0,qTail:i32=0;
  unchecked(colorSeen[start]=1);unchecked(colorValue[start]=0);
  unchecked(queue[qTail++]=<u16>start);unchecked(component[componentCount++]=<u16>start);
  while(qHead<qTail){
    const cur=<i32>unchecked(queue[qHead++]);
    const cc=<i32>unchecked(colorValue[cur]);
    const n=<i32>unchecked(adjCount[cur]);
    for(let i:i32=0;i<n;i++){
      const nb=<i32>unchecked(adj[cur*MAX_DEGREE+i]);
      if(unchecked(colorSeen[nb])==0){
        unchecked(colorSeen[nb]=1);unchecked(colorValue[nb]=<u8>(1-cc));
        unchecked(queue[qTail++]=<u16>nb);unchecked(component[componentCount++]=<u16>nb);
      }
    }
  }
  for(let i:i32=0;i<componentCount;i++)unchecked(visited[<i32>unchecked(component[i])]=1);
}

function buildPattern():void{
  patternCount=0;
  const seenCell=new StaticArray<u8>(CELL_COUNT);
  for(let i:i32=0;i<componentCount;i++){
    const cell=nodeCell(<i32>unchecked(component[i]));
    if(unchecked(seenCell[cell])==0){unchecked(seenCell[cell]=1);unchecked(pattern[patternCount++]=<u8>cell);}
  }
}
function addElimNode(k:i32):void{unchecked(eliminations[eliminationCount++]=<u16>k);}
function setReason(k:i32,color:i32):void{
  unchecked(reasonNodes[reasonCount]=<u16>k);unchecked(reasonColors[reasonCount]=<i8>color);reasonCount++;
}

// Rule A: first Map key (cell,color) whose list reaches >=2, by insertion order.
function ruleA():bool{
  const keyOrder=new StaticArray<u16>(FACT_COUNT); // cell*2+color <=161
  const keySeen=new StaticArray<u8>(CELL_COUNT*2);
  let keyCount:i32=0;
  for(let i:i32=0;i<componentCount;i++){
    const k=<i32>unchecked(component[i]), key=nodeCell(k)*2+<i32>unchecked(colorValue[k]);
    if(unchecked(keySeen[key])==0){unchecked(keySeen[key]=1);unchecked(keyOrder[keyCount++]=<u16>key);}
  }
  for(let ki:i32=0;ki<keyCount;ki++){
    const key=<i32>unchecked(keyOrder[ki]),cell=key/2,col=key%2;
    let n:i32=0,a:i32=-1,b:i32=-1;
    for(let i:i32=0;i<componentCount;i++){
      const k=<i32>unchecked(component[i]);
      if(nodeCell(k)==cell&&<i32>unchecked(colorValue[k])==col){
        if(n==0)a=k;else if(n==1)b=k;n++;
      }
    }
    if(n>=2){
      ruleType=0;badColor=col;reasonCount=0;setReason(a,-1);setReason(b,-1);
      eliminationCount=0;
      for(let i:i32=0;i<componentCount;i++){const k=<i32>unchecked(component[i]);if(<i32>unchecked(colorValue[k])==col)addElimNode(k);}
      return eliminationCount>0;
    }
  }
  return false;
}

// Unit key encoding keeps value compact; keyOrder preserves JS Map insertion order.
@inline function unitKey(d:i32,ut:i32,idx:i32,col:i32):i32{
  return ((((d-1)*3+ut)*9+idx)*2+col);
}
function matchesUnit(k:i32,d:i32,ut:i32,idx:i32,col:i32):bool{
  if(nodeD(k)!=d||<i32>unchecked(colorValue[k])!=col)return false;
  const r=nodeR(k),c=nodeC(k);
  return ut==0?r==idx:ut==1?c==idx:boxIndex(r,c)==idx;
}
function ruleB():bool{
  const MAX_KEYS:i32=486;
  const order=new StaticArray<u16>(MAX_KEYS);
  const seenKey=new StaticArray<u8>(MAX_KEYS);
  let count:i32=0;
  for(let i:i32=0;i<componentCount;i++){
    const k=<i32>unchecked(component[i]),r=nodeR(k),c=nodeC(k),d=nodeD(k),col=<i32>unchecked(colorValue[k]),box=boxIndex(r,c);
    const k0=unitKey(d,0,r,col),k1=unitKey(d,1,c,col),k2=unitKey(d,2,box,col);
    if(unchecked(seenKey[k0])==0){unchecked(seenKey[k0]=1);unchecked(order[count++]=<u16>k0);}
    if(unchecked(seenKey[k1])==0){unchecked(seenKey[k1]=1);unchecked(order[count++]=<u16>k1);}
    if(unchecked(seenKey[k2])==0){unchecked(seenKey[k2]=1);unchecked(order[count++]=<u16>k2);}
  }
  for(let oi:i32=0;oi<count;oi++){
    const key=<i32>unchecked(order[oi]);
    const col=key%2;let t=key/2;const idx=t%9;t/=9;const ut=t%3;const d=t/3+1;
    let n:i32=0,a:i32=-1,b:i32=-1;
    for(let i:i32=0;i<componentCount;i++){
      const k=<i32>unchecked(component[i]);
      if(matchesUnit(k,d,ut,idx,col)){if(n==0)a=k;else if(n==1)b=k;n++;}
    }
    if(n>=2){
      ruleType=1;badColor=col;reasonCount=0;setReason(a,-1);setReason(b,-1);
      eliminationCount=0;
      for(let i:i32=0;i<componentCount;i++){const k=<i32>unchecked(component[i]);if(<i32>unchecked(colorValue[k])==col)addElimNode(k);}
      return eliminationCount>0;
    }
  }
  return false;
}

function ruleC():bool{
  const cellOrder=new StaticArray<u8>(CELL_COUNT);
  const seenCell=new StaticArray<u8>(CELL_COUNT);
  let cellCount:i32=0;
  for(let i:i32=0;i<componentCount;i++){
    const cell=nodeCell(<i32>unchecked(component[i]));
    if(unchecked(seenCell[cell])==0){unchecked(seenCell[cell]=1);unchecked(cellOrder[cellCount++]=<u8>cell);}
  }
  for(let ci:i32=0;ci<cellCount;ci++){
    const cell=<i32>unchecked(cellOrder[ci]);
    let colorMask:i32=0;let coloredMask:u16=0;let first0:i32=-1,first1:i32=-1;
    for(let i:i32=0;i<componentCount;i++){
      const k=<i32>unchecked(component[i]);if(nodeCell(k)!=cell)continue;
      const col=<i32>unchecked(colorValue[k]);colorMask|=1<<col;coloredMask=<u16>(coloredMask|bit(nodeD(k)));
      if(col==0&&first0<0)first0=k;if(col==1&&first1<0)first1=k;
    }
    if(colorMask!=3)continue;
    const remove=<u16>(maskAt(cell)&<u16>(~coloredMask));
    if(remove==0)continue;
    ruleType=2;badColor=-1;reasonCount=0;setReason(first0,0);setReason(first1,1);
    eliminationCount=0;
    for(let d:i32=1;d<=9;d++)if((remove&bit(d))!=0)addElimNode(fact(cell/9,cell%9,d));
    return true;
  }
  return false;
}

function nodeInComponent(k:i32):bool{
  return unchecked(colorSeen[k])!=0;
}
function ruleD():bool{
  for(let cell:i32=0;cell<CELL_COUNT;cell++){
    if(!empty(cell))continue;
    const m=maskAt(cell);
    for(let d:i32=1;d<=9;d++){
      if((m&bit(d))==0)continue;
      const candidate=fact(cell/9,cell%9,d);
      if(nodeInComponent(candidate))continue;
      let seen0:i32=-1,seen1:i32=-1;
      for(let i:i32=0;i<componentCount;i++){
        const k=<i32>unchecked(component[i]);
        if(nodeD(k)!=d||!sees(cell,nodeCell(k)))continue;
        const col=<i32>unchecked(colorValue[k]);
        if(col==0&&seen0<0)seen0=k;else if(col==1&&seen1<0)seen1=k;
        if(seen0>=0&&seen1>=0)break;
      }
      if(seen0>=0&&seen1>=0){
        ruleType=3;badColor=-1;reasonCount=0;
        setReason(candidate,-1);setReason(seen0,0);setReason(seen1,1);
        eliminationCount=0;addElimNode(candidate);
        return true;
      }
    }
  }
  return false;
}

export function medusaFind():i32{
  clearState();buildGraph();
  for(let ai:i32=0;ai<allNodeCount;ai++){
    const start=<i32>unchecked(allNodes[ai]);
    if(unchecked(visited[start])!=0)continue;
    if(unchecked(adjCount[start])==0){unchecked(visited[start]=1);continue;}
    // colorSeen contains previous component bits; clear only all nodes before BFS.
    for(let i:i32=0;i<allNodeCount;i++)unchecked(colorSeen[<i32>unchecked(allNodes[i])]=0);
    buildComponent(start);buildPattern();
    if(ruleA()||ruleB()||ruleC()||ruleD()){actionType=2;return actionType;}
  }
  return 0;
}

export function medusaResultActionType():i32{return actionType;}
export function medusaResultRuleType():i32{return ruleType;}
export function medusaResultBadColor():i32{return badColor;}
export function medusaResultPatternCount():i32{return patternCount;}
export function medusaResultPatternAt(i:i32):i32{return i>=0&&i<patternCount?<i32>unchecked(pattern[i]):-1;}
export function medusaResultEliminationCount():i32{return eliminationCount;}
export function medusaResultEliminationAt(i:i32):i32{return i>=0&&i<eliminationCount?<i32>unchecked(eliminations[i]):-1;}
export function medusaResultColoringCount():i32{return componentCount;}
export function medusaResultColoringNode(i:i32):i32{return i>=0&&i<componentCount?<i32>unchecked(component[i]):-1;}
export function medusaResultColoringColor(i:i32):i32{
  if(i<0||i>=componentCount)return -1;
  return <i32>unchecked(colorValue[<i32>unchecked(component[i])]);
}
export function medusaResultReasonCount():i32{return reasonCount;}
export function medusaResultReasonNode(i:i32):i32{return i>=0&&i<reasonCount?<i32>unchecked(reasonNodes[i]):-1;}
export function medusaResultReasonColor(i:i32):i32{return i>=0&&i<reasonCount?<i32>unchecked(reasonColors[i]):-1;}

