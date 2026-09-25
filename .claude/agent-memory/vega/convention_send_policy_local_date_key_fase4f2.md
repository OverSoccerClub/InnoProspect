---
name: convention-send-policy-local-date-key-fase4f2
description: Fase 4.F.2 — resolveSendPolicy(env), localDateKey(now,tz), daysOfWeek+resolveCampaignWindow (A32), pickInstanceWeighted em @inno/core
metadata:
  type: project
---

Entregue 2026-09-25 (Fase 4.F.2, ARQUITETURA §8 tabela 4.F / §6.8.10 / §6.8.4). Quatro adições PURAS a
`packages/core`, zero `process.env` dentro do pacote. Nenhuma tem chamador no tick ainda (é a 4.F.4,
próxima rodada) — mas religuei os 4 call sites que JÁ existiam em `apps/web` para as 2 primeiras, por
regra explícita do briefing ("se houver call site que já existe hoje e deveria usá-las, ligue agora").

**Arquivos novos:**
- `packages/core/src/time/local-date-key.ts` — `localDateKeyString(now, tz)` (string `YYYY-MM-DD`) e
  `localDateKey(now, tz)` (`Date` = meia-noite UTC desse dia — mesma granularidade de
  `InstanceDailyStat.date`, `@db.Date`).
- `packages/core/src/whatsapp/send-policy.ts` — `resolveSendPolicy(env: SendPolicyEnv): SendPolicy`.
- `packages/core/src/whatsapp/instance-selection.ts` — `pickInstanceWeighted(candidates, rng?)`.
- `packages/core/src/whatsapp/send-window.ts` (estendido) — `businessWindow.daysOfWeek?: readonly
  number[]`, `BUSINESS_WINDOW_DEFAULT_DAYS_OF_WEEK = [1,2,3,4,5]`, `resolveCampaignWindow(pisoDaEnv,
  campanha)`.

**Achado ao investigar o item 2 (localDateKey) — havia TRÊS cópias manuais, não uma "segunda":**
`whatsapp-instances.ts#todayDateKey`, `campaigns.ts#todayDateKey` e `messages.ts#todayDateKey` (que
tinha ainda uma QUARTA variante, `localDateKeyString`, para a semente do spintax). Religuei as três a
`localDateKey`/`localDateKeyString` de `@inno/core` — comportamento idêntico, confirmado por
`messages.test.ts`/`campaigns.test.ts`/`whatsapp-instances.test.ts` passando sem alteração. Se aparecer
uma quarta cópia manual de `Intl.DateTimeFormat('en-CA', ...)` em qualquer serviço novo, é bug — importar
de `@inno/core`.

**`resolveSendPolicy(env)` — como "recebe env por parâmetro" e "process.env(process.env) direto" convivem:**
`SendPolicyEnv` usa os MESMOS nomes de `process.env` do §10 (`APP_TIMEZONE`, `DISPATCH_QUIET_HOURS_START`,
`DISPATCH_JITTER_MIN_S`...) e por isso `apps/web` chama `resolveSendPolicy(process.env)` direto, sem
parsing próprio. Gotcha de TypeScript: um tipo com SÓ propriedades opcionais é "fraco" — TS recusa
`process.env` (que só expõe essas chaves via índice, não como propriedade nomeada) com `TS2559 (no
properties in common)`. Fix: `SendPolicyEnv` precisa de uma assinatura de índice
`[key: string]: string | undefined` ALÉM das chaves nomeadas — sem ela o tipo compila sozinho mas
`resolveSendPolicy(process.env)` não. Testado explicitamente (`send-policy.test.ts`, "aceita process.env
real").

Religuei `messages.ts` para chamar `resolveSendPolicy(process.env)` UMA VEZ (`sendPolicy`) em vez das 5
funções privadas que faziam a mesma conta (`quietHoursFromEnv`/`businessWindowFromEnv`/
`sendWindowConfigFromEnv`/`jitterRangeSecondsFromEnv`/`microPauseConfigFromEnv`) — "um único lugar com
os clamps" valia tanto para o pacote quanto para o único call site real. `APP_TIMEZONE()` continua em
`messages.ts` (helper de 1 linha, usado em outros 3 lugares fora da política de envio) — não vale a pena
puxar `DEFAULT_SEND_WINDOW_CONFIG` só por esse default, uso o mesmo literal `'America/Sao_Paulo'` que os
outros dois serviços já usam.

**`daysOfWeek` + `resolveCampaignWindow` — A32 (a campanha só ESTREITA, nunca alarga):**
`isWithinBusinessWindow` trocou o hardcode `weekday===0||6` por `allowedDays.includes(weekday)`, com
`allowedDays = config.businessWindow.daysOfWeek ?? BUSINESS_WINDOW_DEFAULT_DAYS_OF_WEEK` — comportamento
IDÊNTICO quando `daysOfWeek` está ausente (testado). `resolveCampaignWindow(pisoDaEnv, campanha)`
INTERSECTA (`Array.filter`, não union) os dias do piso com os da campanha, e clampa startHour/endHour com
`Math.max`/`Math.min` contra o piso — por isso uma campanha pedindo sábado/domingo nunca os ganha (o piso
nem os tem para oferecer) e uma campanha pedindo 06h–23h não alarga o 09h–18h do piso. `quietHours`
(G5) e `lunchBreak` nunca são tocados por esta função — campanha não tem esses campos, e não deveria ter.
**Não liguei isto em nenhum call site de `apps/web` ainda** — quem lê `Campaign.sendWindowDaysOfWeek`
hoje é só `campaign-estimate` (para ESTIMAR data de término, não para decidir se envia); o primeiro
consumidor real da interseção é o tick (4.F.4).

**`pickInstanceWeighted(candidates, rng?)` — reaproveita `RandomSource` de `jitter.ts`, não duplica o
tipo.** Peso = `Math.max(0, quotaRemaining) × (isDegraded ? 0.3 : 1)`; sorteio proporcional por soma
cumulativa. `null` quando a lista é vazia OU todo peso é zero (cota esgotada em todas) — quem chama (o
tick) decide soltar o alvo, não esta função. Teste de distribuição com 10k sorteios e tolerância de
3 desvios-padrão da binomial (não é frouxa: uma implementação errada plausível — sorteio uniforme por
candidato ignorando o peso — erra por MILHARES de amostras num teste onde a banda válida é de ~150;
comentado no próprio teste o motivo do número).

**O que a experiência destas 4 peças ensina sobre o formato que o tick (4.F.4) vai querer, registrado
para quem pegar a próxima rodada:**
1. O tick vai chamar `resolveSendPolicy(process.env)` UMA VEZ por execução do job (não por alvo) e depois
   `resolveCampaignWindow(policy.sendWindow, campanha)` POR CAMPANHA dentro do loop — os dois níveis são
   claramente separados agora, e é assim que devem continuar (piso global resolvido 1x, janela por
   campanha resolvida a cada iteração da campanha, nunca por alvo).
2. `pickInstanceWeighted` espera candidatos JÁ FILTRADOS por elegibilidade (conectada, dentro da janela,
   cota > 0 checada por fora) — ela só faz o sorteio proporcional. O passo "ninguém elegível → soltar o
   alvo" (§6.8.4 item 3) é decisão de QUEM CHAMA, antes de chamar esta função (lista vazia) ou depois
   (`null` de volta).
3. `localDateKey` precisa do MESMO `tz` em toda a chamada de um tick — se o tick ler `APP_TIMEZONE` uma
   vez no topo do job e não recalcular por alvo, evita o risco que a ARQUITETURA §6.8.0.4 já documentava
   (fuso divergente entre chamadas dentro do mesmo processo).

**Testes:** `local-date-key.test.ts` (6), `send-policy.test.ts` (15 — piso do jitter não contornável,
janela comercial sem clamp, timezone, micro-pausa fora de ordem, `process.env` real),
`instance-selection.test.ts` (7 — bordas + 2 testes de distribuição 10k), `send-window.test.ts` (+7 —
`daysOfWeek` e as 4 facetas de `resolveCampaignWindow`). `pnpm test` na raiz: 766 (era 731 antes desta
rodada). `pnpm typecheck` (turbo, 10 pacotes) e `pnpm lint` limpos.

Relacionado: `[[convention-cadencia-jitter-pace-lock]]` (`RandomSource`/`JitterRangeSeconds`/
`MicroPauseConfig` reaproveitados aqui), `[[convention-sending-extraction-fase4f]]` (o pacote que a 4.F.4
vai ligar a estas peças), `[[prisma-datetime-sem-fuso]]` (memória global — a armadilha que
`localDateKey` existe para não repetir uma quinta vez).
