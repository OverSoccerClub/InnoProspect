---
name: project-innoprospect
description: Contexto do InnoProspect e o que o Vega entregou na Fase 1 (worker + API + auth real)
metadata:
  type: project
---

InnoProspect é um monorepo pnpm workspaces + Turborepo (`C:\Projetos\Web\InnoProspect`), Next.js 15
App Router + Prisma/Postgres + worker Node separado (scraping do Google Maps + disparo WhatsApp via
Evolution API, fases futuras). Arquitetura fechada em `ARQUITETURA.md` — §2 estrutura de pastas
(CONTRATO), §4 contratos de API (CONTRATO), §5.3/§5.6 fila/retry/backoff (CONTRATO). Fases em §8.

**Meu escopo entregue (itens 1.4, 1.5 e auth real da Fase 1, 2026-07-31):**
- `apps/worker`: fila `scrape:search` real (BullMQ) — `queues.ts`, `scheduler.ts`,
  `jobs/scrape-search.job.ts`, `observability/logger.ts` (pino).
- `apps/web/src/app/api/v1/**`: todas as rotas da Fase 1 (locations, searches, leads, health).
- `apps/web/src/lib/api-handler.ts`, `lib/auth.ts` + `lib/auth.config.ts`, `middleware.ts`: auth real
  Auth.js v5 + wrapper único de rota.

**Antes de mim:** `packages/db` (schema+seed, Cronos), `packages/contracts` (Zod, Nova/Cronos),
`packages/core` (dedupe/phone/status/uf, já com `MACHINE_UPDATABLE_FIELDS` pronto), `packages/scraper`
(engine Playwright completo, `runSearch`/`SearchEngine`), `apps/web` telas (Lyra, rodando em mock).

**Como aplicar:** antes de tocar em `apps/web/src/app/api/**`, `lib/api-handler.ts`, `lib/auth*.ts`,
`middleware.ts` ou `apps/worker/**`, ler este arquivo + [[convention-api-routes-fase1]] +
[[bug-nextauth-edge-prisma-split]] + [[bug-nextjs-workspace-ts-source-imports]] antes de reabrir
decisão já tomada. Nunca criar/editar nada em `app/(dashboard)/**`, `app/(auth)/**`, `components/**`
nem `mocks/**` (território da Lyra) nem em `packages/db/prisma/schema.prisma` (território do Cronos) —
se precisar mudar algo lá, relatar no handoff em vez de editar.

Ver também [[convention-api-routes-fase1]] (padrões de rota/serviço estabelecidos) e
[[bug-nextauth-edge-prisma-split]]/[[bug-nextjs-workspace-ts-source-imports]] (bugs de build
corrigidos com causa raiz).
