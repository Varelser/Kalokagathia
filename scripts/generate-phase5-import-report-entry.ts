declare const process: { cwd(): string };

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { parseProjectData } from '../lib/projectState';
import {
  buildProjectImportNotice,
  buildProjectImportPreparationReport,
  prepareImportedProjectData,
} from '../lib/projectTransferShared';
import { stableJsonStringify } from './projectPhase5Fixtures.ts';

interface Phase5ImportReportScenario {
  id: string;
  fileName: string;
  importMode: 'replace' | 'merge';
  sourcePresetCount: number;
  importedPresetCount: number;
  sourceSequenceCount: number;
  importedSequenceCount: number;
  diagnostics: ReturnType<typeof prepareImportedProjectData>['diagnostics'];
  exactIdChangeReport: ReturnType<typeof buildProjectImportPreparationReport>;
  notice: string;
}

interface Phase5ImportScenarioCompareSummary {
  id: string;
  fileName: string;
  importMode: 'replace' | 'merge';
  retainedPresetIds: number;
  remappedPresetIds: number;
  retainedSequenceIds: number;
  regeneratedSequenceIds: number;
  droppedOrphanSequenceSteps: number;
  preservedPresetPayloads: number;
  preservedSequencePayloads: number;
  presetReferenceRemaps: number;
}

interface Phase5ImportReportAggregateSummary {
  retainedPresetIds: number;
  remappedPresetIds: number;
  retainedSequenceIds: number;
  regeneratedSequenceIds: number;
  droppedOrphanSequenceSteps: number;
  preservedPresetPayloads: number;
  preservedSequencePayloads: number;
  presetReferenceRemaps: number;
}

interface Phase5ImportReport {
  generatedAt: string;
  scenarioCount: number;
  scenarios: Phase5ImportReportScenario[];
  compareSummary: Phase5ImportScenarioCompareSummary[];
  aggregateSummary: Phase5ImportReportAggregateSummary;
}

function readFixture(rootDir: string, fileName: string) {
  const absolutePath = path.join(rootDir, 'fixtures', 'project-state', fileName);
  const parsed = parseProjectData(JSON.parse(readFileSync(absolutePath, 'utf8')));
  if (!parsed) {
    throw new Error(`Failed to parse fixture: ${fileName}`);
  }
  return parsed;
}

function buildReport(rootDir = process.cwd()): Phase5ImportReport {
  const native = readFixture(rootDir, 'phase5-native-rich.json');
  const duplicate = readFixture(rootDir, 'phase5-duplicate-ids-invalid-active.json');
  const orphan = readFixture(rootDir, 'phase5-orphan-sequence.json');

  const scenarios: Phase5ImportReportScenario[] = [
    {
      id: 'native-rich-replace',
      fileName: 'phase5-native-rich.json',
      importMode: 'replace',
      ...(() => {
        const suffixes = ['rpt-replace-01', 'rpt-replace-02', 'rpt-replace-03', 'rpt-replace-04'];
        const prepared = prepareImportedProjectData(native, {
          importMode: 'replace',
          existingPresetIds: native.presets.map((preset) => preset.id),
          existingSequenceIds: native.presetSequence.map((item) => item.id),
          createIdSuffix: () => suffixes.shift() ?? 'rpt-replace-zz',
        });
        return {
          sourcePresetCount: native.presets.length,
          importedPresetCount: prepared.importedPresets.length,
          sourceSequenceCount: native.presetSequence.length,
          importedSequenceCount: prepared.importedSequence.length,
          diagnostics: prepared.diagnostics,
          exactIdChangeReport: buildProjectImportPreparationReport(prepared, native),
          notice: buildProjectImportNotice(prepared.project, prepared.importedPresets.length, prepared.diagnostics),
        };
      })(),
    },
    {
      id: 'native-rich-merge',
      fileName: 'phase5-native-rich.json',
      importMode: 'merge',
      ...(() => {
        const suffixes = ['rpt-merge-01', 'rpt-merge-02', 'rpt-merge-03', 'rpt-merge-04'];
        const prepared = prepareImportedProjectData(native, {
          importMode: 'merge',
          existingPresetIds: native.presets.map((preset) => preset.id),
          existingSequenceIds: [native.presetSequence[0]?.id ?? ''],
          createIdSuffix: () => suffixes.shift() ?? 'rpt-merge-zz',
        });
        return {
          sourcePresetCount: native.presets.length,
          importedPresetCount: prepared.importedPresets.length,
          sourceSequenceCount: native.presetSequence.length,
          importedSequenceCount: prepared.importedSequence.length,
          diagnostics: prepared.diagnostics,
          exactIdChangeReport: buildProjectImportPreparationReport(prepared, native),
          notice: buildProjectImportNotice(prepared.project, prepared.importedPresets.length, prepared.diagnostics),
        };
      })(),
    },
    {
      id: 'duplicate-merge',
      fileName: 'phase5-duplicate-ids-invalid-active.json',
      importMode: 'merge',
      ...(() => {
        const suffixes = ['rpt-dup-01', 'rpt-dup-02', 'rpt-dup-03', 'rpt-dup-04', 'rpt-dup-05', 'rpt-dup-06'];
        const prepared = prepareImportedProjectData(duplicate, {
          importMode: 'merge',
          existingPresetIds: ['preset-duplicate'],
          existingSequenceIds: ['seq-duplicate'],
          createIdSuffix: () => suffixes.shift() ?? 'rpt-dup-zz',
        });
        return {
          sourcePresetCount: duplicate.presets.length,
          importedPresetCount: prepared.importedPresets.length,
          sourceSequenceCount: duplicate.presetSequence.length,
          importedSequenceCount: prepared.importedSequence.length,
          diagnostics: prepared.diagnostics,
          exactIdChangeReport: buildProjectImportPreparationReport(prepared, duplicate),
          notice: buildProjectImportNotice(prepared.project, prepared.importedPresets.length, prepared.diagnostics),
        };
      })(),
    },
    {
      id: 'orphan-merge',
      fileName: 'phase5-orphan-sequence.json',
      importMode: 'merge',
      ...(() => {
        const suffixes = ['rpt-orphan-01', 'rpt-orphan-02', 'rpt-orphan-03', 'rpt-orphan-04'];
        const prepared = prepareImportedProjectData(orphan, {
          importMode: 'merge',
          existingPresetIds: ['preset-alpha'],
          existingSequenceIds: ['seq-valid'],
          createIdSuffix: () => suffixes.shift() ?? 'rpt-orphan-zz',
        });
        return {
          sourcePresetCount: orphan.presets.length,
          importedPresetCount: prepared.importedPresets.length,
          sourceSequenceCount: orphan.presetSequence.length,
          importedSequenceCount: prepared.importedSequence.length,
          diagnostics: prepared.diagnostics,
          exactIdChangeReport: buildProjectImportPreparationReport(prepared, orphan),
          notice: buildProjectImportNotice(prepared.project, prepared.importedPresets.length, prepared.diagnostics),
        };
      })(),
    },
  ];

  const compareSummary = scenarios.map((scenario) => ({
    id: scenario.id,
    fileName: scenario.fileName,
    importMode: scenario.importMode,
    retainedPresetIds: scenario.exactIdChangeReport.summary.retainedPresetIdCount,
    remappedPresetIds: scenario.exactIdChangeReport.summary.presetIdChangedCount,
    retainedSequenceIds: scenario.exactIdChangeReport.summary.retainedSequenceIdCount,
    regeneratedSequenceIds: scenario.exactIdChangeReport.summary.sequenceIdChangedCount,
    droppedOrphanSequenceSteps: scenario.exactIdChangeReport.summary.droppedOrphanSequenceCount,
    preservedPresetPayloads: scenario.exactIdChangeReport.summary.preservedPresetPayloadCount,
    preservedSequencePayloads: scenario.exactIdChangeReport.summary.preservedSequencePayloadCount,
    presetReferenceRemaps: scenario.exactIdChangeReport.summary.presetReferenceRemapCount,
  }));

  const aggregateSummary = compareSummary.reduce<Phase5ImportReportAggregateSummary>((acc, scenario) => ({
    retainedPresetIds: acc.retainedPresetIds + scenario.retainedPresetIds,
    remappedPresetIds: acc.remappedPresetIds + scenario.remappedPresetIds,
    retainedSequenceIds: acc.retainedSequenceIds + scenario.retainedSequenceIds,
    regeneratedSequenceIds: acc.regeneratedSequenceIds + scenario.regeneratedSequenceIds,
    droppedOrphanSequenceSteps: acc.droppedOrphanSequenceSteps + scenario.droppedOrphanSequenceSteps,
    preservedPresetPayloads: acc.preservedPresetPayloads + scenario.preservedPresetPayloads,
    preservedSequencePayloads: acc.preservedSequencePayloads + scenario.preservedSequencePayloads,
    presetReferenceRemaps: acc.presetReferenceRemaps + scenario.presetReferenceRemaps,
  }), {
    retainedPresetIds: 0,
    remappedPresetIds: 0,
    retainedSequenceIds: 0,
    regeneratedSequenceIds: 0,
    droppedOrphanSequenceSteps: 0,
    preservedPresetPayloads: 0,
    preservedSequencePayloads: 0,
    presetReferenceRemaps: 0,
  });

  return {
    generatedAt: new Date().toISOString(),
    scenarioCount: scenarios.length,
    scenarios,
    compareSummary,
    aggregateSummary,
  };
}

const rootDir = process.cwd();
const report = buildReport(rootDir);
const outPath = path.join(rootDir, 'docs', 'archive', 'phase5-import-report.json');
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, stableJsonStringify(report));
console.log(`phase5 import report written: ${outPath}`);
