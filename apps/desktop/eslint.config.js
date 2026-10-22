import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import unusedImports from 'eslint-plugin-unused-imports';
import importPlugin from 'eslint-plugin-import';
import sonarjs from 'eslint-plugin-sonarjs';
import testConfig from './eslint.test.config.js';

export default [
  // Ignore patterns
  {
    ignores: [
      'dist/**',
      'out/**',
      '.vite/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      '**/*.gen.ts',
      'routeTree.gen.ts',
      '*.config.js', // Includes eslint.test.config.js
      '*.config.ts',
      'forge.config.ts',
      'forge.env.d.ts',
      'scripts/**',
      'local.db*',
      'drizzle/**',
      '.storybook/**',
      'debug-formats.js',
      'src/components/ui/**',
    ],
  },

  // Base JavaScript recommended rules
  js.configs.recommended,

  // TypeScript files configuration
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        // Node.js globals
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        exports: 'writable',
        global: 'readonly',
        module: 'readonly',
        process: 'readonly',
        require: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        // Electron globals
        Electron: 'readonly',
        // TypeScript/Node globals
        NodeJS: 'readonly',
        React: 'readonly',
        // Electron Forge / Vite plugin globals (defined by forge)
        MAIN_WINDOW_VITE_DEV_SERVER_URL: 'readonly',
        MAIN_WINDOW_VITE_NAME: 'readonly',
        MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: 'readonly',
        BLOCKING_NOTIFICATION_WINDOW_VITE_DEV_SERVER_URL: 'readonly',
        BLOCKING_NOTIFICATION_WINDOW_VITE_NAME: 'readonly',
        CLOCK_WINDOW_VITE_DEV_SERVER_URL: 'readonly',
        CLOCK_WINDOW_VITE_NAME: 'readonly',
        NOTIFICATION_WINDOW_VITE_DEV_SERVER_URL: 'readonly',
        NOTIFICATION_WINDOW_VITE_NAME: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'unused-imports': unusedImports,
      import: importPlugin,
      sonarjs,
    },
    settings: {
      react: {
        version: 'detect',
      },
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: './tsconfig.json',
        },
        node: {
          extensions: ['.js', '.jsx', '.ts', '.tsx'],
        },
      },
      'import/parsers': {
        '@typescript-eslint/parser': ['.ts', '.tsx'],
      },
    },
    rules: {
      // TypeScript recommended rules
      ...tseslint.configs.recommended.rules,

      // TypeScript specific rules - adapted to your codebase
      '@typescript-eslint/no-unused-vars': 'off', // Replaced by unused-imports/no-unused-vars

      /* 🚫 Ban any */
      '@typescript-eslint/no-explicit-any': 'error',

      /* 🚫 Ban unsafe type escape hatches instead of literal-narrowing helpers like `as const` */
      '@typescript-eslint/consistent-type-assertions': 'off',

      /* 🧠 Encourage using unknown and proper type guards */
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',

      /* 🎯 Require explicit return types for async functions (prevents implicit any returns) */
      '@typescript-eslint/explicit-function-return-type': [
        'error', // ⚠️ STRICT MODE - All tRPC endpoints MUST have explicit return types!
        {
          allowExpressions: true, // Allow: const fn = () => value (simple cases)
          allowTypedFunctionExpressions: true, // Allow typed React Query callbacks like useMutation<Type>
          allowHigherOrderFunctions: true, // Allow: const fn = () => () => ...
          allowDirectConstAssertionInArrowFunctions: true, // Allow: () => ({ x: 1 } as const)
          allowConciseArrowFunctionExpressionsStartingWithVoid: true, // Allow: () => void fn()
          allowedNames: [], // Could whitelist specific function names if needed
        },
      ],

      // Unused imports and exports detection
      'unused-imports/no-unused-imports': 'error', // Detect unused imports
      'unused-imports/no-unused-vars': [
        'error',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_|^e$|^err$|^error$',
        },
      ],
      // Import plugin rules
      'import/no-unresolved': 'off', // Let TypeScript handle this
      'import/extensions': [
        'error',
        'never',
        {
          json: 'always',
        },
      ],
      '@typescript-eslint/no-require-imports': 'off', // Allow require() for dynamic imports
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',

      // React recommended rules
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,

      // React specific rules
      'react/prop-types': 'off', // TypeScript handles this
      'react/react-in-jsx-scope': 'off', // Not needed in React 17+
      'react/jsx-uses-react': 'off',
      'react/jsx-no-target-blank': 'off',
      'react/no-unescaped-entities': 'off', // Allow quotes in JSX text

      // React Hooks rules
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'off', // Turn off
      'react-hooks/rules-of-hooks': 'error', // Keep this as error

      // React Refresh rules
      'react-refresh/only-export-components': 'off', // Too strict for your architecture

      // General rules - adapted to your patterns
      'no-console': 'error', // Ban console - use logger instead
      'no-empty': 'error', // Empty catch blocks are not allowed
      'no-useless-escape': 'off', // Turn off - regex escapes are fine
      'no-unreachable': 'error', // Turn off - might be intentional dead code for future use
      'no-redeclare': 'error', // Turn off - can be intentional for type/value
      'no-async-promise-executor': 'error', // Turn off
      'no-case-declarations': 'error', // Turn off
      'no-undef': 'error', // Keep as error - should be caught
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error', // Allow both styles
      eqeqeq: 'error',
      'no-debugger': 'error',
      '@typescript-eslint/triple-slash-reference': 'off', // Allow triple-slash for Electron Forge types

      // 🚫 Enforce Functional Programming - Ban Classes
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "TSAsExpression[typeAnnotation.type='TSAnyKeyword'], TSTypeAssertion[typeAnnotation.type='TSAnyKeyword']",
          message:
            "Do not use 'as any'. Prefer proper typing, narrowing, or validation.",
        },
        {
          selector:
            "TSAsExpression[typeAnnotation.type='TSUnknownKeyword'], TSTypeAssertion[typeAnnotation.type='TSUnknownKeyword']",
          message:
            "Do not cast to unknown as a type escape hatch. Prefer runtime validation or a dedicated type guard.",
        },
        {
          selector: 'ClassDeclaration',
          message: 'Do not use classes — prefer functions or factory patterns instead.',
        },
        {
          selector: 'ClassExpression',
          message: 'Avoid class expressions — use closures or composition instead.',
        },
      ],

      // SonarJS - Cognitive Complexity (better than cyclomatic complexity)
      // Measures how difficult code is to understand (not just # of branches)
      'sonarjs/cognitive-complexity': ['error', 50], // Warn if cognitive complexity > 15

      // SonarJS - Code Smells & Duplication
      'sonarjs/no-duplicate-string': ['error', { threshold: 6 }], // Detect string duplication
      'sonarjs/no-identical-functions': 'error', // Detect duplicate functions
      'sonarjs/no-duplicated-branches': 'error', // if/else with same code
      'sonarjs/no-identical-conditions': 'error', // Same condition multiple times

      // SonarJS - Code Quality
      'sonarjs/no-collection-size-mischeck': 'error', // Wrong size checks
      'sonarjs/no-inverted-boolean-check': 'error', // !(a == b) vs a != b
      'sonarjs/no-redundant-boolean': 'error', // x === true vs x
      'sonarjs/no-small-switch': 'error', // Switch with only 2 cases
      'sonarjs/no-unused-collection': 'error', // Collections that are never read
      'sonarjs/prefer-immediate-return': 'off', // return x vs const y = x; return y
      'sonarjs/prefer-object-literal': 'error', // Object literal vs empty + assignments
      'sonarjs/prefer-single-boolean-return': 'error', // if (x) return true; else return false;

      // Basic duplication detection
      'no-duplicate-case': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-else-if': 'error',
    },
  },

  // Test files configuration
  testConfig,
  // Preload scripts - bridge between main and renderer
  {
    files: ['**/preload/**/*.ts', '**/preload.ts'],
    rules: {
      'no-console': 'error', // Console is useful for debugging preload
    },
  },

  // Main process files - Node.js environment
  {
    files: ['src/main/**/*.ts', 'src/main.ts', 'src/api/**/*.ts'],
    rules: {
      'no-console': 'error', // Server-side logging is fine
    },
  },

  // Renderer process files - Browser environment
  {
    files: ['src/renderer/**/*.tsx', 'src/components/**/*.tsx', 'src/pages/**/*.tsx'],
    rules: {
      // Renderer-specific rules can go here
    },
  },
  // Components stay under 300 lines of code.
  {
    files: ['**/*.tsx'],
    rules: {
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
    },
  },
  // Files that were already over the limit. Shrink this list; never add to it.
  {
    files: [
      'src/components/AISummarySidebar.tsx',
      'src/components/AnnotationsSidebar.tsx',
      'src/components/QuickAddDialog.tsx',
      'src/components/QuizSidebar.tsx',
      'src/components/data-table/data-table-advanced-filter.tsx',
      'src/pages/app-debug-logs/index.tsx',
      'src/pages/dashboard/DashboardPage.tsx',
      'src/pages/my-playlists/components/FavoritesSection.tsx',
      'src/pages/my-words/components/FlashcardsTab.tsx',
      'src/pages/player/PlayerPage.tsx',
      'src/pages/player/components/TranscriptPanel.tsx',
      'src/pages/player/components/VideoPlayer.tsx',
      'src/pages/playlist/PlaylistPage.tsx',
      'src/pages/settings-page/components/LogViewerModal.tsx',
      'src/pages/settings-page/components/tabs/SystemTab.tsx',
      'src/pages/storage/StorageManagerPage.tsx',
      'src/pages/storage/storage-columns.tsx',
      'src/renderer/notification/NotificationApp.tsx',
    ],
    rules: { 'max-lines': 'off' },
  },
];
