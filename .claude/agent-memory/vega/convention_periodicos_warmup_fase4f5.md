---
name: convention-periodicos-warmup-fase4f5
description: Fase 4.F.5 — warmup-roll.job (diário), health-check.job (ping 3x/taxa de falha 30%) e regressWarmupDay ligado no reconectar (instance-connection.ts)
metadata:
  type: project
---

Entregue 2026-09-25 (ARQUITETURA §6.2/§6.6/§6.9, Fase 4.F.5 — o último item da
Fase 4.F). Sem esta rodada, `warmupDay` nunca avançava: `WARMUP_TABLE`/
`effectiveDailyLimit` (`@inno/core`) eram lidos pelo guard/tick desde a Fase
4.A/4.F.4, mas nenhum código escrevia `warmupDay`.

## Os 3 itens

**1. `apps/worker/src/jobs/warmup-roll.job.ts`** — diário, ~00:10
`APP_TIMEZONE`, agendado via BullMQ `upsertJobScheduler('warmup-roll-scheduler',
{pattern:'10 0 * * *', tz}, ...)` (cron + `tz`, não `every` — precisa de
horário LOCAL fixo). Por instância: (1) `InstanceDailyStat` de ONTEM
(`localDateKey - 24h em millis`, não uma quinta cópia manual de fuso) com
`sentCount > 0` → `warmupDay += 1`; (2) `warmupFrozenAt` setado → não avança
(só RESPEITA a coluna — não implementa o detector, ver item 2 abaixo); (3)
zera `sendsSinceMicroPause`/`consecutiveUncertain`, INCONDICIONAL, sempre.
Restart no meio do ciclo: cada instância tem seu próprio `try/catch` e
`update` — o pior efeito é "não ganhou 1 dia hoje", nunca dado incoerente.
`upsertJobScheduler` (idempotente por `jobSchedulerId`, mesmo padrão do
`dispatch-tick`) garante que um restart não agenda um SEGUNDO cron por cima —
perder o disparo de um dia é seguro; rodar duas vezes no mesmo dia não seria.

**2. `apps/worker/src/jobs/health-check.job.ts`** — ~90s
(`DISPATCH_HEALTH_CHECK_INTERVAL_S`), MESMA fila `QUEUES.maintenance` que o
warmup-roll (1 `Queue`+1 `Worker`, diferenciados por `job.name` em
`scheduler.ts` — 2 jobs pequenos não justificam 2 pares Queue/Worker). Só a
fatia que ARQUITETURA §6.9 marca como Fase 4 ("só o que PARA"):
- Ping em toda `EvolutionServer` ativa (+ cliente legado da env, se houver
  instância `evolutionServerId: null`) via `testConnection()`
  (`@inno/sending`, o mesmo GET que o botão "testar conexão" do admin usa).
  Se **TODOS** os pings desta rodada falharem, incrementa um contador
  CONSECUTIVO em Redis (`lib/health-check-state.ts`, `Queue#client`, mesmo
  padrão de `queue-state.ts`/`dispatch-state.ts` — estado operacional, não
  domínio). Ao atingir `DISPATCH_HEALTH_CHECK_PING_HALT_AT` (default 3),
  `campaign.updateMany({where:{status:'running'}})` → `halted` + alerta
  `dispatch_evolution_down_all_halted`. Decisão: outage PARCIAL (só ALGUNS
  servidores caídos, multi-servidor) **não** dispara este halt global — cada
  envio individual já vira `evolution_api_error` pelo caminho existente. Só
  "não há NENHUM Evolution para mandar nada" halta tudo.
- Por instância ativa não-banida: taxa de falha nos últimos
  `DISPATCH_HEALTH_CHECK_FAILURE_RATE_SAMPLE` (default 50) envios
  **RESOLVIDOS** (`status IN (sent,delivered,read,failed)`, nunca `queued`).
  Acima de `DISPATCH_HEALTH_CHECK_FAILURE_RATE_THRESHOLD` (default 0.3) →
  `isDegraded=true` + `warmupFrozenAt=now` (dedupe: só escreve/alerta se
  `warmupFrozenAt` ainda era `null`). Recupera: `warmupFrozenAt: null`
  **sem** forçar `isDegraded: false` — decisão deliberada, porque a OUTRA via
  de degradação (`consecutiveFailures >= 5`, `send-one.ts`) nunca escreve
  `warmupFrozenAt`, e as duas podem estar ativas ao mesmo tempo na mesma
  instância; `warmupFrozenAt` é o marcador exclusivo de "isto fui eu que
  fiz", e só desfaço o que é meu.

**Fora de escopo, de propósito, mesmo parecendo fácil** (ARQUITETURA §6.9,
critério de corte "sem histórico suficiente no aceite da Fase 4 = não
testável agora"): as duas heurísticas de shadow-ban por taxa de RESPOSTA
("<2% em 48h com ≥100 enviadas", "sem resposta em 100+ envios"). Não
implementadas — nem parcialmente, nem como TODO. `InstanceDailyStat.
respondedCount` também **nunca é incrementado** em lugar nenhum do código
hoje (confirmado por grep antes de decidir); mesmo se o histórico existisse,
não haveria o dado. Se um dia a Fase 5/6 pegar isto, precisa também ligar
essa escrita.

**3. `apps/web/src/lib/services/instance-connection.ts` — `regressWarmupDay`
ligado (código sem chamador desde a Fase 3).** Dentro do MESMO corpo
(`applyInstanceConnectionTransition`), na transição
`previousStatus ∈ {disconnected,banned}` E `nextStatus === 'connected'`
("`wasUpTransition`"): `SELECT "warmupDay" ... FOR UPDATE` (lock pessimista,
mesmo padrão de `users.ts#lockActiveAdminsAndCount` — NÃO um UPDATE
condicional como `advanceNextSendAllowedAt`, porque a fórmula de
`regressWarmupDay` não é uma comparação simples de "só avança" expressável
só na cláusula WHERE) e então `regressWarmupDay(row.warmupDay)` de
`@inno/core` de verdade — a função pura finalmente tem um chamador real, não
só teste. **Decisão de escopo (pedida explicitamente para eu decidir):**
dispara no webhook `connection.update` E na reconciliação FORÇADA
(`POST /whatsapp/instances/reconcile`), **nunca** na reconciliação
AUTOMÁTICA da listagem (`GET /whatsapp/instances`) — essa última só
reconcilia instância que JÁ estava `connected` no banco (`isStaleConnectedInstance`),
então nunca chama a função com `previousStatus` de queda; a exclusão é
estrutural (o filtro de candidatos), não um `if` extra que eu precisei
adicionar. É isto que resolve a armadilha real ("oscilar connected↔queda não
pode perder 30% a cada tela aberta"): não é dedupe por tempo, é que só 2 dos
3 chamadores conseguem produzir a transição perigosa.

`ApplyInstanceConnectionTransitionResult` ganhou `warmupRegression:
{fromDay, toDay} | null` — só para o CALLER logar (webhook.ts/
whatsapp-instances.ts, ambos com uma linha de log dedicada); nenhuma tela lê
esse retorno, quem prova o aceite (§8.0 regra 3, "warmupDay visivelmente
menor na tela") é a PRÓXIMA leitura de `GET /whatsapp/instances(/:id)`.

## Gotcha de teste corrigido (fake-db compartilhado)

`apps/web/src/test/fake-db.ts#$queryRaw` era um stub cego (`async () => []`,
comentário explícito dizendo "só evita `.$queryRaw` quebrar", usado até então
só por `users.ts#lockActiveAdminsAndCount` que descarta o resultado). Para
provar o recuo de warmup de verdade nos testes (não só que não quebra),
precisei roteá-lo por CONTEÚDO da query (mesmo padrão de `dashboard.test.ts`):
se o SQL contém `whatsapp_instances` E `warmupDay`, devolve
`[{warmupDay: <valor atual no store>}]`; qualquer outra query continua `[]`
(comportamento de `users.ts` intocado). `FakeWhatsAppInstance` ganhou
`warmupDay?`/`warmupFrozenAt?` opcionais (default `1`/`null` só no `create`).
Testes NOVOS: `instance-connection.test.ts` (7, dedicado — não existia antes,
mesmo que o comentário de `fake-db.ts#statusCheckedAt` desde 2026-09-24 já
citasse esse nome como próximo passo). `webhook.test.ts`/
`whatsapp-instances.test.ts` (33/20 testes) passaram **intactos** — nenhum
cenário deles atravessa `previousStatus` de queda→conectada, então
`$queryRaw` nunca é chamado ali e o roteamento novo não altera nada.

`apps/worker/src/test/fake-dispatch-db.ts` ganhou: `FakeEvolutionServer`
(+ `evolutionServers` no seed/store), `whatsAppInstance.findMany` com filtros
`isActive`/`status:{not}`/`evolutionServerId`, `whatsAppInstance.count`,
`message.findMany` (não existia — só `findFirst`/`findUnique`/`create`/
`update`), `instanceDailyStat.findUnique` (idem), `evolutionServer.findMany`.
`FakeWhatsAppInstance` ganhou `isActive?`/`warmupFrozenAt?` opcionais.

## Gotcha de tipo (BullMQ `IRedisClient`)

`Queue#client` (via `await queue.client`) tem tipo `IRedisClient` do BullMQ,
que só declara os poucos métodos que o BullMQ usa internamente — **nem
`incr` está lá**, apesar de existir e funcionar em runtime (o cliente real é
`ioredis`, ver `[[bug-bullmq-client-not-ioredis]]`). Mesmo cast "tipo
declarado mais estreito que o cliente real" de `queue-state.ts#
recordHeartbeat`/`dispatch-state.ts` — usei para `INCR` em
`health-check-state.ts#recordEvolutionPingFailure`. Ao contrário do gotcha do
`.set(...'EX'...)`, `INCR` tem a MESMA assinatura em `ioredis`/`node-redis` —
só falta no TIPO, não é um gotcha de sobrecarga posicional.

## Números finais desta rodada

841 testes (`pnpm -w test`, era 815) — +7 `instance-connection.test.ts`, +11
`warmup-roll.job.test.ts`, +8 `health-check.job.test.ts`. `pnpm typecheck`
(10 pacotes) e `pnpm lint` limpos. Build do worker (`tsup`) confirmado:
`runWarmupRoll`/`runHealthCheck` aparecem em `dist/index.js`, zero
`import ... from "@inno/sending"`/`"@inno/core"` literal (inlinado, só
comentários de sourcemap) — mesma prova de bundling de
`[[convention-sending-extraction-fase4f]]`.

## Não pude validar

Sem Postgres/Redis reais (`[[project-innoprospect]]`): o cron `pattern`+`tz`
do `warmup-roll-scheduler` nunca disparou de verdade contra um Redis real
(só a chamada de `upsertJobScheduler` foi confirmada por tipo/lint/build, não
por execução); o `SELECT ... FOR UPDATE` do recuo de warmup não foi exercido
sob concorrência REAL contra o `warmup-roll.job` (só o fake prova o
CONTRATO — devolve o valor certo, computa a fórmula certa). Boot do
CONTAINER (Docker) não verificado nesta máquina — mesma lacuna de sempre.

Ver também `[[project-innoprospect]]`, `[[convention-send-policy-local-date-key-fase4f2]]`
(`localDateKey`), `[[convention-reconciliacao-status-instancia]]`
(`applyInstanceConnectionTransition`, os 3 casos de reconciliação),
`[[bug-pace-lock-blind-set-regression]]` (a lição de lock que motivou o
`FOR UPDATE` aqui), `[[convention-worker-redis-state]]` (o padrão de estado
operacional em Redis via `Queue#client`).
