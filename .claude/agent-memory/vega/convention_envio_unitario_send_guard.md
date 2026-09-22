---
name: convention-envio-unitario-send-guard
description: Implementação do §4.9 (POST /leads/:id/messages) — split G1-G3 (serviço) vs G4-G11 (evaluateSendGuard, core), decisões de gap do contrato e onde cada coisa mora
metadata:
  type: project
---

Entregue 2026-09-22 (item 4 do PROGRESSO.md — "Implementar o §4.9 — envio unitário"). Fecha o buraco
registrado na memória da Nova (`decision_envio_unitario_guard`): `EvolutionClient.sendText` ganhou seu
primeiro (e único) call site de produção.

**Arquivos:**
- `packages/core/src/whatsapp/send-guard.ts` — `evaluateSendGuard(facts, options?)`, cobre G4-G11.
- `packages/core/src/whatsapp/send-window.ts` — piso duro (G5) + janela comercial (G6) + feriados
  nacionais (fixos + móveis calculados a partir da Páscoa, algoritmo de Meeus/Jones/Butcher — não é
  tabela hardcoded ano a ano). Puro: `now`/config sempre por parâmetro, nunca lê env/`Date.now()`.
- `packages/core/src/templates/optout-notice.ts` — `hasOptOutNotice`/`hasCompanyNameMention`, os
  dois textuais/puros que sustentam G10.
- `apps/web/src/lib/services/messages.ts` — `sendLeadMessage`, G1-G3 + resolução de instância +
  leitura de env + write-ahead + chamada real ao `EvolutionClient`.
- `apps/web/src/app/api/v1/leads/[id]/messages/route.ts` — rota fina, `201`.
- `packages/contracts/src/whatsapp.contract.ts` — `sendLeadMessageBodySchema`/`sendLeadMessageResponseSchema`.

**Divergência deliberada do pseudocódigo da Nova — `SendGuardFacts.companyName`:** o documento não
listava esse campo, mas G10 (`MISSING_COMPANY_NAME`) precisa saber QUAL nome procurar no texto final,
e `packages/core` não lê `process.env` (ver `[[convention-messaging-evolution-api]]` — mesma regra:
"fromEnv" fica na camada de serviço). Sem o campo, a checagem teria que adivinhar. Adicionei
`companyName: string | null` ao facts type — pequeno, documentado no arquivo, não muda a semântica dos
outros gates. Se a Nova revisar a ARQUITETURA, isto é o único ponto onde o código não bate 1:1 com o
snippet do §4.9.3.

**G10 é decidido DENTRO do `evaluateSendGuard`** (não no serviço) — usa `facts.text` +
`facts.isColdFirstContact` + `facts.companyName`, via os dois helpers de `optout-notice.ts`. A tabela
"onde a decisão mora" da ARQUITETURA (`core/templates + serviço`) eu li como "core/templates fornece a
função pura, o serviço fornece os dados" — não como "o serviço decide sozinho fora do guard".

**`reason` não tem onde carregar `meta` estruturado** — `apiErrorDetailSchema` é só `{path, message}`
(não fiz essa mudança de schema, só adicionei `reason` conforme o Atlas aprovou). Para
`DAILY_LIMIT_REACHED`/`QUIET_HOURS`/`OUTSIDE_BUSINESS_WINDOW`/`OPTED_OUT`, que a ARQUITETURA quer com
`meta` (`resetsAt`/`nextWindowOpensAt`/`optedOutAt`), reaproveitei o shape existente: `details: [{
path: 'resetsAt', message: '<ISO>' }]` etc. — path vira o NOME do campo de meta, message vira o
VALOR. Documentado para a Lyra no handoff; se a Nova quiser um campo `meta` de verdade no contrato,
é mudança de schema nova, não fiz sozinho.

**Resolução de instância (§4.9.4), sem `instanceId` explícito:** filtra `connected` E com
`remaining > 0` ANTES de aplicar afinidade — ou seja, se a única instância elegível por
afinidade/rotação já bateu a cota, o erro que sai é `409 INSTANCE_NOT_CONNECTED` (com o motivo de cada
instância em `details[]`), NUNCA `DAILY_LIMIT_REACHED`. `DAILY_LIMIT_REACHED` só aparece quando o
operador passa um `instanceId` específico que já bateu o teto (bypassa o pré-filtro, cai direto no G8
do guard). Isto é literal do §4.9.4 item 3 ("nenhuma elegível → INSTANCE_NOT_CONNECTED listando o
motivo de cada uma") — não um bug; tem teste cobrindo os dois casos em `messages.test.ts`.

**`advanceLeadToContacted`:** a FSM de `checkStatusTransition` (`@inno/core/leads/status.ts`, não
tocada) só aceita passo sequencial (`new→validated→contacted`, nunca `new→contacted` direto). Como o
§4.9.5 quer `new|validated → contacted` em UM envio, fiz um laço que anda um degrau por vez dentro da
mesma transação, em vez de reabrir a FSM para aceitar salto.

**Kill switch de envio (§4.9.5/§6.6) só cobre o que o documento nomeou:** `consecutiveFailures>=5 →
isDegraded=true`. Não implementei a "regressão" de `isDegraded` de volta a `false` (não documentado
em §4.9.5 para esse caminho — é o `health-check.job` da Fase 4/§6.2 que cuida de un-degrade por taxa de
resposta, mecanismo diferente). Sinalizado como gap no handoff, não decidi por conta própria.

**Rate limit do envio manual é POR USUÁRIO, não por IP** — reusei `checkRateLimit` de
`lib/rate-limit.ts` (SEM editar esse arquivo, conforme instrução) com chave `manual-send:<userId>`,
chamado dentro do próprio `sendLeadMessage`, não via `apiRoute({rateLimit})` (que é pré-auth/por IP).

**Não pude validar:** nada disto rodou contra Postgres/Evolution API reais (indisponíveis nesta
máquina) — só `pnpm typecheck`/`lint`/`test` (336 testes no monorepo, todos verdes) e leitura de
código. Concorrência real do write-ahead (duas mensagens simultâneas pro mesmo lead/instância) não foi
exercitada — mesmo gap já registrado em `[[project-innoprospect]]` para as Fases 1/2.

**Correções pedidas pelo Órion na auditoria (2026-09-22, mesma rodada — 2 médios corrigidos antes do
commit):**

1. **`sendText` não é idempotente.** `evolutionRequest` (`packages/messaging/src/client/http.ts`)
   retentava `TIMEOUT`/`TRANSIENT_ERROR` até 2x — para um envio, se a 1ª tentativa chegou na Evolution
   e só a RESPOSTA se perdeu, o retry duplicava a mensagem pro lead. Corrigido com um novo campo
   `HttpRequestInput.retryable` (default `true`); `EvolutionClient.sendText` é a ÚNICA chamada que
   passa `retryable: false` — as outras (criar/conectar/status/deletar instância, webhook, checar
   número) continuam retentando como antes. `TIMEOUT`/`TRANSIENT_ERROR` no ENVIO agora são tratados
   como resultado **incerto** em `messages.ts` (`EVOLUTION_ERROR_EFFECT[...].outcome:'uncertain'`):
   `Message.status='failed'` + `errorCode='EVOLUTION_SEND_UNCERTAIN'`, mas **sem** decrementar
   `sentCount` (pode ter saído de verdade) e **sem** incrementar `consecutiveFailures`/degradar a
   instância (não é uma falha confirmada DELA). `MessageStatus` do Cronos não tem um valor "incerto" —
   não alterei o schema, usei `failed` + `errorCode` distinto; relatado como gap, não decidido
   silenciosamente.
2. **Teto entre a decisão do guard e o `sendText` de verdade.** O carimbo de 5s do opt-out só cobria
   até `evaluateSendGuard` — se a transação de write-ahead atrasasse (lock/banco sob carga), a janela
   até o envio crescia sem limite. Adicionei `MAX_DECISION_TO_SEND_MS` (5s, `send-guard.ts`, mesma
   constante que `OPT_OUT_MAX_AGE_MS` em valor mas com propósito distinto) + medição em
   `messages.ts` IMEDIATAMENTE antes do `sendText`, depois do write-ahead: se `Date.now() - guardNow >
   5s`, desfaz a reserva por completo (`revertExpiredReservation`, sabemos que nada foi enviado) e
   devolve `409 SEND_WINDOW_EXPIRED` (retentável — o cliente reenvia o POST, que roda G1-G11 de novo do
   zero). A própria transação de write-ahead ganhou `{maxWait:1000, timeout:3000}` explícitos para não
   segurar a decisão indefinidamente. Isto é só um relógio (`Date.now()`), sem I/O — não conta como
   leitura extra entre o guard e o `sendText` para o invariante que o Órion audita.

O terceiro médio (jitter/limite por lead-instância no envio unitário) ficou para a Fase 4 por decisão
explícita do Órion — só registrado em PENDÊNCIAS, não implementado.

Relacionado: `[[project-innoprospect]]`, memória da Nova `decision_envio_unitario_guard`
(`.claude/agent-memory/nova/`).
