import type { SequenceDriveMode, SequenceTransitionEasing } from '../types';
import {
  normalizeSequenceDriveMode,
  normalizeSequenceDriveMultiplier,
  normalizeSequenceDriveStrengthOverride,
} from './appState';
import { SetPresetSequence, updateSequenceItem } from './sequenceEditingShared';

export function updateDriveMode(itemId: string, mode: SequenceDriveMode, isPublicLibraryMode: boolean, setPresetSequence: SetPresetSequence) {
  updateSequenceItem(itemId, (item) => ({ ...item, screenSequenceDriveMode: normalizeSequenceDriveMode(mode) }), isPublicLibraryMode, setPresetSequence);
}

export function updateDriveStrengthOverride(itemId: string, value: number, isPublicLibraryMode: boolean, setPresetSequence: SetPresetSequence) {
  updateSequenceItem(itemId, (item) => ({
    ...item,
    screenSequenceDriveStrengthMode: 'override',
    screenSequenceDriveStrengthOverride: normalizeSequenceDriveStrengthOverride(value),
  }), isPublicLibraryMode, setPresetSequence);
}

export function updateDriveMultiplier(itemId: string, multiplier: number, isPublicLibraryMode: boolean, setPresetSequence: SetPresetSequence) {
  updateSequenceItem(itemId, (item) => ({ ...item, screenSequenceDriveMultiplier: normalizeSequenceDriveMultiplier(multiplier) }), isPublicLibraryMode, setPresetSequence);
}

export function updateTransitionEasing(itemId: string, transitionEasing: SequenceTransitionEasing, isPublicLibraryMode: boolean, setPresetSequence: SetPresetSequence) {
  updateSequenceItem(itemId, (item) => ({ ...item, transitionEasing }), isPublicLibraryMode, setPresetSequence);
}
