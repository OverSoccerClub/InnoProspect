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

**Meu escopo entregue (item 3.2 da Fase 3, 2026-08-01):** `packages/messaging` completo — cliente
Evolution API + parser de webhook. Detalhe completo em [[convention-messaging-evolution-api]]. Ainda
falta a rota real do webhook em `apps/web` e o dispatch worker (rodadas futuras, dependem do Cronos
terminar `Message`/`OptOut`/`WhatsAppInstance` no schema).

**Meu escopo entregue (Onda 1 pós-revisão, 2026-08-03 — REVISAO-ARQUITETURA.md/REVISAO-QA.md):**
"o sistema consegue dizer que está quebrado". Liguei `evaluateSanity` (A1-A4, estava escrita e testada
com zero chamadores) em `apps/worker/src/observability/sanity.ts`, chamado ao fim de cada `SearchTask`
bem-sucedida (`jobs/scrape-search.job.ts`) — grava/resolve `ScraperHealthEvent` e pausa a fila quando
A1/A2 disparam. Troquei o `setTimeout` em memória da pausa de fila por estado persistido no Redis
(`lib/queue-state.ts`, escritor no worker/leitor no web, ver [[convention-worker-redis-state]]) — não
some mais num restart. Adicionei heartbeat do worker (mesma via Redis), `requeue-orphans` no boot
(`jobs/requeue-orphans.ts`, risco R10), `GET /api/v1/health` de verdade (banco/Redis/worker/fila
separados, só o banco decide 200/503) e os endpoints novos `GET /api/v1/scraper/queue` +
`POST /api/v1/scraper/queue/resume` (sem contrato prévio da Nova — documentado no handoff). Também
adicionei rate limit + limite de corpo em `apiRoute` (`rateLimit`/`maxBodyBytes`, `lib/rate-limit.ts`),
aplicado nas duas rotas públicas (webhook Evolution, opt-out público) por achado do Órion. Gotcha de
typecheck descoberto nessa rodada: [[bug-bullmq-client-not-ioredis]].
**Não pude validar:** nada disto rodou contra Postgres/Redis reais (indisponíveis nesta máquina) —
`pnpm typecheck`/`lint`/`test` (164+48 testes existentes) e `next build`/`tsup build` passaram limpos,
mas o comportamento sob concorrência real (claim atômico, sweep de pausa, heartbeat expirando) só se
prova em ambiente com Redis de verdade.

**Meu escopo entregue (Onda 2, 2026-09-22):** alerta webhook do worker (`apps/worker/src/observability/
alerts.ts`, ver [[convention-worker-alerts]]) plugado nas 3 transições de estado da fila (incidente de
sanidade aberto, pausa por erro de coleta, retomada automática) — nunca lança, timeout curto, só
dispara na transição. E rate limit de tentativas de login por e-mail/IP (`lib/auth.ts`, ver
[[convention-login-rate-limit]]) — conta só FALHA (peek antes, `checkRateLimit` só em falha, reset só
do e-mail no sucesso; a primeira versão contava toda tentativa inclusive sucesso, corrigido ainda nesta
rodada antes de fechar — ver a causa raiz lá). Bug de teste novo: [[bug-nextauth-vitest-server-import]].
**Não pude validar (mesma limitação de sempre):** POST real contra um endpoint de webhook (Slack/Google
Chat) não foi testado fora de mock — `fetch` real não disponível/necessário nesta rodada; a lógica de
timeout/erro está testada com `fetch` mockado, mas o formato exato que Slack/Google Chat aceitam não foi
validado contra o serviço real.

**Antes de mim:** `packages/db` (schema+seed, Cronos), `packages/contracts` (Zod, Nova/Cronos),
`packages/core` (dedupe/phone/status/uf, já com `MACHINE_UPDATABLE_FIELDS` pronto), `packages/scraper`
(engine Playwright completo, `runSearch`/`SearchEngine`), `apps/web` telas (Lyra, rodando em mock).

**Meu escopo entregue (§4.9 envio unitário + mensagens reais na ficha, 2026-09-22):** primeiro (e
único) call site de produção de `EvolutionClient.sendText` — `apps/web/src/lib/services/messages.ts`
(`sendLeadMessage`) + `evaluateSendGuard`/`send-window.ts`/`optout-notice.ts` em `packages/core`.
`reason` opcional adicionado ao envelope de erro (`packages/contracts/src/common.ts`, aprovado pelo
Atlas). `getLeadDetail` (`lib/services/leads.ts`) agora devolve `messages`/`lastContactedAt` reais.
Detalhe completo, gaps de contrato preenchidos e por quê, em [[convention-envio-unitario-send-guard]].

**Meu escopo entregue (export CSV + ações em massa, 2026-09-22, decisão do dono: uso próprio):**
`GET /api/v1/leads/export` (streaming, CSV separado por `;`, coluna `descadastrado`) e
`POST /api/v1/leads/bulk` (`set_status`/`add_tags`/`remove_tags`, `expectedCount` obrigatório com
`filter`, resposta por item). Revisei o contrato-rascunho da Fase 1 (nunca consumido) em vez de
versionar por cima. Detalhe completo, motivos e o que não validei em
[[convention-leads-export-bulk]].

**Como aplicar:** antes de tocar em `apps/web/src/app/api/**`, `lib/api-handler.ts`, `lib/auth*.ts`,
`middleware.ts` ou `apps/worker/**`, ler este arquivo + [[convention-api-routes-fase1]] +
[[bug-nextauth-edge-prisma-split]] + [[bug-nextjs-workspace-ts-source-imports]] antes de reabrir
decisão já tomada. Nunca criar/editar nada em `app/(dashboard)/**`, `app/(auth)/**`, `components/**`
nem `mocks/**` (território da Lyra) nem em `packages/db/prisma/schema.prisma` (território do Cronos) —
se precisar mudar algo lá, relatar no handoff em vez de editar.

Ver também [[convention-api-routes-fase1]] (padrões de rota/serviço estabelecidos),
[[convention-messaging-evolution-api]] (cliente Evolution API + webhook parser) e
[[bug-nextauth-edge-prisma-split]]/[[bug-nextjs-workspace-ts-source-imports]]/
[[bug-vitest-fake-timers-retry-backoff]] (bugs corrigidos com causa raiz).
