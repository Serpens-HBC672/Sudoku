import { loadOracle } from "./load-oracle.mjs";
import { loadBenchmarkCorpus } from "./benchmark-corpus.mjs";
const oracle=await loadOracle();
const corpus=await loadBenchmarkCorpus();
for(const t of corpus){
  const masks=Array.from(oracle.candidateMasksForGrid(t.puzzle),Number);
  for(const key of ["juniorExocet","seniorExocet"]){
    const f=oracle.findTechniqueFromMasks(key,t.puzzle,masks,t.puzzle,t.solution);
    if(f) console.log("EXOCET_ORACLE",JSON.stringify({id:t.id,key,f}));
  }
}
