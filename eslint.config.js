import js from '@eslint/js';
import ts from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import globals from 'globals';

/** @type {import('eslint').Linter.Config[]} */
export default [
  js.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { '@typescript-eslint': ts },
    rules: {
      ...ts.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: { parser: tsParser },
      globals: { ...globals.browser },
    },
    plugins: { svelte },
    rules: {
      ...svelte.configs.recommended.rules,
      // Svelte 5 runes pattern — initialising state from page data is intentional
      'svelte/valid-compile': ['warn', { ignoreWarnings: true }],
      // a11y covered by svelte-check, not needed here
      'svelte/no-unused-svelte-ignore': 'warn',
    },
  },
  {
    files: ['**/*.d.ts'],
    rules: { '@typescript-eslint/no-empty-object-type': 'off' },
  },
  {
    ignores: ['.svelte-kit/**', 'build/**', 'node_modules/**'],
  },
];
