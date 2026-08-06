/**
 * Mutable state shared between modules.
 *
 * These live on one object rather than as separate exported bindings so that a
 * module which reassigns `state.currentFile` is seen by every other module
 * immediately. Anything only one module cares about should stay a local in
 * that module instead of being added here.
 */

export const state = {
  editor: null,
  monacoApi: null,
  monacoReady: false,
  monacoReadyCallbacks: [],
  currentFile: null,
  currentRepo: null,
  currentFolderPath: null,
  lastProblems: [],
  updateInfo: null,
  projectLabels: [],
  projectCitations: [],
  envDecorations: null,
  outlineTimer: null,
  diffEditor: null,
  versionsLoaded: false,
  openCommitHash: null,
  diffSource: null,
  compareSelection: [],
  compareOrderSwapped: false,
  spellAvailable: null,
  spellUserWords: [],
  spellTimer: null,
  spellRequestId: 0,
  spellSuggestions: new Map(),
};
