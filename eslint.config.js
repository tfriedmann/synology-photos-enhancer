import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Flat config — the only format ESLint 10 supports.
 *
 * Uses `defineConfig` from `eslint/config` rather than `tseslint.config()`,
 * which is deprecated as of typescript-eslint 8.
 *
 * The rule that matters most is the `core → plugins` import ban further down:
 * it is the one architectural invariant of this project, and a rule you cannot
 * break by accident beats a convention written in a README.
 */
export default defineConfig([
  globalIgnores(['dist/**', 'coverage/**', 'node_modules/**', '.vite/**']),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /* Non-negotiable per the project brief. `unknown` plus a guard is always
       * available, and every `any` here would sit on a boundary we do not
       * control (Synology payloads) — exactly where it is most harmful. */
      '@typescript-eslint/no-explicit-any': 'error',

      /* `_`-prefixed names are intentional discards. */
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'error',

      /* We run inside a page we do not own; a silently swallowed rejection
       * means a broken plugin fails invisibly. */
      '@typescript-eslint/no-floating-promises': 'error',

      eqeqeq: ['error', 'always', { null: 'ignore' }],

      /* Everything logs through `core/logger.ts` — the one file exempted below —
       * so output stays namespaced and the user can silence us. */
      'no-console': 'error',

      /* `ignoreReadBeforeAssign` allows the deliberate pattern of declaring a
       * handle that a closure defined just above will call later. */
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
      'no-param-reassign': 'error',
      'object-shorthand': 'error',
    },
  },

  /* ------------------------------------------------------------------ *
   * The architectural invariant: the core must never know a plugin exists.
   *
   * Wiring happens in exactly one place — `src/entries/content-isolated.ts`
   * imports `src/plugins/index.ts` and hands the list to `bootstrap()`. That
   * keeps the dependency arrow pointing one way forever: plugins depend on the
   * core, never the reverse.
   * ------------------------------------------------------------------ */
  {
    files: [
      'src/core/**/*.ts',
      'src/bridge/**/*.ts',
      'src/api/**/*.ts',
      'src/ui/**/*.ts',
      'src/utils/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/plugins', '@/plugins/*', '**/plugins', '**/plugins/*'],
              message:
                'The core must not depend on any plugin. Plugins are wired in src/entries/content-isolated.ts and reach the core through PluginContext. See docs/ARCHITECTURE.md.',
            },
          ],
        },
      ],
    },
  },

  /* Plugins talk to the core through PluginContext only. Reaching into another
   * plugin would recreate the tangle the EventBus exists to prevent. */
  {
    files: ['src/plugins/*/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*/index', '../*/*'],
              message:
                'Plugins must not import each other. Communicate through the EventBus instead. See docs/ARCHITECTURE.md.',
            },
          ],
        },
      ],
    },
  },

  /* The one place allowed to touch the console. */
  {
    files: ['src/core/logger.ts'],
    rules: { 'no-console': 'off' },
  },

  /* Monkey-patching is this module's entire job, and capturing an unbound
   * prototype method is how it is done — `unbound-method` is warning about the
   * intended behaviour. Every captured original is invoked with an explicit
   * `.call(this, ...)` or `.apply(this, ...)`, which is what the rule wants to
   * see and cannot detect here. */
  {
    files: ['src/bridge/mainWorld.ts', 'tests/bridge/mainWorld.test.ts'],
    rules: { '@typescript-eslint/unbound-method': 'off' },
  },

  /* Build and test tooling runs in Node and never ships to the browser. */
  {
    files: ['**/*.config.ts', '**/*.config.js', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'no-console': 'off',
    },
  },

  /* Standalone Node scripts: not part of the extension build, deliberately not
   * in tsconfig, so type-aware rules have no program to work from. Linted for
   * syntax and obvious mistakes only. */
  {
    files: ['scripts/**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      parserOptions: { projectService: false },
      /* Declared explicitly rather than pulling in the `globals` package for
       * three names. */
      globals: { Buffer: 'readonly', process: 'readonly', console: 'readonly' },
    },
    rules: { 'no-console': 'off' },
  },

  /* Must stay last: switches off every rule that would fight Prettier. */
  prettier,
]);
