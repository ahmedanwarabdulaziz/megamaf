import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // These are generated or local diagnostic scripts, not application code.
    'public/**',
    'scripts/**',
    'check_*.js',
    'test_*.js',
    'test-*.js',
    'run_*.js',
    'run-migration-*.js',
    'sync_ledger.js',
    'create_test.js',
    'fix_*.js',
  ]),
  {
    // Keep these existing findings visible without making the live build
    // fail on intentional form-reset effects and legacy DB result shapes.
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react/no-unescaped-entities': 'warn',
    },
  },
]);

export default eslintConfig;
