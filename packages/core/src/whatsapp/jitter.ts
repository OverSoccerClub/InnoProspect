/**
 * whatsapp/jitter.ts — políticas puras de CADÊNCIA (ARQUITETURA §6.3/§6.8.7),
 * Fase 4.B. Responde uma pergunta só: "depois deste envio, quando o gate
 * (`WhatsAppInstance.nextSendAllowedAt`) libera de novo?" — e nada mais. Este
 * módulo não decide SE pode enviar agora (isso é `send-guard.ts`, G9c); não
 * lê banco, Redis, `Date.now()` nem `process.env`; e não é chamado por nada
 * nesta rodada — a ligação (escrever o resultado no Postgres depois de um
 * `sendText`) é da Fase 4.C, que consome só as assinaturas abaixo.
 *
 * Por que RNG injetável em toda função: sem isso não existe teste de
 * distribuição determinístico — só "rodou sem lançar". `rng` é sempre
 * `() => number` uniforme em [0,1), com `Math.random` como default de
 * produção; os testes passam um gerador com seed fixa.
 */

/** Fonte de aleatoriedade uniforme em [0,1) — injetável para teste (mesma seed = mesmo resultado). */
export type RandomSource = () => number;

export type JitterRangeSeconds = { minSeconds: number; maxSeconds: number };

/** ARQUITETURA §6.3/§10 (`DISPATCH_JITTER_MIN_S`/`MAX_S`) — 45–180s, moda ~70s. */
export const DEFAULT_JITTER_RANGE_SECONDS: JitterRangeSeconds = { minSeconds: 45, maxSeconds: 180 };

/**
 * Piso absoluto do jitter (ARQUITETURA §6.3: "configurável, mín. 30s") — quem
 * monta `JitterRangeSeconds` a partir da env (Fase 4.C) aplica este piso;
 * este módulo não lê env, só documenta o número para não duplicar em dois
 * lugares (mesmo padrão de `OPT_OUT_MAX_AGE_MS` em `send-guard.ts`).
 */
export const MIN_JITTER_FLOOR_SECONDS = 30;

export type MicroPauseConfig = {
  /** Menor nº de envios seguidos antes de UMA micro-pausa poder disparar (§10 `DISPATCH_MICRO_PAUSE_EVERY_MIN`). */
  everyMin: number;
  /** A partir deste nº de envios seguidos, a micro-pausa SEMPRE dispara (§10 `DISPATCH_MICRO_PAUSE_EVERY_MAX`). */
  everyMax: number;
  /** Duração mínima da pausa, em segundos (§10 `DISPATCH_MICRO_PAUSE_MIN_S`). */
  pauseMinSeconds: number;
  /** Duração máxima da pausa, em segundos (§10 `DISPATCH_MICRO_PAUSE_MAX_S`). */
  pauseMaxSeconds: number;
};

/** ARQUITETURA §6.3/§10 — a cada 18–25 envios, uma pausa de 5–12min. */
export const DEFAULT_MICRO_PAUSE_CONFIG: MicroPauseConfig = {
  everyMin: 18,
  everyMax: 25,
  pauseMinSeconds: 5 * 60,
  pauseMaxSeconds: 12 * 60,
};

/**
 * Forma da log-normal do jitter regular — FIXA, não configurável via env
 * (a ARQUITETURA só expõe `min`/`max` em §10; a "forma" da curva é decisão
 * de código, não de operação). Derivado assim: com os defaults 45–180s, a
 * mediana geométrica é `sqrt(45*180) ≈ 90s`, e a moda de uma log-normal é
 * `mediana × exp(-sigma²)`. Com `sigma = 0.5`, a moda cai em `90 × e^-0.25 ≈
 * 70s` — exatamente o "moda em torno de ~70s" que a ARQUITETURA §6.3 pede.
 * Se `min`/`max` mudarem via env, a moda acompanha proporcionalmente (a
 * fórmula é sempre relativa à mediana geométrica do range configurado).
 */
export const JITTER_LOG_NORMAL_SIGMA = 0.5;

/** Limite de tentativas de rejeição antes de cair no fallback determinístico — nunca deveria ser atingido com um RNG uniforme real (ver `drawLogNormalJitterMs`). */
const MAX_REJECTION_ATTEMPTS = 64;

/**
 * Amostra padrão normal N(0,1) via Box-Muller, consumindo 2 números do RNG.
 * `u1 <= 0` é guardado (log(0) = -Infinity) — só pode acontecer com um RNG de
 * teste malformado; RNGs reais (`Math.random`, seeded PRNGs) nunca devolvem
 * exatamente 0 na prática, mas o guard existe para a função nunca lançar.
 */
function drawStandardNormal(rng: RandomSource): number {
  let u1 = rng();
  if (!(u1 > 0)) u1 = Number.EPSILON;
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Uniforme em `[minMs, maxMs]` — usado onde a ARQUITETURA não pede log-normal (duração da micro-pausa, §6.8.7: só "sorteado em 5–12min", sem exigir cauda longa). */
function drawUniformMs(minMs: number, maxMs: number, rng: RandomSource): number {
  return minMs + rng() * (maxMs - minMs);
}

/**
 * O intervalo (em ms) até o próximo envio permitido pela mesma instância,
 * ARQUITETURA §6.3/§6.8.7. Distribuição **log-normal**, não uniforme — um
 * intervalo constante (ou uniforme, que tem média perfeitamente estável) é a
 * assinatura de bot mais fácil de detectar do lado do WhatsApp; log-normal
 * concentra a massa perto da moda e ainda deixa uma cauda longa ocasional,
 * que é como intervalos humanos de fato se distribuem.
 *
 * Rejeita e resorteia amostras fora de `[min,max]` (em vez de simplesmente
 * "clampar" no limite) para não empilhar probabilidade artificial nas
 * bordas — isso preservaria a forma da curva quase intacta. Com sigma=0.5 e
 * os defaults, a chance de precisar de mais de poucas tentativas é
 * desprezível; o fallback determinístico (mediana geométrica, sempre dentro
 * do range) só existe para a função nunca entrar em loop infinito com um RNG
 * adversarial de teste.
 */
export function drawLogNormalJitterMs(rangeSeconds: JitterRangeSeconds = DEFAULT_JITTER_RANGE_SECONDS, rng: RandomSource = Math.random): number {
  const minMs = rangeSeconds.minSeconds * 1000;
  const maxMs = rangeSeconds.maxSeconds * 1000;
  const geometricMedianMs = Math.sqrt(minMs * maxMs);
  const mu = Math.log(geometricMedianMs);

  for (let attempt = 0; attempt < MAX_REJECTION_ATTEMPTS; attempt++) {
    const z = drawStandardNormal(rng);
    const sampleMs = Math.exp(mu + JITTER_LOG_NORMAL_SIGMA * z);
    if (sampleMs >= minMs && sampleMs <= maxMs) return sampleMs;
  }
  return Math.min(maxMs, Math.max(minMs, geometricMedianMs));
}

/**
 * `true` se o envio de nº `sendsSinceMicroPause` (JÁ incrementado para
 * incluir o envio atual) deve disparar a micro-pausa longa.
 *
 * Por que resortear o limiar a cada chamada em vez de sortear uma vez e
 * guardar: o schema (`WhatsAppInstance.sendsSinceMicroPause`, pedido ao
 * Cronos no §6.8.1) tem só o CONTADOR, não um "limiar da vez" — de propósito,
 * para não crescer o schema por um detalhe de distribuição. Sem esse campo
 * extra, a única forma pura de "um limiar sorteado em 18–25" é resortear a
 * cada envio e comparar contra o contador corrente. Os limites `everyMin`/
 * `everyMax` são respeitados de forma DETERMINÍSTICA (não dependem do
 * sorteio): abaixo de `everyMin` nunca dispara, em `everyMax` ou mais sempre
 * dispara — o sorteio só decide o "quando exatamente" dentro dessa banda.
 */
export function shouldTriggerMicroPause(
  sendsSinceMicroPause: number,
  config: MicroPauseConfig = DEFAULT_MICRO_PAUSE_CONFIG,
  rng: RandomSource = Math.random,
): boolean {
  if (sendsSinceMicroPause < config.everyMin) return false;
  if (sendsSinceMicroPause >= config.everyMax) return true;

  const span = config.everyMax - config.everyMin;
  const threshold = config.everyMin + Math.floor(rng() * (span + 1));
  return sendsSinceMicroPause >= threshold;
}

/** Duração (ms) de UMA micro-pausa — uniforme dentro do range configurado (ver `drawUniformMs`). */
export function drawMicroPauseMs(config: MicroPauseConfig = DEFAULT_MICRO_PAUSE_CONFIG, rng: RandomSource = Math.random): number {
  return drawUniformMs(config.pauseMinSeconds * 1000, config.pauseMaxSeconds * 1000, rng);
}

/**
 * Modo de avanço do gate — ver ARQUITETURA §4.9.10 (tabela "as duas
 * cadências"). `'full'` é o caminho normal (campanha, e manual em 1º contato
 * frio): jitter log-normal cheio + participa da contagem de micro-pausa.
 * `'floor'` é a EXCEÇÃO documentada para resposta a conversa aberta
 * (`overrides.ignorePaceLock` no guard): empurra o gate só pelo PISO do
 * range (`jitterSeconds.min`), sem sorteio e sem tocar a micro-pausa.
 */
export type PaceAdvanceMode = 'full' | 'floor';

export type AdvanceSendPaceInput = {
  /** Instante do envio que acabou de acontecer (sucesso, falha OU incerto — ARQUITETURA §6.8.7: "depois de TODO envio"). */
  now: Date;
  /** `WhatsAppInstance.sendsSinceMicroPause` ANTES deste envio. Ignorado em modo `'floor'`. */
  sendsSinceMicroPause: number;
  /** Default `'full'`. */
  mode?: PaceAdvanceMode;
  jitterRangeSeconds?: JitterRangeSeconds;
  microPause?: MicroPauseConfig;
  rng?: RandomSource;
};

export type AdvanceSendPaceResult = {
  /** Novo valor de `WhatsAppInstance.nextSendAllowedAt`. */
  nextSendAllowedAt: Date;
  /** Novo valor de `WhatsAppInstance.sendsSinceMicroPause` (0 se a micro-pausa disparou; inalterado em modo `'floor'`). */
  sendsSinceMicroPause: number;
  /** Para telemetria/decisão de log (ARQUITETURA §6.8.8: nunca dado sensível, mas isto ajuda a explicar um gap grande na timeline). */
  microPauseTriggered: boolean;
  /** Intervalo sorteado, em ms — vai direto pro `logger.info` do §6.8.8 (`jitterMs`). */
  jitterMs: number;
};

/**
 * Função ÚNICA que a Fase 4.C chama depois de QUALQUER envio (sucesso, falha
 * confirmada ou incerto) para saber o novo `nextSendAllowedAt` +
 * `sendsSinceMicroPause` a persistir em `WhatsAppInstance` (§6.8.7, §6.8.3
 * passo `i`). Pura: não escreve nada, só calcula.
 *
 * Modo `'floor'` NÃO incrementa/zera `sendsSinceMicroPause` — decisão do
 * Vega, não coberta literalmente pela tabela do §4.9.10 (que só fala em
 * "empurra o gate com o piso", sem mencionar a micro-pausa para este caso).
 * Contar uma resposta de conversa aberta rumo à micro-pausa da CAMPANHA
 * criaria a possibilidade de uma resposta humana disparar uma pausa de
 * 5–12min bem no meio da conversa — o oposto do que a exceção existe para
 * fazer (§4.9.10: "bloquear isso seria fazer o produto atrapalhar o trabalho
 * que deveria acelerar"). Sinalizado aqui e no handoff — não é literal da
 * ARQUITETURA, é gap preenchido.
 */
export function advanceSendPace(input: AdvanceSendPaceInput): AdvanceSendPaceResult {
  const rng = input.rng ?? Math.random;
  const jitterRangeSeconds = input.jitterRangeSeconds ?? DEFAULT_JITTER_RANGE_SECONDS;
  const microPause = input.microPause ?? DEFAULT_MICRO_PAUSE_CONFIG;
  const mode = input.mode ?? 'full';

  if (mode === 'floor') {
    const jitterMs = jitterRangeSeconds.minSeconds * 1000;
    return {
      nextSendAllowedAt: new Date(input.now.getTime() + jitterMs),
      sendsSinceMicroPause: input.sendsSinceMicroPause,
      microPauseTriggered: false,
      jitterMs,
    };
  }

  const candidateCount = input.sendsSinceMicroPause + 1;
  if (shouldTriggerMicroPause(candidateCount, microPause, rng)) {
    const jitterMs = drawMicroPauseMs(microPause, rng);
    return {
      nextSendAllowedAt: new Date(input.now.getTime() + jitterMs),
      sendsSinceMicroPause: 0,
      microPauseTriggered: true,
      jitterMs,
    };
  }

  const jitterMs = drawLogNormalJitterMs(jitterRangeSeconds, rng);
  return {
    nextSendAllowedAt: new Date(input.now.getTime() + jitterMs),
    sendsSinceMicroPause: candidateCount,
    microPauseTriggered: false,
    jitterMs,
  };
}
