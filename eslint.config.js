import { basePreset } from './packages/config/eslint-preset.js';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/generated/**',
      'pnpm-lock.yaml',
      // Arquivos de config não entram no programa TS de cada workspace,
      // então regras type-aware (consistent-type-imports etc.) quebram neles.
      '**/eslint.config.*',
      '**/next.config.*',
      '**/postcss.config.*',
      '**/tailwind.config.*',
    ],
  },
  ...basePreset,
];
