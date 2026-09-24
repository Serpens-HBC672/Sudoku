# Technique coverage

Coverage source: frozen JS oracle at baseline `fa68cb875b32673a66d8d9a3b46d891b3e3adee7`, readable source `Sudoku v3.23.3-rc.3 - DevVer.html`.

The registry is derived from `TECHNIQUE_CHAIN`; the number 53 is reported evidence, not a hard-coded coverage target.

## Current corpus result

- Registered techniques: **53**
- Benchmark cases traced for first-match coverage: **57/57**
- First-match observed: **41/53**
- Bounded all-available observed: **35/53**
- Union observed: **46/53**
- Oracle soundness failures: **0**
- All-available states scanned: **5**

First-match and all-available coverage are intentionally separate. The normal trace records the selected first-match finding at every solve state. The expensive existing `findAllAvailableSteps` path was then sampled on one recorded state from each of benchmark ids **11, 34, 47, 53, 57**. This avoids repeatedly invoking all expensive techniques on every state of DFC-heavy puzzles.

## First-match observed

nakedSingle, hiddenSingle, lockedCandidate, gsp, nakedPair, hiddenPair, nakedTriple, hiddenTriple, nakedQuad, xWing, swordfish, skyscraper, twoStringKite, emptyRectangle, finnedXWing, finnedSwordfish, finnedJellyfish, uniqueRectangleType1, uniqueRectangleType2, hiddenUniqueRectangle, bugPlusOne, xyzWing, wWing, wxyzWing, xyChain, aic, sueDeCoq, pom, alsXZ, ahsXZ, alsChain, medusa3D, tridagon, unaryChain, nishioChain, tridagonForce, skLoop, msls, juniorExocet, dynamicNishioChain, dynamicUnaryChain.

## Bounded all-available observed

nakedSingle, hiddenSingle, lockedCandidate, gsp, nakedPair, hiddenPair, nakedTriple, hiddenTriple, nakedQuad, hiddenQuad, xWing, swordfish, skyscraper, twoStringKite, emptyRectangle, jellyfish, squirmbagFish, finnedXWing, finnedSwordfish, finnedJellyfish, hiddenUniqueRectangle, xyzWing, xyChain, aic, niceLoop, sueDeCoq, pom, alsXZ, ahsXZ, alsChain, deathBlossom, medusa3D, nishioChain, msls, dynamicNishioChain.

## Not observed by either scan

The supplied 57-puzzle corpus did **not** exercise these seven techniques in either the complete first-match traces or the documented bounded all-available scan:

- fireworkTriple
- fireworkQuadruple
- fireworkWWing
- fireworkAlp
- multipleChain
- seniorExocet
- dynamicMultipleChain

No coverage is fabricated for them. Their migration gates therefore rely on per-technique JS↔WASM differential checks on the supplied benchmark starts (including null-result equivalence) plus any future targeted fixtures added by the owner.

## Evidence

The coverage workflow is `.github/workflows/wasm-coverage.yml`; generator is `benchmark/coverage-scan.mjs`. The recorded evidence artifact from the full 57-board oracle scan reported `first=41/53 allAvailable=35/53 union=46/53` with zero soundness failures.
