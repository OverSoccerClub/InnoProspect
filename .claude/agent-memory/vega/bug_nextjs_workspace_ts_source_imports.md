---
name: bug-nextjs-workspace-ts-source-imports
description: next build (webpack) não resolve pacotes internos que exportam .ts fonte com imports "./arquivo.js" — precisa de transpilePackages + extensionAlias
metadata:
  type: feedback
---

**Sintoma:** `pnpm --filter web run build` falhava com `Module not found: Can't resolve './common.js'`
(e outros) apontando pra `packages/contracts/src/index.ts`, mesmo com `tsc --noEmit` limpo. Só
aparecia em `next build` (webpack), não em `next dev`/`tsc`.

**Causa raiz:** os pacotes internos (`@inno/contracts`, `@inno/core`, `@inno/db`, etc.) têm
`"exports": { ".": "./src/index.ts" }` — nenhum passo de build, consumidos como fonte TS direto — e
o código fonte deles importa entre si com extensão `.js` explícita apontando pra arquivo `.ts`
(convenção ESM/NodeNext: `moduleResolution: "Bundler"` no `tsconfig.base.json`, ver
`packages/*/src/**/*.ts`, ex. `export * from './common.js'` onde só existe `common.ts`). O `tsc`
entende isso nativamente (é o propósito do `moduleResolution: Bundler`), mas o **webpack do Next não
resolve `.js` → `.ts` por padrão**, e por padrão também não transpila código de dentro de
`node_modules` (mesmo sendo um symlink do pnpm pro `packages/*/src`).

**Correção**, em `apps/web/next.config.ts`:
```ts
transpilePackages: ['@inno/contracts', '@inno/core', '@inno/db'], // NUNCA @inno/scraper (ver convention-api-routes-fase1, item 4)
webpack: (config) => {
  config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
  return config;
},
```
As duas partes são necessárias: `transpilePackages` manda o Next rodar o pacote pelo compilador dele
(SWC) em vez de tratar como `node_modules` opaco; `extensionAlias` ensina o webpack a tentar `.ts`
quando o import pede `.js` (senão falha mesmo transpilando).

**Como aplicar:** qualquer novo pacote interno consumido por `apps/web` (ou por qualquer outro app
Next deste monorepo no futuro) que siga o mesmo padrão "exports aponta pro `.ts` fonte, imports
internos com `.js`" precisa entrar em `transpilePackages`. Rodar `pnpm build` (não só `dev`/
`typecheck`) sempre que adicionar/trocar um import de `packages/*` numa rota nova — este bug (como o
de ícone RSC↔Client da Lyra, ver memória dela `bug-rsc-client-icon-props`) só aparece no build de
produção.

Efeito colateral notado e corrigido junto: `bullmq` tenta resolver opcionalmente
`@valkey/valkey-glide` (backend alternativo não instalado, usamos `ioredis`/Redis padrão) — gera
warning inofensivo no build; silenciado com
`config.resolve.alias['@valkey/valkey-glide'] = false` no mesmo `webpack()` acima.

Relacionado: [[project-innoprospect]], [[convention-api-routes-fase1]],
[[bug-nextauth-edge-prisma-split]].
