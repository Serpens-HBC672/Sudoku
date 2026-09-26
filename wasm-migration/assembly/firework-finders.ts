// Exact Firework family discovery ports for the frozen JS oracle.
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
@inline function empty(index:i32):bool{return unchecked(grid[index])==0;}
@inline function maskAt(index:i32):u16{return <u16>(unchecked(masks[index])&ALL_DIGITS);}
@inline function factIndex(index:i32,d:i32):i32{return (index/9)*81+(index%9)*9+(d-1);}
function pop9(value:u16):i32{
  let m=<u16>(value&ALL_DIGITS),n:i32=0;
  while(m!=0){m=<u16>(m&<u16>(m-1));n++;}
  return n;
}
function appendPattern(index:i32):void{unchecked(patternCells[patternCount++]=<u8>index);}
function appendElim(index:i32,d:i32):void{unchecked(eliminations[eliminationCount++]=<u16>factIndex(index,d));}
function resetResult():void{
  actionType=0;patternCount=0;eliminationCount=0;
  for(let i:i32=0;i<8;i++)unchecked(meta[i]=0);
}

export function fireworkResetInput():void{
  for(let i:i32=0;i<CELL_COUNT;i++){unchecked(grid[i]=0);unchecked(masks[i]=0);}
}
export function fireworkSetInputCell(index:i32,digit:i32):void{
  if(index>=0&&index<CELL_COUNT)unchecked(grid[index]=<u8>digit);
}
export function fireworkSetInputMask(index:i32,mask:i32):void{
  if(index>=0&&index<CELL_COUNT)unchecked(masks[index]=<u16>(mask&0x1ff));
}

function digitsOf(mask:u16,out:StaticArray<i32>):i32{
  let n:i32=0;
  for(let d:i32=1;d<=9;d++)if((mask&bit(d))!=0)unchecked(out[n++]=d);
  return n;
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
function comboMask(digits:StaticArray<i32>,idx:StaticArray<i32>,k:i32):u16{
  let m:u16=0;
  for(let i:i32=0;i<k;i++)m=<u16>(m|bit(unchecked(digits[unchecked(idx[i])])));
  return m;
}

// Returns the unique outside-box candidate cell, or -1 if zero/more than one.
function outsideUnique(r:i32,c:i32,axis:i32,combo:u16):i32{
  const boxCol=(c/3)*3,boxRow=(r/3)*3;
  let found:i32=-1,count:i32=0;
  if(axis==0){
    for(let cc:i32=0;cc<9;cc++){
      if(cc>=boxCol&&cc<boxCol+3)continue;
      const index=r*9+cc;
      if(!empty(index)||(maskAt(index)&combo)==0)continue;
      found=index;count++;if(count>1)return -1;
    }
  }else{
    for(let rr:i32=0;rr<9;rr++){
      if(rr>=boxRow&&rr<boxRow+3)continue;
      const index=rr*9+c;
      if(!empty(index)||(maskAt(index)&combo)==0)continue;
      found=index;count++;if(count>1)return -1;
    }
  }
  return count==1?found:-1;
}

function eliminateOutsideLock(cells:StaticArray<i32>,count:i32,lock:u16):void{
  eliminationCount=0;
  for(let i:i32=0;i<count;i++){
    const index=unchecked(cells[i]),remove=<u16>(maskAt(index)&<u16>(~lock));
    for(let d:i32=1;d<=9;d++)if((remove&bit(d))!=0)appendElim(index,d);
  }
}

function findTriple():i32{
  const digits=new StaticArray<i32>(9),idx=new StaticArray<i32>(3),cells=new StaticArray<i32>(3);
  for(let stem:i32=0;stem<CELL_COUNT;stem++){
    if(!empty(stem))continue;
    const dn=digitsOf(maskAt(stem),digits);if(dn<3)continue;
    initCombo(idx,3);
    while(true){
      const cm=comboMask(digits,idx,3);
      const r=stem/9,c=stem%9;
      const row=outsideUnique(r,c,0,cm);
      if(row>=0){
        const col=outsideUnique(r,c,1,cm);
        if(col>=0){
          unchecked(cells[0]=stem);unchecked(cells[1]=row);unchecked(cells[2]=col);
          eliminateOutsideLock(cells,3,cm);
          if(eliminationCount>0){
            actionType=2;patternCount=0;appendPattern(stem);appendPattern(row);appendPattern(col);
            unchecked(meta[0]=<i32>cm);return actionType;
          }
        }
      }
      if(!nextCombo(idx,dn,3))break;
    }
  }
  return 0;
}

function validSubsets(
  stem:i32,rowTarget:i32,colTarget:i32,
  outMask:StaticArray<u16>,outSize:StaticArray<u8>
):i32{
  const digits=new StaticArray<i32>(9),idx=new StaticArray<i32>(9);
  const dn=digitsOf(maskAt(stem),digits);
  let count:i32=0;
  for(let k:i32=1;k<=dn;k++){
    initCombo(idx,k);
    while(true){
      const cm=comboMask(digits,idx,k),r=stem/9,c=stem%9;
      if(outsideUnique(r,c,0,cm)==rowTarget&&outsideUnique(r,c,1,cm)==colTarget){
        unchecked(outMask[count]=cm);unchecked(outSize[count]=<u8>k);count++;
      }
      if(!nextCombo(idx,dn,k))break;
    }
  }
  return count;
}

function findQuadruple():i32{
  const v1Mask=new StaticArray<u16>(512),v2Mask=new StaticArray<u16>(512);
  const v1Size=new StaticArray<u8>(512),v2Size=new StaticArray<u8>(512);
  const cells=new StaticArray<i32>(4);
  for(let r1:i32=0;r1<9;r1++)for(let r2:i32=0;r2<9;r2++){
    if(r2==r1)continue;
    for(let c1:i32=0;c1<9;c1++)for(let c2:i32=0;c2<9;c2++){
      if(c2==c1)continue;
      const s1=r1*9+c1,s2=r2*9+c2,leaf1=r1*9+c2,leaf2=r2*9+c1;
      if(!empty(s1)||!empty(s2)||!empty(leaf1)||!empty(leaf2))continue;
      const n1=validSubsets(s1,leaf1,leaf2,v1Mask,v1Size);if(n1==0)continue;
      const n2=validSubsets(s2,leaf2,leaf1,v2Mask,v2Size);if(n2==0)continue;
      for(let i:i32=0;i<n1;i++)for(let j:i32=0;j<n2;j++){
        const m1=unchecked(v1Mask[i]),m2=unchecked(v2Mask[j]);
        if((m1&m2)!=0)continue;
        if(<i32>unchecked(v1Size[i])+<i32>unchecked(v2Size[j])!=4)continue;
        const lock=<u16>(m1|m2);
        unchecked(cells[0]=s1);unchecked(cells[1]=s2);unchecked(cells[2]=leaf1);unchecked(cells[3]=leaf2);
        eliminateOutsideLock(cells,4,lock);
        if(eliminationCount>0){
          actionType=2;patternCount=0;
          for(let k:i32=0;k<4;k++)appendPattern(unchecked(cells[k]));
          unchecked(meta[0]=<i32>lock);return actionType;
        }
      }
    }
  }
  return 0;
}

function findWWing():i32{
  const digits=new StaticArray<i32>(9),idx=new StaticArray<i32>(2);
  for(let stem:i32=0;stem<CELL_COUNT;stem++){
    if(!empty(stem))continue;
    const dn=digitsOf(maskAt(stem),digits);if(dn<2)continue;
    initCombo(idx,2);
    while(true){
      const cm=comboMask(digits,idx,2),r=stem/9,c=stem%9;
      const leaf1=outsideUnique(r,c,0,cm);
      if(leaf1>=0){
        const leaf2=outsideUnique(r,c,1,cm);
        if(leaf2>=0){
          const target=(leaf2/9)*9+(leaf1%9);
          if(empty(target)&&(maskAt(target)&cm)!=0){
            let assist1:i32=-1;
            for(let rr:i32=0;rr<9;rr++){
              if(rr==leaf1/9||rr==target/9)continue;
              const index=rr*9+(leaf1%9);
              if(empty(index)&&maskAt(index)==cm){assist1=index;break;}
            }
            if(assist1>=0){
              let assist2:i32=-1;
              for(let cc:i32=0;cc<9;cc++){
                if(cc==leaf2%9||cc==target%9)continue;
                const index=(leaf2/9)*9+cc;
                if(empty(index)&&maskAt(index)==cm){assist2=index;break;}
              }
              if(assist2>=0){
                eliminationCount=0;
                const tm=<u16>(maskAt(target)&cm);
                for(let d:i32=1;d<=9;d++)if((tm&bit(d))!=0)appendElim(target,d);
                if(eliminationCount>0){
                  actionType=2;patternCount=0;
                  appendPattern(stem);appendPattern(leaf1);appendPattern(leaf2);
                  appendPattern(assist1);appendPattern(assist2);appendPattern(target);
                  unchecked(meta[0]=<i32>cm);return actionType;
                }
              }
            }
          }
        }
      }
      if(!nextCombo(idx,dn,2))break;
    }
  }
  return 0;
}

function findAlp():i32{
  const digits=new StaticArray<i32>(9),idx=new StaticArray<i32>(2);
  for(let stem:i32=0;stem<CELL_COUNT;stem++){
    if(!empty(stem))continue;
    const dn=digitsOf(maskAt(stem),digits);if(dn<2)continue;
    initCombo(idx,2);
    while(true){
      const cm=comboMask(digits,idx,2),r=stem/9,c=stem%9;
      const row=outsideUnique(r,c,0,cm);
      if(row>=0){
        const col=outsideUnique(r,c,1,cm);
        if(col>=0){
          const assist=(col/9)*9+(row%9);
          if(empty(assist)&&maskAt(assist)==cm){
            eliminationCount=0;
            const remove=<u16>(maskAt(stem)&<u16>(~cm));
            for(let d:i32=1;d<=9;d++)if((remove&bit(d))!=0)appendElim(stem,d);
            if(eliminationCount>0){
              actionType=2;patternCount=0;appendPattern(stem);appendPattern(row);appendPattern(col);appendPattern(assist);
              unchecked(meta[0]=<i32>cm);return actionType;
            }
          }
        }
      }
      if(!nextCombo(idx,dn,2))break;
    }
  }
  return 0;
}

export function fireworkFind(id:i32):i32{
  resetResult();
  if(id==31)return findTriple();
  if(id==32)return findQuadruple();
  if(id==33)return findWWing();
  if(id==34)return findAlp();
  return 0;
}
export function fireworkResultActionType():i32{return actionType;}
export function fireworkResultPatternCount():i32{return patternCount;}
export function fireworkResultPatternAt(i:i32):i32{return i>=0&&i<patternCount?<i32>unchecked(patternCells[i]):-1;}
export function fireworkResultEliminationCount():i32{return eliminationCount;}
export function fireworkResultEliminationAt(i:i32):i32{return i>=0&&i<eliminationCount?<i32>unchecked(eliminations[i]):-1;}
export function fireworkResultMeta(i:i32):i32{return i>=0&&i<8?unchecked(meta[i]):0;}
