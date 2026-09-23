---
name: innoprospect-fase4c-cadencia-ligada
description: Auditoria de 2026-09-23 — freio de ritmo (jitter/micro-pausa/pace-lock/cooldown) ligado no envio real de WhatsApp (commit 8d1b205). Veredito, a corrida real encontrada em nextSendAllowedAt, e o que verificar quando o dispatch worker existir.
metadata:
  type: project
---

Auditoria da Fase 4.C (2026-09-23), foco no freio de ritmo passando de "existe mas não age" para
"liga no único call site de produção" (`apps/web/src/lib/services/messages.ts`, commit `8d1b205`).
Ver [[innoprospect-onda-a-envio-unitario]] para o estado anterior (freio existia em `@inno/core`,
mas nada alimentava/gravava) e [[innoprospect-security-baseline]] para o padrão geral do projeto.

**Veredito: pode ir para produção, com uma correção prévia recomendada (não bloqueante para o
volume de hoje, mas bloqueante antes do dispatch worker).**

**Confirmado limpo (perguntas específicas do dono):**
1. Portão único intacto: `grep -rn "sendText(" apps/ packages/` → 1 call site de produção. Nenhum
   caminho de erro/retry externo ao guard: `sendText` roda com `retryable: false` no client HTTP
   (`packages/messaging/src/client/evolution-client.ts:197`) — TIMEOUT/TRANSIENT_ERROR não são
   retentados automaticamente, `messages.ts` trata como resultado `'uncertain'` (não reenvia,
   registra e deixa o operador decidir). Isso é a CORREÇÃO do achado médio da rodada anterior
   (retry não-idempotente) — já resolvido, confirmado lendo o código, não só a memória antiga.
2. `overrides.ignorePaceLock: true` é hardcoded (`messages.ts`), não existe no
   `sendLeadMessageBodySchema` (`packages/contracts/src/whatsapp.contract.ts`) — corpo da
   requisição não tem esse campo, não há como influenciar de fora. O guard
   (`packages/core/src/whatsapp/send-guard.ts` G9c) anula o override sempre que
   `isColdFirstContact===true`, e `isColdFirstContact` vem de uma query server-side
   (`lastOutbound === null`), não de input do cliente. Teste de regressão explícito existe
   (`send-guard.test.ts:254`, "bloqueia MESMO com ignorePaceLock:true").
3. `recordSendFailure` passou a rodar o `update` de `WhatsAppInstance` incondicionalmente, mas só
   os campos de CADÊNCIA (`paceUpdate`) ficaram incondicionais — `consecutiveFailures`/desconexão
   continuam atrás do `if (effect.incrementConsecutiveFailures || effect.disconnectInstance)`
   exatamente como antes. Não há caminho novo para punir instância legítima.
4. Contadores (`sentCount`, `failedCount`, `consecutiveFailures`, `consecutiveUncertain`,
   `sendsSinceMicroPause` no caminho normal) usam `{ increment: 1 }`/`{ decrement: 1 }` — atômico
   no Postgres, confirmado por teste que verifica a FORMA da chamada
   (`messages.test.ts:567`, `:678`), não só o valor final.
5. Resposta de erro (`nextSendAllowedAt`/`resetsAt`/`nextWindowOpensAt` em `details[]`) só é visível
   para quem já está autenticado (`api-handler.ts` exige sessão nesta rota) — modelo
   "autenticado=tudo" do projeto, sem vazamento para terceiro.

**Achado NOVO, Importante — `nextSendAllowedAt` é um SET cego computado no cliente (JS), não um
incremento nem um `GREATEST` no SQL; sob dois escritores concorrentes na MESMA instância, o commit
que chega depois pode sobrescrever com um valor MENOR (mais permissivo) que o de um envio anterior,
encurtando o pace-lock sem erro, sem alarme, sem log que diferencie o caso.** Diferente dos
contadores (item 4 acima), este campo não é `{ increment }` — é
`nextSendAllowedAt: new Date(now + jitterMs)` (`packages/core/src/whatsapp/jitter.ts`), calculado a
partir do "now" LOCAL de cada request, e escrito com `SET` puro
(`paceFieldsForUpdate`, `messages.ts:176-189`). Cenário concreto: envio A resolve a instância em
T=0, `sendText` é rápido, comita `nextSendAllowedAt=T+90s` em T=0.15s. Envio B (outro lead, mesma
instância) resolveu a instância em T=0.1s — ANTES do commit de A — vê o gate ainda aberto, passa o
G9c, mas seu próprio `sendText` é mais lento; quando B comita em T=3.2s, escreve
`nextSendAllowedAt=T+45s(piso)=48.1s`, que é MENOR que o 90.1s que A tinha acabado de estabelecer —
a trava recua. Isso é justamente a proteção anti-banimento que a Fase 4.C existe para impor, e ela
pode ser derrotada por ordem de commit, não por bug de lógica. O comentário do schema
(`packages/db/prisma/schema.prisma`, bloco "CADÊNCIA") já avisa sobre concorrência para os
CONTADORES ("sempre incremento atômico"), mas não cobre este campo — ele trata reset-para-0 como
"SET incondicional, não precisa ler antes" (correto ali, porque 0 é fixo e não depende de ordem),
e generaliza essa tranquilidade para `nextSendAllowedAt` sem notar que aqui o valor NÃO é fixo.
Hoje o risco é baixo (operador único, duas abas exigiria coincidência real), mas o comentário do
próprio schema já avisa que o dispatch worker (Fase 4.D+) será o TERCEIRO escritor na mesma linha —
nesse ponto a chance de dois envios à mesma instância se cruzarem sobe bastante, e é exatamente o
freio mais crítico (o gate que existe para nunca deixar o número disparar rápido demais) que fica
exposto. Recomendação para Vega: escrever `nextSendAllowedAt` como
`GREATEST(nextSendAllowedAt, $novoValor)` via `$executeRaw`/`updateMany` com SQL cru, ou reler
dentro da MESMA transação com `SELECT ... FOR UPDATE` antes do `SET`, para o gate só poder avançar,
nunca recuar, independente da ordem de commit. Não bloqueia hoje (uso próprio, baixa concorrência
real) — bloqueia antes do dispatch worker existir.

**Achado secundário, Baixo — mesmo padrão de TOCTOU na elegibilidade de cota diária (G8), não na
escrita.** `resolveInstanceForSend`/`loadInstanceCandidates` leem `sentToday` num snapshot ANTES do
write-ahead; dois envios concorrentes podem ambos ver `remaining=1` e ambos passar, resultando em
`sentToday` 1 acima do `dailyLimit` no pior caso. Diferente do achado acima, aqui a ESCRITA
(`sentCount: { increment: 1 }`) é atômica e nunca perde contagem — o que pode acontecer é só a
cota diária ser furada por uma unidade sob concorrência real. Baixo risco (mesma razão: pouca
concorrência hoje), citado para constar caso o dispatch worker também dispute a mesma instância que
o envio manual.

**Confirmado limpo, sem achado novo:**
- Teto `MAX_DECISION_TO_SEND_MS` (achado da rodada anterior) implementado e testado:
  `WRITE_AHEAD_TRANSACTION_OPTIONS` (`maxWait: 1s, timeout: 3s`) dá margem real ao teto de 5s;
  decisão expirada reverte a reserva por completo (`revertExpiredReservation`) e falha fechado.
- Logging da cadência (`paceMode`, `jitterMs`, `microPauseTriggered`, `nextSendAllowedAt`) sem
  telefone/texto — mesmo padrão limpo já registrado em [[innoprospect-security-baseline]].
- `sendAlert` nos novos caminhos (`instance_degraded`, `instance_disconnected`) sem telefone/lead,
  mesma exclusão de `INVALID_NUMBER` (mensagem ecoa telefone) já documentada.

Ver também [[innoprospect-onda-a-envio-unitario]] e [[innoprospect-security-baseline]].
