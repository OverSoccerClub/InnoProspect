// Config ESLint compartilhada (flat config, ESLint 9+).
// Consumida por eslint.config.js na raiz e por apps/web/eslint.config.mjs.
// Resolve as dependências (@eslint/js, typescript-eslint, eslint-config-prettier)
// a partir das devDependencies declaradas no package.json da RAIZ do monorepo.
import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/** @type {import('eslint').Linter.Config[]} */
export const basePreset = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];

export default basePreset;
