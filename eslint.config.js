// ESLint flat config (introduced 2026-11-07 as part of code hygiene).
// Warning burn-down completed 2026-11-08: the report is now zero
// errors / zero warnings. Rules that reached zero through real fixes
// are ratcheted to errors so regressions fail the lint run; the three
// rules turned off below carry their rationale inline. Deliberate
// exceptions at individual call sites use eslint-disable-next-line
// comments that state their reason.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Ratcheted to errors after the 2026-11-08 burn-down reached
      // zero for each (unused vars are also enforced by tsc
      // noUnusedLocals/noUnusedParameters). Deliberate exceptions
      // exist only as reasoned eslint-disable-next-line comments:
      // the fine-grained dependency lists of the scene systems and
      // a handful of intentional state resets on mode changes.
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/use-memo': 'error',
      'react-hooks/set-state-in-effect': 'error',
      'no-sparse-arrays': 'error',
      'no-useless-assignment': 'error',
      'preserve-caught-error': 'error',
      // Off: this project does not use React Compiler, and these two
      // compiler-era rules encode its assumptions. They flag the
      // react-three-fiber imperative idiom wholesale (~40 sites):
      // mutating THREE objects/uniforms held in refs, and reading
      // mutable runtime refs while building a frame. rules-of-hooks
      // and exhaustive-deps stay errors as the substantive checks.
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      // Off: barrel modules (export *) and helpers colocated with
      // components are this project's deliberate file organization.
      // The rule only affects Fast Refresh granularity in dev; it
      // has no bearing on the production build.
      'react-refresh/only-export-components': 'off',
      // Empty catch blocks are a deliberate pattern in the audio
      // teardown code (stopping oscillators that may never have
      // started); other empty blocks stay errors.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
);
