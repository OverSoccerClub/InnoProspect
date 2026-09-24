---
name: convention-sending-extraction-fase4f
description: Fase 4.F.0-4.F.3 — extração da sequência protegida de envio para @inno/sending (packaging web+worker) e o freio global do motor (pausa persistida + heartbeat)
metadata:
  type: project
---

Entregue 2026-09-24 (ARQUITETURA §6.8.0/§6.8.9, Fase 4.F passos 0-3 — o tick
em si, 4.F.4, **não** entrou nesta rodada, por pedido explícito do Atlas).

## O que existe agora

**`packages/sending`** (pacote novo, `type: module`, `exports: "./src/index.ts"`,
mesmo padrão de `@inno/core`/`@inno/messaging` — sem build próprio):
- `src/ports.ts` — os 6 campos de `SendAttemptDeps` (`prisma`, `evolutionClient`,
  `logger`, `notify`, `now?`, `rng?`) e NADA além disso. `SendTextClient =
  Pick<EvolutionClient, 'sendText'>` (tipo, de `@inno/messaging`).
  `SendNotifyEvent` é um union PRÓPRIO (4 variantes: `instance_disconnected`/
  `instance_degraded`/`campaign_halted`/`evolution_api_error`) — estruturalmente
  IDÊNTICO ao `AlertEvent` de `apps/web/src/lib/alerts.ts`, o que permite
  `notify: sendAlert` SEM CAST na chamada (TypeScript aceita por variância
  estrutural de parâmetro de função). Se o `AlertEvent` do worker um dia
  ganhar esses 4 kinds (Fase 4.F.4), o mesmo truque funciona lá.
- `src/outcome.ts` — `SendAttemptResult` (união discriminada: `blocked`/
  `expired`/`sent`/`failed`/`uncertain`) e `EVOLUTION_ERROR_EFFECT` (a ÚNICA
  tabela de classificação de erro — reason/outcome/incrementConsecutiveFailures/
  disconnectInstance/**httpStatus**). Testado (`outcome.test.ts`): cobre TODO
  `MessagingErrorCode` (via `MESSAGING_ERROR_POLICY`, não lista hardcoded),
  só TIMEOUT/TRANSIENT_ERROR são `uncertain`, só INSTANCE_DISCONNECTED/
  INSTANCE_NOT_FOUND desconectam.
- `src/pace.ts` — `paceFieldsForUpdate`/`advanceNextSendAllowedAt`, movidos
  BYTE A BYTE de `messages.ts` (a correção de monotonicidade do Órion,
  `[[bug-pace-lock-blind-set-regression]]`, sobrevive intacta — testada
  também aqui, `pace.test.ts`, além do teste ponta-a-ponta que já existia em
  `messages.test.ts`).
- `src/campaign-targets.ts` — `advanceCampaignTargetStatus`/
  `skipPendingCampaignTargetsForPhone`/`haltCampaignsSoleInstanceDisconnected`,
  movidos de `apps/web/src/lib/services/campaign-targets.ts`.
  **Divergência deliberada**: `haltCampaignsSoleInstanceDisconnected` ganhou
  um 4º parâmetro `notify: SendingNotify` (era import direto de `sendAlert`)
  — é a única forma de mover a função sem o pacote compartilhado importar
  `@/lib/alerts`. `apps/web/src/lib/services/campaign-targets.ts` continua
  existindo como EMBRULHO fino: reexporta as duas primeiras sem mudança,
  embrulha a terceira injetando `sendAlert` — os 3 outros call sites que já
  existiam (`webhook.ts`, `whatsapp-instances.ts`, `optouts.ts`) continuam com
  a MESMA assinatura de 3 argumentos, zero linha alterada neles.
- `src/send-one.ts` — `executeSendAttempt(deps, input)`, o corpo da extração:
  leitura de opt-out → `evaluateSendGuard` → write-ahead → `sendText` →
  classificação → `recordSendFailure`/`recordSendUncertain`/
  `revertExpiredReservation` → `advanceNextSendAllowedAt`/`advanceLeadToContacted`
  → transição de `CampaignTarget`/`CampaignInstance`. Nunca lança
  `ApiHttpError`; devolve `SendAttemptResult`. `CampaignSendContext`/
  `SendAttemptActor` (novo: `{type:'user',userId}` | `{type:'system'}`,
  decide `LeadActivity.actor`/`actorUserId` no sucesso) moraram aqui.

## Gaps do snippet da ARQUITETURA que preenchi (documentados, não decididos em silêncio)

A união `SendAttemptResult` do §6.8.0.2 é ilustrativa, não exaustiva campo a
campo. Preenchi:
- `'failed'`/`'uncertain'` ganharam `message: string` — sem isso, a resposta
  HTTP do envio manual perderia o texto específico do erro da Evolution (ex.:
  "número sem WhatsApp") e cairia sempre no genérico. Replica EXATAMENTE a
  lógica antiga de `mapSendErrorToApiError`: `MessagingError.message` quando
  existe, senão texto genérico fixo (nunca `String(err)` cru) — distinto do
  texto GRAVADO no banco (`errorMessage`, que cai no `err.message`/`String(err)`
  cru como fallback de 2ª linha). As duas strings divergem de propósito nos
  casos raros de erro não-`MessagingError`; preservei os DOIS fallbacks
  originais, não um só.
- `EVOLUTION_ERROR_EFFECT` continua incluindo `httpStatus` (409/502) mesmo
  a ARQUITETURA chamando isso de "vocabulário HTTP, fica em apps/web" — a
  tabela em si (dado, não lógica de tradução) é exportada e RELIDA por
  `apps/web/messages.ts#mapSendErrorToApiError`, que é quem de fato decide
  chamar `conflict`/`upstreamError`. Não duplica a tabela; só reusa.
- `renderedTemplateId`/`actor` entraram no `ExecuteSendAttemptInput` (não
  estavam no snippet) — sem eles, o `LeadActivity` de sucesso perderia
  `templateId` e passaria a gravar sempre `actor:'user'`, quebrando o
  contrato para o futuro motor (que precisa `actor:'system'`, sem
  `actorUserId`).

## Armadilha do teste que exigiu decisão (não um "ajuste" — ver abaixo)

`messages.test.ts` mockava `@/lib/services/campaign-targets` para
`haltCampaignsSoleInstanceDisconnected`. Depois da extração, quem chama essa
função é `packages/sending` (via `send-one.ts`, import relativo interno), não
mais `messages.ts` — o mock antigo do teste virou morto (não intercepta mais
o caminho real). Resolvido SEM tocar nenhuma asserção: adicionei 2 métodos
stub (`campaign.findMany: async () => []`, `campaign.updateMany`) ao fake
Prisma do teste e REMOVI o `vi.mock` que ficou sem efeito — como nenhum
cenário de `messages.test.ts` semeia `store.campaigns`, o resultado é
IDÊNTICO ao mock antigo (`[]`, nenhum alerta). `campaign-targets.test.ts`
(arquivo dedicado, mocka `@/lib/alerts` e usa `fakePrismaClient`) não mudou
NADA — continua testando a versão REAL via o wrapper de `apps/web`, com o
mesmo comportamento. **Total: 30 testes em `messages.test.ts` (era 30),
zero alteração de asserção — só a fixture do fake Prisma.**

## Empacotamento (4.F.0) — provado, não só assumido

- `apps/worker/tsup.config.ts`: `noExternal` ganhou `sending` na regex
  (`/^@inno\/(core|contracts|scraper|sending)$/`). Provei com um probe
  isolado (`tsup` ad-hoc importando só `@inno/sending`+`@inno/db`, sem
  `@inno/scraper`/playwright): `node dist/probe.js` roda, `executeSendAttempt`
  é função, `EVOLUTION_ERROR_EFFECT` é objeto, `prisma.$queryRaw` é função
  (confirma `@inno/db` continua EXTERNAL e resolve normal). `grep` no
  `dist/*.js` real do worker confirma: zero `import ... from "@inno/sending"`
  (inlinado), `import { prisma } from "@inno/db"` continua literal (external).
- `apps/worker/src/selftest-checks.ts#checkModulosInternos`: 4º import
  paralelo (`@inno/sending`), checa `typeof sending.executeSendAttempt ===
  'function'`.
- `apps/web/next.config.ts`: `@inno/sending` entrou em `transpilePackages`
  (ao lado de contracts/core/db) E em `apps/web/package.json#dependencies`.
  `pnpm --filter web build` (next build) chegou a "Generating static pages
  (37/37)" sem erro de resolução de módulo — só falhou DEPOIS, no passo de
  copiar arquivos para `.next/standalone` (`EPERM: symlink`, limitação do
  Windows/permissão, não relacionada a `@inno/sending`; não reproduz em
  Linux/container).
- **Não pude provar** (sem Docker nesta máquina, `[[project-innoprospect]]`):
  o boot real do CONTAINER. Sinal a procurar no log de boot do worker em
  produção: a linha `[selftest] modulos-internos: OK` (ou, se falhar, o texto
  do erro tem que citar Postgres/Redis/Chromium — NUNCA
  `ERR_UNKNOWN_FILE_EXTENSION` nem "Cannot find module
  '.../packages/sending/src/...'"; se aparecer isso, o `noExternal` regrediu).

## O freio do motor (4.F.3) — semântica INVERTIDA de propósito

`inno:dispatch:queue:enabled-meta` no Redis: **chave PRESENTE = motor
LIGADO**; ausente = pausado (contrário do scraper, `inno:scrape:queue:
pause-meta`, onde ausência = rodando). Escrito/lido dos dois lados:
- `apps/web/src/lib/dispatch-state.ts` — LÊ (fail-soft, timeout 2s) E
  ESCREVE (lança em erro real de Redis — é ação explícita do operador,
  200 mentiroso seria pior que 500). `apps/web/src/lib/dispatch-queue.ts` —
  só um `Queue('dispatch-tick', ...)` para pegar `.client`; nome duplicado
  de `apps/worker/src/queues.ts#QUEUES.dispatchTick`, com teste de paridade
  em `apps/worker/src/queues.test.ts` (mesmo padrão do
  `SCRAPE_SEARCH_QUEUE_NAME`).
- `apps/worker/src/lib/dispatch-state.ts` — só LÊ (`readDispatchEnabledMeta`/
  `isDispatchEnabled`, sem chamador ainda — é para o 4.F.4 ligar) e ESCREVE
  o heartbeat (`recordDispatchTickHeartbeat`).
- Rotas: `GET/POST /api/v1/dispatch/queue` (GET = status sem role; POST =
  PAUSA, sem `acknowledge`, de propósito — é o botão de emergência, tem que
  funcionar num clique) + `POST /api/v1/dispatch/queue/resume` (LIGA,
  `requireRole:'admin'` + `{acknowledge:true}` — é a ação de MAIOR risco do
  par, por isso carrega a confirmação que pausar não tem).

⚠️ **`lastTickAt` hoje prova só "o processo do worker está de pé"**, não "o
tick rodou" — o heartbeat é escrito por um `setInterval` no boot
(`scheduler.ts`), não pelo processor de um job real (que não existe até
4.F.4). Documentado no código para não vender a tela como "motor vivo"
antes da hora — quando o tick nascer, a gravação migra para DENTRO do
processor, sem trocar chave nem leitor.

**Fora de escopo nesta rodada, de propósito** (pedido explícito do Atlas,
mesmo a ARQUITETURA listando "telas" em 4.F.3): nenhuma tela nova (Lyra),
o tick em si (4.F.4), `resolveSendPolicy`/`localDateKey`/`resolveCampaignWindow`/
`pickInstanceWeighted` (4.F.2, adições puras a `@inno/core` — não pedidas
nesta rodada e parcialmente coincidentes com os itens explicitamente
excluídos: rotação de instância e os 3 campos inertes do §6.8.10). Sinalizado
ao Atlas como PENDÊNCIA a decidir, não implementado por conta própria.

## Não pude validar

Nada disto rodou contra Postgres/Redis reais (mesma limitação de sempre,
`[[project-innoprospect]]`). `pnpm typecheck`/`lint`/`test` (711 testes,
era ~701 + 10 novos de `@inno/sending`) e o build do worker/web (provas
específicas acima) — mas concorrência REAL entre um envio manual e o futuro
`dispatch-tick` (o segundo escritor que `advanceNextSendAllowedAt` prevê)
segue sem exercício com dois processos de verdade.

Ver também `[[project-innoprospect]]`, `[[bug-pace-lock-blind-set-regression]]`,
`[[convention-cadencia-ligada-envio-manual]]`, `[[convention-worker-redis-state]]`.
