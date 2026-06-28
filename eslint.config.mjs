import js from '@eslint/js';
import globals from 'globals';

// Lint scope: the Node ESM (.mjs) engine, server, libs, and tests. This is
// where the audit found drift (duplicated logic, dead code). The React/JSX
// app under dashboard-web/src is intentionally NOT linted yet: it loads React
// from a CDN and its per-file IIFE bundles share a global scope, so no-undef
// would fire across the board. Linting it cleanly is a separate follow-up.
export default [
  {
    ignores: [
      'node_modules/**',
      '**/dist/**',
      'dashboard-web/src/**',
      'backups/**',
      'fonts/**',
      'output/**',
      'data/**',
      'reports/**',
      'jds/**',
      'batch/**',
      'examples/**',
      'interview-prep/**',
    ],
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      // The scripts use intentional unused args and catch bindings; keep this
      // a warning and let underscore-prefixed names opt out entirely.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // Several scripts deliberately swallow errors (missing .env, optional
      // files); empty catch blocks are allowed, other empty blocks are not.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Regex-style rules flag intentional patterns here (escaped hyphens in
      // char classes, emoji status markers, deliberate control-char stripping).
      // Auto-fixing regexes risks behavior changes, so surface as warnings
      // rather than blocking, and leave control-char regexes alone.
      'no-useless-escape': 'warn',
      'no-misleading-character-class': 'warn',
      'no-control-regex': 'off',
      'no-useless-assignment': 'warn',
    },
  },
  {
    // Playwright scripts pass callbacks to page.evaluate() that run in the
    // browser, so document/window/navigator are legitimately defined there.
    files: [
      'check-liveness.mjs',
      'gate-pipeline.mjs',
      'generate-pdf.mjs',
      'docs/onboarding/**/*.mjs',
    ],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
