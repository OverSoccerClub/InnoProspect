import { FlatCompat } from '@eslint/eslintrc';
import baseConfig from '../../eslint.config.js';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  // `next-env.d.ts` é GERADO pelo Next a cada build e não deve ser editado
  // (o próprio arquivo diz isso no cabeçalho). A partir da 15.5 ele passou a
  // trazer um `/// <reference>` para `.next/types/routes.d.ts`, que a regra
  // `@typescript-eslint/triple-slash-reference` reprova. Lintar arquivo que
  // não podemos corrigir só produz erro impossível de resolver.
  { ignores: ['next-env.d.ts'] },
  ...baseConfig,
  ...compat.extends('next/core-web-vitals'),
];
