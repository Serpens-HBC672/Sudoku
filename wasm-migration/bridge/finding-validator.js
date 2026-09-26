// Exact boundary rule from frozen DevVer exocetFindingMatchesSolution.
// This is optional known-solution validation, not a second solver.
export function exocetFindingMatchesSolution(finding, solution) {
  if (!solution) return true;
  if (finding.technique !== 'juniorExocet' && finding.technique !== 'seniorExocet') return true;
  if (finding.actionType !== 'eliminate') return true;
  return finding.eliminations.every(e => solution[e.r][e.c] !== e.digit);
}
