// Exact ALS-Chain and Death Blossom discovery ports for the frozen JS oracle.
// Candidate masks are authoritative u16 values restricted to bits 0..8.

const CELL_COUNT:i32=81;
const FACT_COUNT:i32=729;
const ALL_DIGITS:u16=0x01ff;
const ALS_CAP:i32=4096;

const grid=new StaticArray<u8>(CELL_COUNT);
const masks=new StaticArray<u16>(CELL_COUNT);

const alsSize=new StaticArray<u8>(ALS_CAP);
const alsMask=new StaticArray<u16>(ALS_CAP);
const alsCell0=new StaticArray<u8>(ALS_CAP);
const alsCell1=new StaticArray<u8>(ALS_CAP);
const alsCell2=new StaticArray<u8>(ALS_CAP);
let alsCount:i32=0;

let resultKind:i32=0; // 0 none, 38 ALS-chain, 39 Death Blossom
const patternCells=new StaticArray<u8>(CELL_COUNT);
let patternCount:i32=0;
const eliminations=new StaticArray<u16>(FACT_COUNT);
let eliminationCount:i32=0;
const extraDigits=new StaticArray<u8>(16);
let extraDigitCount:i32=0;
const meta=new StaticArray<i32>(16);

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
function resetResult():void{
  resultKind=0;patternCount=0;eliminationCount=0;extraDigitCount=0;
  for(let i:i32=0;i<16;i++)unchecked(meta[i]=0);
}

export function alsAdvResetInput():void{
  for(let i:i32=0;i<CELL_COUNT;i++){unchecked(grid[i]=0);unchecked(masks[i]=0);}
}
export function alsAdvSetInputCell(index:i32,digit:i32):void{
  if(index>=0&&index<CELL_COUNT)unchecked(grid[index]=<u8>digit);
}
export function alsAdvSetInputMask(index:i32,mask:i32):void{
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
@inline function alsCellAt(ai:i32,pos:i32):i32{
  if(pos==0)return <i32>unchecked(alsCell0[ai]);
  if(pos==1)return <i32>unchecked(alsCell1[ai]);
  return <i32>unchecked(alsCell2[ai]);
}
function sameAls(size:i32,a:i32,b:i32,c:i32,ai:i32):bool{
  if(<i32>unchecked(alsSize[ai])!=size)return false;
  if(alsCellAt(ai,0)!=a)return false;
  if(size>=2&&alsCellAt(ai,1)!=b)return false;
  if(size>=3&&alsCellAt(ai,2)!=c)return false;
  return true;
}
function addAls(size:i32,a:i32,b:i32,c:i32,m:u16):void{
  for(let ai:i32=0;ai<alsCount;ai++)if(sameAls(size,a,b,c,ai))return;
  if(alsCount>=ALS_CAP)return;
  unchecked(alsSize[alsCount]=<u8>size);unchecked(alsMask[alsCount]=m);
  unchecked(alsCell0[alsCount]=<u8>a);unchecked(alsCell1[alsCount]=<u8>b);unchecked(alsCell2[alsCount]=<u8>c);
  alsCount++;
}
function enumerateAls():void{
  alsCount=0;
  const empties=new StaticArray<i32>(9),combo=new StaticArray<i32>(3);
  for(let unitType:i32=0;unitType<3;unitType++){
    for(let idx:i32=0;idx<9;idx++){
      let n:i32=0;
      for(let pos:i32=0;pos<9;pos++){
        const index=unitCell(unitType,idx,pos);
        if(empty(index))unchecked(empties[n++]=index);
      }
      const maxSize=n<3?n:3;
      for(let size:i32=1;size<=maxSize;size++){
        initCombo(combo,size);
        while(true){
          let m:u16=0,a:i32=-1,b:i32=-1,c:i32=-1;
          for(let k:i32=0;k<size;k++){
            const index=unchecked(empties[unchecked(combo[k])]);
            if(k==0)a=index;else if(k==1)b=index;else c=index;
            m=<u16>(m|maskAt(index));
          }
          if(pop9(m)==size+1)addAls(size,a,b,c,m);
          if(!nextCombo(combo,n,size))break;
        }
      }
    }
  }
}
function overlap(a:i32,b:i32):bool{
  const an=<i32>unchecked(alsSize[a]),bn=<i32>unchecked(alsSize[b]);
  for(let i:i32=0;i<an;i++)for(let j:i32=0;j<bn;j++)if(alsCellAt(a,i)==alsCellAt(b,j))return true;
  return false;
}
function containsCell(ai:i32,index:i32):bool{
  const n=<i32>unchecked(alsSize[ai]);
  for(let i:i32=0;i<n;i++)if(alsCellAt(ai,i)==index)return true;
  return false;
}
function digitPositionsAllSeeAls(a:i32,b:i32,d:i32):bool{
  const db=bit(d),an=<i32>unchecked(alsSize[a]),bn=<i32>unchecked(alsSize[b]);
  let anyA=false,anyB=false;
  for(let i:i32=0;i<an;i++){
    const ca=alsCellAt(a,i);if((maskAt(ca)&db)==0)continue;anyA=true;
    for(let j:i32=0;j<bn;j++){
      const cb=alsCellAt(b,j);if((maskAt(cb)&db)==0)continue;anyB=true;
      if(!sees(ca,cb))return false;
    }
  }
  return anyA&&anyB;
}
function collectRccs(a:i32,b:i32,out:StaticArray<i32>):i32{
  const common=<u16>(unchecked(alsMask[a])&unchecked(alsMask[b]));
  let n:i32=0;
  for(let d:i32=1;d<=9;d++)if((common&bit(d))!=0&&digitPositionsAllSeeAls(a,b,d))unchecked(out[n++]=d);
  return n;
}
function cellSeesAllDigitPositions(index:i32,ai:i32,d:i32):bool{
  const db=bit(d),n=<i32>unchecked(alsSize[ai]);
  for(let i:i32=0;i<n;i++){
    const cell=alsCellAt(ai,i);
    if((maskAt(cell)&db)!=0&&!sees(index,cell))return false;
  }
  return true;
}
function appendAls(ai:i32):void{
  const n=<i32>unchecked(alsSize[ai]);
  for(let i:i32=0;i<n;i++)appendPattern(alsCellAt(ai,i));
}

export function alsChainFind():i32{
  resetResult();enumerateAls();
  const rccAB=new StaticArray<i32>(9),rccBC=new StaticArray<i32>(9),all=new StaticArray<i32>(9);
  for(let a:i32=0;a<alsCount;a++){
    for(let b:i32=0;b<alsCount;b++){
      if(b==a||overlap(a,b))continue;
      const nab=collectRccs(a,b,rccAB);
      for(let ia:i32=0;ia<nab;ia++){
        const chosenAB=unchecked(rccAB[ia]);
        for(let c:i32=0;c<alsCount;c++){
          if(c==a||c==b||overlap(a,c)||overlap(b,c))continue;
          const nbc=collectRccs(b,c,rccBC);
          for(let ib:i32=0;ib<nbc;ib++){
            const chosenBC=unchecked(rccBC[ib]);if(chosenBC==chosenAB)continue;
            let used:u16=0;
            const n1=collectRccs(a,b,all);
            for(let k:i32=0;k<n1;k++)used=<u16>(used|bit(unchecked(all[k])));
            const n2=collectRccs(b,c,all);
            for(let k:i32=0;k<n2;k++)used=<u16>(used|bit(unchecked(all[k])));
            const common=<u16>(unchecked(alsMask[a])&unchecked(alsMask[c]));
            for(let z:i32=1;z<=9;z++){
              const zb=bit(z);if((common&zb)==0||(used&zb)!=0)continue;
              eliminationCount=0;
              for(let index:i32=0;index<CELL_COUNT;index++){
                if(containsCell(a,index)||containsCell(b,index)||containsCell(c,index))continue;
                if(!empty(index)||(maskAt(index)&zb)==0)continue;
                if(cellSeesAllDigitPositions(index,a,z)&&cellSeesAllDigitPositions(index,c,z))appendElim(index,z);
              }
              if(eliminationCount>0){
                resultKind=38;patternCount=0;extraDigitCount=0;
                appendAls(a);appendAls(b);appendAls(c);
                unchecked(meta[0]=<i32>unchecked(alsSize[a]));
                unchecked(meta[1]=<i32>unchecked(alsSize[b]));
                unchecked(meta[2]=<i32>unchecked(alsSize[c]));
                unchecked(meta[3]=z);
                unchecked(extraDigits[extraDigitCount++]=<u8>chosenAB);
                unchecked(extraDigits[extraDigitCount++]=<u8>chosenBC);
                return 1;
              }
            }
          }
        }
      }
    }
  }
  return 0;
}

function petalCandidateValid(ai:i32,stem:i32,d:i32,used:StaticArray<i32>,usedCount:i32):bool{
  if(containsCell(ai,stem)||(unchecked(alsMask[ai])&bit(d))==0)return false;
  for(let i:i32=0;i<usedCount;i++)if(overlap(unchecked(used[i]),ai))return false;
  const db=bit(d),n=<i32>unchecked(alsSize[ai]);
  let any=false;
  for(let i:i32=0;i<n;i++){
    const cell=alsCellAt(ai,i);if((maskAt(cell)&db)==0)continue;any=true;
    if(!sees(cell,stem))return false;
  }
  return any;
}

export function deathBlossomFind():i32{
  resetResult();enumerateAls();
  const petals=new StaticArray<i32>(9),petalDigits=new StaticArray<i32>(9);
  for(let stem:i32=0;stem<CELL_COUNT;stem++){
    if(!empty(stem))continue;
    const stemMask=maskAt(stem);if(pop9(stemMask)<2)continue;
    let petalCount:i32=0,allFound=true;
    for(let d:i32=1;d<=9;d++){
      if((stemMask&bit(d))==0)continue;
      let chosen:i32=-1;
      for(let ai:i32=0;ai<alsCount;ai++){
        if(petalCandidateValid(ai,stem,d,petals,petalCount)){chosen=ai;break;}
      }
      if(chosen<0){allFound=false;break;}
      unchecked(petals[petalCount]=chosen);unchecked(petalDigits[petalCount]=d);petalCount++;
    }
    if(!allFound||petalCount==0)continue;
    let common:u16=unchecked(alsMask[unchecked(petals[0])]);
    for(let i:i32=1;i<petalCount;i++)common=<u16>(common&unchecked(alsMask[unchecked(petals[i])]));
    common=<u16>(common&<u16>(~stemMask));
    for(let z:i32=1;z<=9;z++){
      const zb=bit(z);if((common&zb)==0)continue;
      eliminationCount=0;
      for(let index:i32=0;index<CELL_COUNT;index++){
        if(index==stem||!empty(index)||(maskAt(index)&zb)==0)continue;
        let inPetal=false;
        for(let p:i32=0;p<petalCount&&!inPetal;p++)if(containsCell(unchecked(petals[p]),index))inPetal=true;
        if(inPetal)continue;
        let seesAll=true;
        for(let p:i32=0;p<petalCount&&seesAll;p++){
          const ai=unchecked(petals[p]),n=<i32>unchecked(alsSize[ai]);
          for(let j:i32=0;j<n;j++){
            const cell=alsCellAt(ai,j);
            if((maskAt(cell)&zb)!=0&&!sees(index,cell)){seesAll=false;break;}
          }
        }
        if(seesAll)appendElim(index,z);
      }
      if(eliminationCount>0){
        resultKind=39;patternCount=0;extraDigitCount=0;appendPattern(stem);
        unchecked(meta[0]=stem);unchecked(meta[1]=<i32>stemMask);unchecked(meta[2]=petalCount);unchecked(meta[3]=z);
        for(let p:i32=0;p<petalCount;p++){
          const ai=unchecked(petals[p]);
          unchecked(meta[4+p]=<i32>unchecked(alsSize[ai]));
          unchecked(extraDigits[extraDigitCount++]=<u8>unchecked(petalDigits[p]));
          appendAls(ai);
        }
        return 1;
      }
    }
  }
  return 0;
}

export function alsAdvResultKind():i32{return resultKind;}
export function alsAdvResultPatternCount():i32{return patternCount;}
export function alsAdvResultPatternAt(i:i32):i32{return i>=0&&i<patternCount?<i32>unchecked(patternCells[i]):-1;}
export function alsAdvResultEliminationCount():i32{return eliminationCount;}
export function alsAdvResultEliminationAt(i:i32):i32{return i>=0&&i<eliminationCount?<i32>unchecked(eliminations[i]):-1;}
export function alsAdvResultExtraDigitCount():i32{return extraDigitCount;}
export function alsAdvResultExtraDigitAt(i:i32):i32{return i>=0&&i<extraDigitCount?<i32>unchecked(extraDigits[i]):-1;}
export function alsAdvResultMeta(i:i32):i32{return i>=0&&i<16?unchecked(meta[i]):0;}
