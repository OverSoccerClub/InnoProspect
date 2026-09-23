---
name: convention-worker-alerts
description: Módulo de alerta webhook (apps/worker/src/observability/alerts.ts) — quando dispara, regra de transição, e por que
metadata:
  type: project
---

Entregue na Onda 2 (2026-09-22): antes desta rodada, `ScraperHealthEvent`/pausa de fila (ver
[[convention-worker-redis-state]]) já existiam, mas ninguém era avisado sem abrir o painel/`/health` —
uma busca real ficou 2 dias parada por isso.

**Módulo:** `apps/worker/src/observability/alerts.ts` — `sendAlert(event)` faz POST JSON pro
`ALERT_WEBHOOK_URL` (payload com `text` pronto pra Slack/Google Chat + campos estruturados). NUNCA
lança (timeout de 5s via `AbortController`, qualquer falha só loga e segue) — é seguro chamar sem
`try/catch` em qualquer chamador. Sem `ALERT_WEBHOOK_URL`, é no-op silencioso; `logAlertingStatusOnce()`
loga uma vez no boot (`index.ts`) se está ativo/desligado.

**Regra central: só dispara na TRANSIÇÃO, nunca em todo ciclo.** O módulo em si não tem estado — cada
CHAMADOR já faz a checagem "isto é novo ou já estava assim?" antes de chamar `sendAlert`:
- `observability/sanity.ts`: alerta quando `recordHealthEventIfNew` devolve `created === true` (o dedupe
  de incidente já existia, só faltava plugar o alerta nele). `SanitySeverity` só tem `'high'|'critical'`
  — todo incidente já se qualifica, não existe filtro de severidade "low" a excluir.
- `jobs/scrape-search.job.ts` (`pauseQueueFor`): alerta só se `await scrapeQueue.isPaused()` era
  `false` ANTES de pausar (uma 2ª task falhando com o mesmo erro enquanto a fila já está parada não
  realerta; se já estava pausada por SANIDADE, também não realerta aqui — o incidente original já foi
  avisado no seu próprio ponto).
- `scheduler.ts` (`sweepQueuePause`): alerta só quando o sweep de fato executa `scrapeQueue.resume()`
  (a função já tinha um early-return se `!isPaused`, reaproveitado como o próprio detector de transição).

**Cobertura deliberadamente INCOMPLETA:** retomada MANUAL (`POST /api/v1/scraper/queue/resume`, usada
para pausa indefinida de sanidade/LAYOUT_CHANGED) vive em `apps/web/src/lib/services/scraper-health.ts`
e NÃO dispara alerta — decisão de escopo (arquivo fora da lista de "meus arquivos" desta rodada, e quem
chamou o endpoint manualmente já sabe que acabou de retomar). Se um dia isto for pedido, `apps/web` não
pode importar `apps/worker` (regra de dependência do monorepo, ver [[convention-api-routes-fase1]] item
5) — precisaria de um pequeno módulo de alerta duplicado do lado web, mesmo padrão de "contrato
duplicado" que `queue-state.ts` já usa.

**Testes:** `pauseQueueFor`/`sweepQueuePause` foram exportados (eram privados) só para dar um ponto de
entrada de teste direto sem precisar montar toda a `createScrapeSearchProcessor`/`startWorkers` — ver
`scrape-search.job.test.ts`/`scheduler.test.ts` (fake `Queue` com `isPaused`/`pause`/`resume`, mocks de
`../lib/queue-state.js` e `../observability/alerts.js`). Primeiros testes de `apps/worker` — o
`passWithNoTests: true` em `vitest.config.ts` ainda está lá (não é meu arquivo, deixei pra Íris tirar
quando quiser; não bloqueia nada, os testes correm normalmente com a flag presente).

Ver também [[convention-worker-redis-state]] (pause-meta/heartbeat), [[project-innoprospect]] e
[[convention-web-alerts]] (o gêmeo do lado `apps/web`, Onda 3 de 2026-09-23 — instância caindo,
degradada, campanha parada e Evolution API com erro).
