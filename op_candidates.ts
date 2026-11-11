import { OPERATOR_DEDICATED_AXIS_CANDIDATES } from './lib/operatorCollisionAnalysis.ts';
for (const [i,c] of OPERATOR_DEDICATED_AXIS_CANDIDATES.slice(0,14).entries()) {
  console.log(i+1, c.id, c.score, c.candidateKind, c.focusModes.slice(0,4).join(','), c.focusDynamics.slice(0,4).join(','), c.focusSources.slice(0,4).join(','));
}
