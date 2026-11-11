declare const process: { exitCode?: number };

import {
  verifyFixtureFilesAreSynced,
  verifyFixtureFileParsing,
  verifyLegacyMigrationRebuild,
  verifyOptionalRealExportFixtures,
  verifyRoundTripStability,
  verifySparseSerializationRecovery,
} from './verifyPhase5FixtureScenarios';
import {
  verifyDuplicateImportRecovery,
  verifyFileRoundTripAndImportPreparation,
  verifyImportInspectionDiagnostics,
  verifyOrphanSequenceRecovery,
  verifyReplaceModePreservesStableIds,
} from './verifyPhase5ImportScenarios';

export async function main() {
  const results = [
    verifyFixtureFilesAreSynced(),
    verifySparseSerializationRecovery(),
    verifyLegacyMigrationRebuild(),
    verifyFixtureFileParsing(),
    verifyReplaceModePreservesStableIds(),
    verifyOptionalRealExportFixtures(),
    verifyImportInspectionDiagnostics(),
    verifyFileRoundTripAndImportPreparation(),
    verifyDuplicateImportRecovery(),
    verifyOrphanSequenceRecovery(),
    verifyRoundTripStability(),
  ];

  console.log(JSON.stringify({
    verifiedScenarioCount: results.length,
    scenarios: results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
