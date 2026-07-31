---
name: feedback-ts-eslint-monorepo-gotchas
description: Armadilhas reais encontradas ao montar tsconfig/eslint compartilhados neste monorepo pnpm+Turborepo
metadata:
  type: feedback
---

Duas armadilhas técnicas que custaram ciclos de debug ao montar o esqueleto (2026-07-30) — registrar
para não repetir em outro monorepo do mesmo padrão.

## 1. `rootDir`/`outDir` num `tsconfig.json` base compartilhado (`extends`) resolvem relativo ao ARQUIVO
BASE, não a quem estende
Coloquei `"rootDir": "src"` em `packages/config/tsconfig.json` (base compartilhada) esperando que cada
pacote que desse `extends` nela resolvesse `rootDir` relativo à SUA própria pasta. TypeScript resolve
esses caminhos relativos ao arquivo onde a opção foi DEFINIDA, não ao tsconfig que herda — resultado:
`packages/core` tentava usar `packages/config/src` como rootDir e quebrava com `TS6059`.
**Como aplicar:** nunca colocar `rootDir`/`outDir`/`declarationDir` num tsconfig base que será
compartilhado por múltiplos pacotes em pastas diferentes. Se precisar, definir em cada tsconfig
individual (não no base) ou omitir totalmente quando `noEmit: true` (não emitindo, essas opções são
irrelevantes de qualquer forma).

## 2. ESLint 9 flat config + `typescript-eslint` regras type-aware quebram em arquivos `*.config.*`
Regras como `@typescript-eslint/consistent-type-imports` (mesmo sem "typed linting" explícito) exigem
que o arquivo lintado esteja dentro do `tsconfig.json` do projeto. Arquivos como `eslint.config.mjs`,
`next.config.ts`, `postcss.config.mjs`, `tailwind.config.ts` normalmente NÃO estão no `include` do
`tsconfig.json` do app — lintá-los produz `Error: ... requires type information, but don't have
parserOptions set...` e derruba o `pnpm lint` inteiro.
**Como aplicar:** no `ignores` do eslint.config raiz, excluir globs de arquivos de config
(`**/eslint.config.*`, `**/next.config.*`, `**/postcss.config.*`, `**/tailwind.config.*`) antes mesmo
de tentar debugar regra por regra — é sempre o mesmo sintoma.

Ver [[infra_monorepo_scaffold]] para o estado atual do lint/typecheck no InnoProspect.
