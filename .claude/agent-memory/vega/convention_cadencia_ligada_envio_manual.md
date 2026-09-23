---
name: convention-cadencia-ligada-envio-manual
description: Fase 4.C — ligação real da cadência (jitter/pace lock/micro-pausa) no envio unitário (apps/web/src/lib/services/messages.ts), decisão de ignorePaceLock, e o formato de erro que a Lyra consome para SEND_PACE_LOCKED/LEAD_CONTACT_COOLDOWN
metadata:
  type: project
---

Entregue 2026-09-23 (Fase 4.C, ARQUITETURA §4.9.10/§6.8.7). Fecha o ciclo aberto em
[[convention-cadencia-jitter-pace-lock]] (4.B, políticas puras) + Cronos (4.A, schema) — agora
`sendLeadMessage` de fato lê/escreve `WhatsAppInstance.nextSendAllowedAt/sendsSinceMicroPause/
consecutiveUncertain`. Único arquivo tocado: `apps/web/src/lib/services/messages.ts` (+ o teste
correspondente). Não toquei `apps/web/src/components/**` nem telas — território da Lyra na rodada
seguinte.

**Decisão registrada, não assumida — `overrides.ignorePaceLock` é SEMPRE `true` quando o serviço monta
`facts`, incondicionalmente.** Não veio (e não precisa vir) do corpo da requisição — não adicionei
campo novo a `sendLeadMessageBodySchema`. Raciocínio: o envio manual É, por definição, um humano na
tela; quem decide se o desvio VALE é só o guard (`send-guard.ts`, G9c), que o anula sempre que
`isColdFirstContact === true` (ver `[[convention-cadencia-jitter-pace-lock]]`, "Override anulado DENTRO
do guard"). Pedir sempre e deixar o guard filtrar é mais simples E mais seguro do que o serviço tentar
adivinhar "isto é resposta ou é frio" duas vezes (a MESMA pergunta que o guard já responde via
`isColdFirstContact`).

**O que o dono vai sentir, na prática:**
- 1º contato frio (nunca houve outbound para o lead) com o número ainda no intervalo mínimo →
  `409/SEND_PACE_LOCKED`, MESMO sendo envio manual. O motor e o manual compartilham o mesmo freio
  aqui — não existe atalho para prospecção fria "só porque foi um clique e não uma campanha".
- Responder uma conversa já aberta (existe pelo menos 1 outbound anterior) dentro do mesmo intervalo →
  passa direto, sem esperar. `warnings[]` inclui `PACE_LOCK_BYPASSED_FOR_REPLY` (visível, não invisível
  — ARQUITETURA: "desvio autorizado é aceitável; desvio invisível não"). O gate ainda avança (a
  mensagem sai pelo mesmo número), só que com o PISO do jitter (45s default) em vez do sorteio cheio, e
  SEM tocar `sendsSinceMicroPause` — uma resposta não pode disparar a micro-pausa de 5-12min da
  campanha no meio de uma conversa.

**Armadilha da rodada anterior, verificada aqui de verdade:** todo campo novo do facts (`instance.
nextSendAllowedAt`, `lastInboundAt`) é passado com `?? null` explícito, nunca omitido — `instance.
nextSendAllowedAt ?? null`, `lastInbound?.createdAt ?? null`. Testei o caso concreto ("instância com
`nextSendAllowedAt` nulo continua enviando") — é o estado de TODA instância que já existe em produção
hoje, migração aditiva sem backfill.

**`advanceSendPace` chamado depois de TODO `sendText`** — sucesso (`sentAt` real), falha confirmada e
resultado incerto (`new Date()` no `catch`) — nunca quando `sendText` nem chegou a ser chamado (o
`SEND_WINDOW_EXPIRED` do teto de 5s continua sem tocar a cadência, correto: não houve tentativa de
envio). `paceMode` (`'full'` vs `'floor'`) é decidido UMA vez, lendo `verdict.warnings` por
`PACE_LOCK_BYPASSED_FOR_REPLY`, e reusado nos 3 desfechos.

**Persistência sempre atômica — `paceFieldsForUpdate(mode, result)`:** `nextSendAllowedAt` é SET
absoluto (não tem problema de concorrência — é "o valor do envio mais recente", last-write-wins é a
semântica certa). `sendsSinceMicroPause` usa SEMPRE `{ increment: 1 }` (nunca o valor calculado por
`advanceSendPace`, que pode estar 1 passo atrás de outra escrita concorrente) ou `0` incondicional
quando a micro-pausa dispara — seguindo a convenção do Cronos
(`gate-nullable-e-contadores-concorrentes`). Testado explicitamente checando o SHAPE da chamada ao
Prisma (`expect(prismaMock.whatsAppInstance.update).toHaveBeenCalledWith(expect.objectContaining({
data: expect.objectContaining({ sendsSinceMicroPause: { increment: 1 } }) }))`) — prova que o código
não faz `SELECT` seguido de soma em JS, não só que o número final bateu.

**Gap que fui alm do pedido, mas coerente com o schema do Cronos — `consecutiveUncertain`.** O
comentário do campo em `schema.prisma` diz que ele é escrito pelo envio manual E pelo `dispatch-tick`;
eu incrementava `nextSendAllowedAt`/`sendsSinceMicroPause` sem tocar nele seria deixar 1/3 das colunas
de cadência inconsistentes para quando a Fase 4.F (motor) chegar a depender delas (`≥3 tira da rotação,
≥5 halt`, ainda não implementado). Resolvido: `{ increment: 1 }` em `recordSendUncertain`, `SET 0`
incondicional no sucesso — nunca tocado em falha confirmada normal (só sucesso zera, por design do
Cronos).

**`recordSendFailure` mudou de condicional para incondicional.** Antes só chamava
`tx.whatsAppInstance.update` quando a falha afetava `consecutiveFailures`/desconexão (ex.:
`INVALID_NUMBER` nunca tocava a instância). Agora chama SEMPRE (a cadência precisa avançar em toda
falha confirmada), com os campos de `consecutiveFailures`/desconexão continuando condicionais via
spread. Verifiquei que os testes de `INVALID_NUMBER` (que dependiam do update NÃO acontecer) continuam
passando — a asserção era sobre o VALOR final de `consecutiveFailures`, não sobre a chamada nunca
ocorrer.

**Erro estruturado para a Lyra — contrato exato de `details[]` (mesma convenção "path=nome do campo,
message=valor ISO" que `DAILY_LIMIT_REACHED`/`QUIET_HOURS` já usavam, ver
[[convention-envio-unitario-send-guard]]):**
- `409 CONFLICT`, `reason: 'SEND_PACE_LOCKED'` → `details: [{ path: 'nextSendAllowedAt', message:
  '<ISO 8601>' }]`. É o instante exato em que o botão volta a funcionar — a Lyra pode fazer contagem
  regressiva ou só reabilitar o botão nesse instante.
- `409 CONFLICT`, `reason: 'LEAD_CONTACT_COOLDOWN'` → `details: [{ path: 'resetsAt', message: '<ISO
  8601>' }]`. Este eu computei NO SERVIÇO (`lastOutboundAt + coldFollowupCooldownMs`), não em
  `@inno/core` — o guard só devolve `lastOutboundAt` em `meta` porque não conhece
  `COLD_FOLLOWUP_COOLDOWN_H` (lido de env, camada de serviço). Sem este cálculo, o campo ficava
  faltando e a tela não tinha como mostrar "quando libera" — o MESMO requisito de produto do dono, só
  que num gate diferente do que ele pediu explicitamente (pedido cobria `SEND_PACE_LOCKED`; estendi
  para `LEAD_CONTACT_COOLDOWN` por ser o mesmo bug de UX, documentado aqui em vez de silencioso).
- Os dois `reason` ANTES desta rodada caíam no `conflict(message, undefined, reason)` genérico do fim
  da função — ou seja, o `meta` do guard (que já existia) era SILENCIOSAMENTE descartado. Bug latente
  que nunca apareceu em teste porque nenhum teste checava `details` para esses dois `reason` antes de
  agora.

**Env novas lidas em `messages.ts` (documentadas em ARQUITETURA §10, nunca lidas antes desta rodada):**
`COLD_FOLLOWUP_COOLDOWN_H` (horas, default 24), `DISPATCH_JITTER_MIN_S`/`MAX_S` (piso NUNCA contornável
pela env, `MIN_JITTER_FLOOR_SECONDS`=30, mesmo padrão de `quietHoursFromEnv`), `DISPATCH_MICRO_PAUSE_
EVERY_MIN`/`EVERY_MAX`/`MIN_S`/`MAX_S`. Sem isso, `evaluateSendGuard`/`advanceSendPace` caíam sempre nos
defaults de `@inno/core`, ignorando a env documentada — mesmo padrão dos outros `*FromEnv` do arquivo.

**Testes novos (8, em `messages.test.ts`):** envio permitido com gate nulo; travado (1º contato frio,
`SEND_PACE_LOCKED` com `details` exato); bypass em resposta (`floor`, `sendsSinceMicroPause` intocado,
valor exato `sentAt+45s`); confirmação de que 1º contato frio NUNCA bypassa mesmo o serviço sempre
pedindo o override; `LEAD_CONTACT_COOLDOWN` com `resetsAt` calculado; `COLD_FOLLOWUP_COOLDOWN_H` da env
encurtando o cooldown; sucesso incrementando atomicamente + zerando `consecutiveUncertain`; micro-pausa
determinística disparando em `sendsSinceMicroPause>=25` (extremo documentado em `shouldTriggerMicroPause`,
sem depender de RNG). Estendi também o teste de `TIMEOUT` (resultado incerto) já existente com as
mesmas asserções de cadência. `pnpm --filter web test`: 206 (era 198). Total do monorepo (rodei cada
pacote — `web`+`core`+`worker`+`contracts`+`messaging`+`scraper`): 527 (era 519).
`pnpm --filter web|@inno/core typecheck/lint`: limpos.

**Não pude validar:** nada disto rodou contra Postgres real (mesma limitação de sempre — sem Postgres/
Redis nesta máquina, ver `[[project-innoprospect]]`). A imprecisão teórica documentada no código
(`paceFieldsForUpdate`) — a DECISÃO de disparar micro-pausa pode usar uma leitura de
`sendsSinceMicroPause` levemente desatualizada sob concorrência REAL entre duas requisições simultâneas
de envio manual (não existe ainda concorrência com o `dispatch-tick`, que não foi implementado) — nunca
foi exercitada com duas requisições de verdade em paralelo, só documentada como limitação aceitável
(o CONTADOR persistido nunca perde incremento; só o timing exato do sorteio da micro-pausa pode
divergir por 1 envio em casos raros).

Relacionado: `[[convention-cadencia-jitter-pace-lock]]` (4.B, políticas puras),
`[[convention-envio-unitario-send-guard]]` (G1-G11 original, convenção de `meta`→`details[]`),
`[[project-innoprospect]]`.
