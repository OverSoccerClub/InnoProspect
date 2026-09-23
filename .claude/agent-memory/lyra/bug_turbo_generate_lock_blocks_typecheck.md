---
name: bug-turbo-generate-lock-blocks-typecheck
description: pnpm typecheck (via turbo) falha com EPERM no @inno/db#generate quando o next dev compartilhado está de pé — como confirmar que é ambiente, não código, e rodar o gate mesmo assim
metadata:
  type: project
---

`pnpm typecheck`/`lint`/`test` na raiz rodam via `turbo run <task>`, e
`typecheck`/`build` em `turbo.json` têm `dependsOn: ["^generate", "generate"]`
— ou seja, todo `pnpm typecheck` tenta regerar o client do Prisma primeiro.
Com o `next dev` compartilhado de pé (ver
[[bug-shared-next-dev-cache-conflict]]), o processo do Next mantém o
`query_engine-windows.dll.node` de `packages/db/src/generated/client/`
carregado — o `prisma generate` escreve os `.d.ts`/`.js` novos com sucesso,
mas falha no último passo (renomear o `.dll.node.tmpNNNN` por cima do
arquivo travado) com `EPERM: operation not permitted, rename ...`. O turbo
trata isso como falha do task `@inno/db#generate` e ABORTA a pipeline inteira
— `web#typecheck` nunca chega a rodar, mesmo que o código esteja correto.

**Como confirmar que é ambiente, não um erro real:** `grep -n
"EvolutionServer" packages/db/src/generated/client/index.d.ts` (ou o tipo
mais recente que deveria existir) — se o tipo já está lá com timestamp
recente, o client gerado já reflete o schema atual; só o binário nativo (que
não muda entre gerações do MESMO client de query engine) não conseguiu ser
substituído.

**Como aplicar:** rodar cada pacote INDIVIDUALMENTE com `pnpm --filter
<pkg> run typecheck`/`run lint`/`run test` (sem passar por `turbo run`) —
isso executa só o script `tsc --noEmit`/`eslint`/`vitest run` do
`package.json` daquele pacote, sem a etapa `generate` do turbo. Fazer isso
para TODOS os pacotes do monorepo (`@inno/contracts`, `@inno/core`,
`@inno/db`, `@inno/messaging`, `@inno/scraper`, `web`, `worker`) dá o mesmo
resultado do gate completo, sem tocar no `.next`/binário travado. NUNCA
matar o processo do `next dev` compartilhado só para destravar o rename —
é exatamente o incidente que [[bug-shared-next-dev-cache-conflict]] já
documentou como custoso.
