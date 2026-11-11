export {
  DEFAULT_PROJECT_UI,
  PROJECT_DATA_VERSION,
  PROJECT_MANIFEST_SCHEMA_VERSION,
  PROJECT_SERIALIZATION_SCHEMA_VERSION,
  PROJECT_FORMAT_ID,
  PROJECT_STORAGE_KEY,
  PROJECT_STORAGE_KEY_LEGACY,
  isPlainObject,
  normalizePresetRecord,
  normalizeSequenceItem,
  uniqueNonEmpty,
} from './projectStateShared';
export { buildProjectManifest, normalizeProjectManifest } from './projectStateManifest';
export { buildProjectData, loadProjectData, parseProjectData, saveProjectData } from './projectStateStorage';
