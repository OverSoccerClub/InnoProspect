---
name: feedback-pnpm-docker-monorepo-gotchas
description: Bug real encontrado em Dockerfile de monorepo pnpm — node_modules não consolida na raiz por padrão, quebra em runtime
metadata:
  type: feedback
---

## pnpm NÃO hoista dependências de workspace pra raiz por padrão — quebra o padrão "COPY node_modules" em Docker

Ao auditar `apps/worker/Dockerfile` (item 5.5, pedido do Órion) encontrei um bug real, não só uma
oportunidade de otimização: o Dockerfile original (Vega) — e minha primeira versão do
`apps/web/Dockerfile`, cometi o mesmo erro antes de perceber — copiava só `/app/node_modules` (raiz) pra
imagem final, seguindo o padrão do projeto de referência (Painel de Missões / Pontua.me).

Esse padrão funciona lá porque aqueles projetos usam **npm de pacote único** (node_modules plano por
natureza). Em **pnpm workspace**, cada pacote (`apps/worker`, `packages/core`...) recebe seu **próprio**
`node_modules` com symlinks só das dependências QUE ELE declara — `bullmq`/`ioredis`/`pino`
(dependencies de `apps/worker`) NÃO aparecem no `node_modules` da raiz sem hoisting. Resultado: o
`dist/index.js` (bundle tsup, com essas deps `external`) quebraria em runtime com `Cannot find module
'bullmq'` — só apareceria no primeiro `docker run` real, não no build.

**Como aplicar:** em qualquer Dockerfile de monorepo pnpm que copie `node_modules` inteiro pra imagem
final (em vez de manualmente enumerar `node_modules` de cada pacote, frágil), rodar o `pnpm install` com
`--shamefully-hoist` (achata tudo num node_modules só na raiz). Custo aceito: perde parte do isolamento
estrito do pnpm (risco de "dependência fantasma"), tolerável numa imagem de runtime que não roda mais
`pnpm install` depois. Apliquei em `apps/web/Dockerfile` e `apps/worker/Dockerfile` (2026-07-31).

**Não validado com `docker build` de verdade** (sem Docker nesta máquina) — é dedução lógica sobre como o
pnpm resolve workspaces, não teste real. Conferir no primeiro build no EasyPanel.

## `output: 'standalone'` + monorepo pnpm — confirmado localmente (parcialmente) via `next build`

`apps/web/next.config.ts` não tinha `output: 'standalone'` nem `outputFileTracingRoot` até esta entrega
(item 5.5) — adicionei os dois. Rodei `pnpm --filter web run build` nesta máquina (sem Docker, mas com
Node/pnpm disponíveis) e CONFIRMEI que gera `.next/standalone/apps/web/...` (estrutura aninhada, não
`.next/standalone/` plano) e que `.next/standalone/packages/{contracts,core,db}` também saem traçados
automaticamente. O build falha no fim (`EPERM` ao criar symlink) só por limitação do Windows (symlink
sem modo desenvolvedor/admin) — não roda em container Linux. Ou seja: a estrutura de pastas que o
`apps/web/Dockerfile` assume (`CMD ["node", "apps/web/server.js"]`, COPY aninhado) está confirmada; o
resto do pipeline (imagem final rodando de verdade) segue não validado.

Ver [[infra_deploy_easypanel]] para o estado completo da entrega de deploy (Fase 5.5).
