---
name: convention-worker-redis-state
description: Estado operacional (pausa da fila, heartbeat) vive em Redis via Queue#client, chaves duplicadas entre worker/web
metadata:
  type: project
---

Entregue na Onda 1 (2026-08-03, REVISAO-ARQUITETURA.md/REVISAO-QA.md) para consertar dois defeitos:
"health check que mente" (§4.2 N3) e pausa de fila com `setTimeout` em memória (sumia num restart do
worker, §1.3/§4.1 R10).

**Padrão:** estado operacional que precisa sobreviver a um restart do processo (mas NÃO é domínio —
não pertence a uma tabela do Cronos) vai para o Redis que o BullMQ já usa, via `Queue#client` (ver
[[bug-bullmq-client-not-ioredis]] pela assinatura certa) — não instanciar um `ioredis` próprio, não
pedir ao Cronos uma tabela nova para isto.

**Chaves (contrato de protocolo, duplicadas de propósito):**
- `inno:scrape:queue:pause-meta` — JSON `{code, message, severity, source: 'scrape_error'|'sanity',
  pausedAt, resumeAt: string|null}`. `resumeAt: null` = pausa indefinida, só some com
  `POST /api/v1/scraper/queue/resume` manual (`acknowledge: true`). `resumeAt` setado = um sweep
  periódico no worker (`scheduler.ts`, a cada `PAUSE_SWEEP_INTERVAL_MS`) retoma sozinho quando vence —
  isso substitui o `setTimeout` antigo, e funciona mesmo se o worker reiniciar no meio (relê do Redis a
  cada tick, não depende de nenhum timer em memória).
- `inno:worker:heartbeat` — timestamp ISO com TTL (`HEARTBEAT_TTL_SECONDS = 45`, gravado a cada
  `HEARTBEAT_INTERVAL_MS = 15s`). Ausência da chave (TTL expirou) já É o sinal "worker morto" — não
  precisa de um "unregister" explícito no shutdown.

Escritor: `apps/worker/src/lib/queue-state.ts` (`persistQueuePause`/`recordHeartbeat`, chamados de
`jobs/scrape-search.job.ts` e `observability/sanity.ts`/`scheduler.ts`). Leitor (fail-soft, nunca lança
— ver [[project-innoprospect]] sobre `/health` não poder travar por causa do Redis):
`apps/web/src/lib/queue-state.ts`, consumido por `lib/services/scraper-health.ts`
(`GET /api/v1/health`, `GET /api/v1/scraper/queue`, `POST /api/v1/scraper/queue/resume`).

**`ScraperHealthEvent.type` é vocabulário FECHADO nas 4 assertions A1-A4** (`zero_streak`,
`fill_rate_name`, `fill_rate_phone`, `data_shape` — ver comentário no `schema.prisma`, "NÃO é
CONTRATO de API"). Pausas causadas por `SCRAPE_ERROR_POLICY` (RATE_LIMITED/CAPTCHA_DETECTED/
LAYOUT_CHANGED, `packages/scraper/errors.ts`) NÃO têm tabela — por isso o motivo/horário delas vive
SÓ na `pause-meta` do Redis acima, nunca em `ScraperHealthEvent`. Só A1 (zero_streak) e A2
(fill_rate_name) pausam a fila e geram `ScraperHealthEvent` — A3/A4 alertam sem pausar e se
auto-resolvem quando a métrica volta ao normal (`observability/sanity.ts`, dedupe por `resolvedAt:
null` por `type`). Se um dia precisar de mais granularidade aqui, é schema do Cronos — não inventar
valor fora do enum.

Ver também [[project-innoprospect]] (visão geral da Onda 1 entregue) e
[[bug-bullmq-client-not-ioredis]].
