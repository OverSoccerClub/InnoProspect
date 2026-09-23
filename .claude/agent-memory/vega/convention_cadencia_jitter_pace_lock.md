---
name: convention-cadencia-jitter-pace-lock
description: Fase 4.B — packages/core/src/whatsapp/jitter.ts (drawLogNormalJitterMs/shouldTriggerMicroPause/advanceSendPace) e G9b/G9c em send-guard.ts (LEAD_CONTACT_COOLDOWN/SEND_PACE_LOCKED)
metadata:
  type: project
---

Entregue 2026-09-23 (Fase 4.B, ARQUITETURA §4.9.10/§6.3/§6.8.7). Puro, sem banco/I/O — a ligação
(escrever `nextSendAllowedAt`/`sendsSinceMicroPause` de verdade, ler `lastInboundAt` do Postgres) é a
Fase 4.C, rodada seguinte, feita por outra frente. Trabalhei em paralelo com o Cronos modelando o
schema (`WhatsAppInstance.nextSendAllowedAt/sendsSinceMicroPause/consecutiveUncertain`,
`CampaignInstance.sentCount/failedCount`) — não toquei `packages/db/**`.

**Arquivos:**
- `packages/core/src/whatsapp/jitter.ts` (novo) — `drawLogNormalJitterMs`, `shouldTriggerMicroPause`,
  `drawMicroPauseMs`, `advanceSendPace`. Exportado em `packages/core/src/index.ts`.
- `packages/core/src/whatsapp/send-guard.ts` — G9b (`LEAD_CONTACT_COOLDOWN`) e G9c
  (`SEND_PACE_LOCKED`) adicionados a `evaluateSendGuard`, entre G9 (dup 60s) e G10.

**Assinaturas exatas (a Fase 4.C consome sem ver este código):**
```ts
export type RandomSource = () => number; // uniforme [0,1), default Math.random

export type JitterRangeSeconds = { minSeconds: number; maxSeconds: number };
export const DEFAULT_JITTER_RANGE_SECONDS: JitterRangeSeconds; // {45,180}

export type MicroPauseConfig = { everyMin: number; everyMax: number; pauseMinSeconds: number; pauseMaxSeconds: number };
export const DEFAULT_MICRO_PAUSE_CONFIG: MicroPauseConfig; // {18,25,300,720}

export function drawLogNormalJitterMs(rangeSeconds?: JitterRangeSeconds, rng?: RandomSource): number;
export function shouldTriggerMicroPause(sendsSinceMicroPause: number, config?: MicroPauseConfig, rng?: RandomSource): boolean;
export function drawMicroPauseMs(config?: MicroPauseConfig, rng?: RandomSource): number;

export type PaceAdvanceMode = 'full' | 'floor';
export type AdvanceSendPaceInput = { now: Date; sendsSinceMicroPause: number; mode?: PaceAdvanceMode; jitterRangeSeconds?: JitterRangeSeconds; microPause?: MicroPauseConfig; rng?: RandomSource };
export type AdvanceSendPaceResult = { nextSendAllowedAt: Date; sendsSinceMicroPause: number; microPauseTriggered: boolean; jitterMs: number };
export function advanceSendPace(input: AdvanceSendPaceInput): AdvanceSendPaceResult;
```
Chamar `advanceSendPace` DEPOIS de todo `sendText` (sucesso, falha OU incerto — §6.8.7), modo `'full'`
por padrão (campanha + manual 1º contato frio), modo `'floor'` só quando
`overrides.ignorePaceLock` foi de fato honrado pelo guard (resposta em conversa aberta) — nesse modo
`jitterMs` é sempre `jitterRangeSeconds.minSeconds*1000`, sem sorteio, e `sendsSinceMicroPause` NÃO é
tocado (decisão minha, ver gap abaixo).

**Matemática do jitter, e por quê:** log-normal parametrizada pela MEDIANA GEOMÉTRICA do range
(`sqrt(min*max)`), sigma fixo `JITTER_LOG_NORMAL_SIGMA = 0.5` (não vem de env — só min/max vêm,
ARQUITETURA §10). Com os defaults 45–180s isso dá moda ≈70s (`90 × e^-0.25`), batendo o número exato
que a ARQUITETURA §6.3 cita. Se min/max mudarem via env, a moda acompanha proporcionalmente (a fórmula
é sempre relativa ao range configurado, não hardcoded em segundos absolutos). Amostra por
Box-Muller + REJEIÇÃO até 64 tentativas se cair fora de `[min,max]` (não clampa — clampar empilharia
probabilidade artificial nas bordas e distorceria a curva testável).

**Micro-pausa sem campo extra no schema:** o Cronos só criou `sendsSinceMicroPause` (contador), não um
"limiar da vez". `shouldTriggerMicroPause` resorteia o limiar (18–25) A CADA chamada e compara contra o
contador — não é "um limiar fixo guardado", é um processo tipo hazard memoryless. Os extremos são
DETERMINÍSTICOS de propósito (nunca dispara `<everyMin`, sempre dispara `>=everyMax`) para o
comportamento nunca escapar da banda prometida mesmo resorteando toda vez. Testado explicitamente
(`shouldTriggerMicroPause` com RNG `()=>0` e `()=>0.999999` nos extremos).

**Gap preenchido, não decidido em silêncio — modo `'floor'` não toca `sendsSinceMicroPause`:** a
ARQUITETURA §4.9.10 só diz "empurra o gate com o piso do jitter" para resposta em conversa aberta, sem
mencionar a micro-pausa. Decidi que essa resposta NÃO conta para o contador de micro-pausa da
campanha — contar criaria a possibilidade de uma resposta humana disparar uma pausa de 5–12min no meio
de uma conversa, exatamente o oposto do que a exceção existe para fazer. Documentado no código e aqui;
se a Nova revisar, é o único ponto onde preenchi um buraco do documento em vez de seguir letra morta.

**G9b/G9c em `send-guard.ts` — compat retroativa sem tocar `apps/web`:** os 3 facts novos
(`instance.nextSendAllowedAt`, `lastInboundAt`, `overrides.ignorePaceLock`) são OPCIONAIS no tipo.
`undefined` = chamador não ligado ainda (gate inerte, comportamento IDÊNTICO ao de antes desta
rodada — `apps/web/src/lib/services/messages.ts` não foi tocado e continua passando `SendGuardFacts`
sem esses campos). `null`/`Date` explícitos = o chamador foi ligado e está DECLARANDO o estado real.
A distinção crítica é `=== null` estrito (não `!facts.lastInboundAt`) — verificado com
`pnpm --filter web typecheck` e `pnpm --filter worker typecheck` passando limpos (literal object de
`messages.ts` continua satisfazendo o tipo sem alteração nenhuma). Sem essa distinção, `undefined`
seria tratado como "nunca respondeu" e o G9b bloquearia em produção HOJE sem nenhuma ligação ter sido
feita — bug que só apareceria depois do merge, não nos testes deste pacote.

**Override anulado DENTRO do guard, nunca no chamador:** `ignorePaceLock` só vale quando
`isColdFirstContact === false`; se `true`, o guard ignora a flag que veio de fora. Isto é o próprio
requisito do §4.9.10 ("um chamador não consegue liberar o gate para um contato frio nem mentindo") —
ver teste "1º contato frio: bloqueia MESMO com ignorePaceLock:true".

**Testes:** `packages/core/src/whatsapp/jitter.test.ts` (18) — determinismo (mesma seed = mesmo
resultado), limites respeitados (1000 amostras dentro de `[min,max]`), prova de NÃO-uniformidade
(média > mediana = assimetria; concentração >50% perto da moda numa faixa que uma uniforme teria
~37%), extremos determinísticos da micro-pausa, e os dois modos de `advanceSendPace`.
`send-guard.test.ts` (+18) — compat retroativa (facts ausentes = comportamento antigo), G9b (bloqueia/
permite/cooldown configurável), G9c nos 3 instantes (antes/igual/depois do gate), override anulado em
1º contato frio, override honrado + warning em resposta, gate `null` explícito não bloqueia.

`pnpm test` na raiz: 519 testes verdes (era ~473 antes desta rodada — outras frentes também
adicionaram testes em paralelo). `pnpm --filter @inno/core typecheck/lint`, `pnpm --filter web
typecheck`, `pnpm --filter worker typecheck` todos limpos. `pnpm typecheck` NA RAIZ (via turbo) falhou
por `@inno/db#generate` (EPERM Windows, processo com o client Prisma já carregado) — gotcha já
registrado em `[[convention-sanity-a5-enrichment]]`, não é bug deste código; typecheck por pacote
prova os tipos.

Relacionado: `[[convention-envio-unitario-send-guard]]` (G1-G11 original), `[[project-innoprospect]]`.
