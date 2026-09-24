// Exact Firework family discovery ports.
// Candidate state is always a low-9-bit u16 mask.

const CELL_COUNT:i32 = 81;
const FACT_COUNT:i32 = 729;
const ALL:u16 = 0x01ff;

const grid = new StaticArray<u8>(CELL_COUNT);
const masks = new StaticArray<u16>(CELL_COUNT);

let actionType:i32 = 0;
let techniqueId:i32 = -1;
const pattern = new StaticArray<u8>(CELL_COUNT);
let patternCount:i32 = 0;
const eliminations = new StaticArray<u16>(FACT_COUNT);
let eliminationCount:i32 = 0;
const meta = new StaticArray<i32>(24);

@inline
function bit(d:i32):u16 {
  switch(d){
    case 1:return 0x001; case 2:return 0x002; case 3:return 0x004;
    case 4:return 0x008; case 5:return 0x010; case 6:return 0x020;
    case 7:return 0x040; case 8:return 0x080; case 9:return 0x100;
    default:return 0;
  }
}
@inline function boxIndex(r:i32,c:i32):i32 { return (r/3)*3+c/3; }
@inline function empty(index:i32):bool { return unchecked(grid[index])==0; }
@inline function maskAt(index:i32):u16 { return <u16>(unchecked(masks[index]) & ALL); }
@inline function factIndex(index:i32,d:i32):i32 { return (index/9)*81+(index%9)*9+(d-1); }

function popcount(value:u16):i32 {
  let m=<u16>(value & ALL), n:i32=0;
  while(m!=0){ m=<u16>(m & <u16>(m-1)); n++; }
  return n;
}
function resetResult():void{
  actionType=0; techniqueId=-1; patternCount=0; eliminationCount=0;
  for(let i:i32=0;i<24;i++) unchecked(meta[i]=0);
}
function addPattern(index:i32):void { unchecked(pattern[patternCount++]=<u8>index); }
function addElim(index:i32,d:i32):void { unchecked(eliminations[eliminationCount++]=<u16>factIndex(index,d)); }

export function fireworkResetInput():void{
  for(let i:i32=0;i<CELL_COUNT;i++){ unchecked(grid[i]=0); unchecked(masks[i]=0); }
}
export function fireworkSetInputCell(index:i32,d:i32):void{
  if(index>=0&&index<CELL_COUNT) unchecked(grid[index]=<u8>d);
}
export function fireworkSetInputMask(index:i32,m:i32):void{
  if(index>=0&&index<CELL_COUNT) unchecked(masks[index]=<u16>(m&0x1ff));
}

// Return unique outside-box cell index, else -1.
// Exact JS semantics: only whether there is exactly one matching cell matters.
function outsideUnique(stem:i32, axis:i32, comboMask:u16):i32{
  const r=stem/9, c=stem%9;
  const boxColStart=(c/3)*3, boxRowStart=(r/3)*3;
  let found:i32=-1, count:i32=0;
  if(axis==0){
    for(let cc:i32=0;cc<9;cc++){
      if(cc>=boxColStart&&cc<boxColStart+3) continue;
      const index=r*9+cc;
      if(!empty(index)) continue;
      if((maskAt(index)&comboMask)!=0){
        found=index; count++;
        if(count>1) return -1;
      }
    }
  } else {
    for(let rr:i32=0;rr<9;rr++){
      if(rr>=boxRowStart&&rr<boxRowStart+3) continue;
      const index=rr*9+c;
      if(!empty(index)) continue;
      if((maskAt(index)&comboMask)!=0){
        found=index; count++;
        if(count>1) return -1;
      }
    }
  }
  return count==1?found:-1;
}

function digitsFromMask(m:u16, out:StaticArray<i32>):i32{
  let n:i32=0;
  for(let d:i32=1;d<=9;d++) if((m&bit(d))!=0) unchecked(out[n++]=d);
  return n;
}
function initCombo(combo:StaticArray<i32>,k:i32):void{
  for(let i:i32=0;i<k;i++) unchecked(combo[i]=i);
}
function advanceCombo(combo:StaticArray<i32>,n:i32,k:i32):bool{
  let i=k-1;
  while(i>=0&&unchecked(combo[i])==n-k+i) i--;
  if(i<0) return false;
  unchecked(combo[i]=unchecked(combo[i])+1);
  for(let j=i+1;j<k;j++) unchecked(combo[j]=unchecked(combo[j-1])+1);
  return true;
}
function comboMaskOf(digits:StaticArray<i32>,combo:StaticArray<i32>,k:i32):u16{
  let m:u16=0;
  for(let i:i32=0;i<k;i++) m=<u16>(m|bit(unchecked(digits[unchecked(combo[i])])));
  return m;
}
function addOutsideDigits(index:i32, keepMask:u16):void{
  const remove=<u16>(maskAt(index)&<u16>(~keepMask));
  for(let d:i32=1;d<=9;d++) if((remove&bit(d))!=0) addElim(index,d);
}

function findTriple():i32{
  const digits=new StaticArray<i32>(9);
  const combo=new StaticArray<i32>(9);
  for(let r:i32=0;r<9;r++) for(let c:i32=0;c<9;c++){
    const stem=r*9+c;
    if(!empty(stem)) continue;
    const n=digitsFromMask(maskAt(stem),digits);
    if(n<3) continue;
    initCombo(combo,3);
    while(true){
      const lock=comboMaskOf(digits,combo,3);
      const rowLeaf=outsideUnique(stem,0,lock);
      if(rowLeaf>=0){
        const colLeaf=outsideUnique(stem,1,lock);
        if(colLeaf>=0){
          eliminationCount=0;
          addOutsideDigits(stem,lock); addOutsideDigits(rowLeaf,lock); addOutsideDigits(colLeaf,lock);
          if(eliminationCount>0){
            actionType=2; techniqueId=31; patternCount=0;
            addPattern(stem); addPattern(rowLeaf); addPattern(colLeaf);
            unchecked(meta[0]=stem); unchecked(meta[1]=rowLeaf); unchecked(meta[2]=colLeaf);
            unchecked(meta[3]=<i32>lock);
            return actionType;
          }
        }
      }
      if(!advanceCombo(combo,n,3)) break;
    }
  }
  return 0;
}

function collectValidLocks(stem:i32,rowTarget:i32,colTarget:i32,outMasks:StaticArray<u16>):i32{
  const digits=new StaticArray<i32>(9);
  const combo=new StaticArray<i32>(9);
  const n=digitsFromMask(maskAt(stem),digits);
  let count:i32=0;
  for(let size:i32=1;size<=n;size++){
    initCombo(combo,size);
    while(true){
      const lock=comboMaskOf(digits,combo,size);
      const rowLeaf=outsideUnique(stem,0,lock);
      if(rowLeaf==rowTarget){
        const colLeaf=outsideUnique(stem,1,lock);
        if(colLeaf==colTarget) unchecked(outMasks[count++]=lock);
      }
      if(!advanceCombo(combo,n,size)) break;
    }
  }
  return count;
}

function findQuadruple():i32{
  const valid1=new StaticArray<u16>(511);
  const valid2=new StaticArray<u16>(511);
  for(let r1:i32=0;r1<9;r1++) for(let r2:i32=0;r2<9;r2++){
    if(r2==r1) continue;
    for(let c1:i32=0;c1<9;c1++) for(let c2:i32=0;c2<9;c2++){
      if(c2==c1) continue;
      const s1=r1*9+c1, s2=r2*9+c2, leaf1=r1*9+c2, leaf2=r2*9+c1;
      if(!empty(s1)||!empty(s2)||!empty(leaf1)||!empty(leaf2)) continue;
      const n1=collectValidLocks(s1,leaf1,leaf2,valid1);
      if(n1==0) continue;
      const n2=collectValidLocks(s2,leaf2,leaf1,valid2);
      if(n2==0) continue;
      for(let i:i32=0;i<n1;i++){
        const m1=unchecked(valid1[i]);
        for(let j:i32=0;j<n2;j++){
          const m2=unchecked(valid2[j]);
          if((m1&m2)!=0) continue;
          if(popcount(m1)+popcount(m2)!=4) continue;
          const lock=<u16>(m1|m2);
          eliminationCount=0;
          addOutsideDigits(s1,lock); addOutsideDigits(s2,lock); addOutsideDigits(leaf1,lock); addOutsideDigits(leaf2,lock);
          if(eliminationCount>0){
            actionType=2; techniqueId=32; patternCount=0;
            addPattern(s1); addPattern(s2); addPattern(leaf1); addPattern(leaf2);
            unchecked(meta[0]=s1); unchecked(meta[1]=s2);
            unchecked(meta[2]=leaf1); unchecked(meta[3]=leaf2);
            unchecked(meta[4]=<i32>lock);
            return actionType;
          }
        }
      }
    }
  }
  return 0;
}

function findWWing():i32{
  const digits=new StaticArray<i32>(9);
  const combo=new StaticArray<i32>(2);
  for(let r:i32=0;r<9;r++) for(let c:i32=0;c<9;c++){
    const stem=r*9+c;
    if(!empty(stem)) continue;
    const n=digitsFromMask(maskAt(stem),digits);
    if(n<2) continue;
    initCombo(combo,2);
    while(true){
      const x=unchecked(digits[unchecked(combo[0])]), y=unchecked(digits[unchecked(combo[1])]);
      const lock=<u16>(bit(x)|bit(y));
      const leaf1=outsideUnique(stem,0,lock);
      if(leaf1>=0){
        const leaf2=outsideUnique(stem,1,lock);
        if(leaf2>=0){
          const target=(leaf2/9)*9+(leaf1%9);
          if(empty(target) && (maskAt(target)&lock)!=0){
            let assist1:i32=-1;
            for(let rr:i32=0;rr<9;rr++){
              const index=rr*9+(leaf1%9);
              if(rr==leaf1/9||rr==target/9) continue;
              if(empty(index)&&maskAt(index)==lock){assist1=index;break;}
            }
            if(assist1>=0){
              let assist2:i32=-1;
              for(let cc:i32=0;cc<9;cc++){
                const index=(leaf2/9)*9+cc;
                if(cc==leaf2%9||cc==target%9) continue;
                if(empty(index)&&maskAt(index)==lock){assist2=index;break;}
              }
              if(assist2>=0){
                eliminationCount=0;
                const tm=<u16>(maskAt(target)&lock);
                for(let d:i32=1;d<=9;d++) if((tm&bit(d))!=0) addElim(target,d);
                if(eliminationCount>0){
                  actionType=2; techniqueId=33; patternCount=0;
                  addPattern(stem);addPattern(leaf1);addPattern(leaf2);addPattern(assist1);addPattern(assist2);addPattern(target);
                  unchecked(meta[0]=stem);unchecked(meta[1]=leaf1);unchecked(meta[2]=leaf2);
                  unchecked(meta[3]=assist1);unchecked(meta[4]=assist2);unchecked(meta[5]=target);
                  unchecked(meta[6]=<i32>lock);
                  return actionType;
                }
              }
            }
          }
        }
      }
      if(!advanceCombo(combo,n,2)) break;
    }
  }
  return 0;
}

function findAlp():i32{
  const digits=new StaticArray<i32>(9);
  const combo=new StaticArray<i32>(2);
  for(let r:i32=0;r<9;r++) for(let c:i32=0;c<9;c++){
    const stem=r*9+c;
    if(!empty(stem)) continue;
    const n=digitsFromMask(maskAt(stem),digits);
    if(n<2) continue;
    initCombo(combo,2);
    while(true){
      const x=unchecked(digits[unchecked(combo[0])]), y=unchecked(digits[unchecked(combo[1])]);
      const lock=<u16>(bit(x)|bit(y));
      const rowPartner=outsideUnique(stem,0,lock);
      if(rowPartner>=0){
        const colPartner=outsideUnique(stem,1,lock);
        if(colPartner>=0){
          const assist=(colPartner/9)*9+(rowPartner%9);
          if(empty(assist)&&maskAt(assist)==lock){
            eliminationCount=0;
            const remove=<u16>(maskAt(stem)&<u16>(~lock));
            for(let d:i32=1;d<=9;d++) if((remove&bit(d))!=0) addElim(stem,d);
            if(eliminationCount>0){
              actionType=2;techniqueId=34;patternCount=0;
              addPattern(stem);addPattern(rowPartner);addPattern(colPartner);addPattern(assist);
              unchecked(meta[0]=stem);unchecked(meta[1]=rowPartner);unchecked(meta[2]=colPartner);unchecked(meta[3]=assist);
              unchecked(meta[4]=<i32>lock);
              return actionType;
            }
          }
        }
      }
      if(!advanceCombo(combo,n,2)) break;
    }
  }
  return 0;
}

export function fireworkFind(id:i32):i32{
  resetResult();
  if(id==31) return findTriple();
  if(id==32) return findQuadruple();
  if(id==33) return findWWing();
  if(id==34) return findAlp();
  return 0;
}

export function fireworkResultActionType():i32{return actionType;}
export function fireworkResultTechniqueId():i32{return techniqueId;}
export function fireworkResultPatternCount():i32{return patternCount;}
export function fireworkResultPatternAt(i:i32):i32{return i>=0&&i<patternCount?<i32>unchecked(pattern[i]):-1;}
export function fireworkResultEliminationCount():i32{return eliminationCount;}
export function fireworkResultEliminationAt(i:i32):i32{return i>=0&&i<eliminationCount?<i32>unchecked(eliminations[i]):-1;}
export function fireworkResultMeta(i:i32):i32{return i>=0&&i<24?unchecked(meta[i]):0;}
