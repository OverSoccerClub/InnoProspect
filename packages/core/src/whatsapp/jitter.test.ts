import { describe, expect, it } from 'vitest';
import {
  advanceSendPace,
  DEFAULT_JITTER_RANGE_SECONDS,
  DEFAULT_MICRO_PAUSE_CONFIG,
  MIN_JITTER_FLOOR_SECONDS,
  drawLogNormalJitterMs,
  drawMicroPauseMs,
  resolveCampaignJitter,
  shouldTriggerMicroPause,
  type RandomSource,
} from './jitter';

/** PRNG determinístico (mulberry32) — mesma seed sempre dá a mesma sequência, sem depender de `Math.random`. */
function seededRng(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('drawLogNormalJitterMs — determinismo', () => {
  it('a mesma seed produz exatamente o mesmo resultado', () => {
    const a = drawLogNormalJitterMs(DEFAULT_JITTER_RANGE_SECONDS, seededRng(42));
    const b = drawLogNormalJitterMs(DEFAULT_JITTER_RANGE_SECONDS, seededRng(42));
    expect(a).toBe(b);
  });

  it('seeds diferentes produzem resultados diferentes (não é uma constante disfarçada)', () => {
    const a = drawLogNormalJitterMs(DEFAULT_JITTER_RANGE_SECONDS, seededRng(1));
    const b = drawLogNormalJitterMs(DEFAULT_JITTER_RANGE_SECONDS, seededRng(2));
    expect(a).not.toBe(b);
  });
});

describe('drawLogNormalJitterMs — respeita os limites configurados', () => {
  it('1000 amostras (seeds 0..999) caem todas dentro de [min,max]', () => {
    const minMs = DEFAULT_JITTER_RANGE_SECONDS.minSeconds * 1000;
    const maxMs = DEFAULT_JITTER_RANGE_SECONDS.maxSeconds * 1000;
    for (let seed = 0; seed < 1000; seed++) {
      const sample = drawLogNormalJitterMs(DEFAULT_JITTER_RANGE_SECONDS, seededRng(seed));
      expect(sample).toBeGreaterThanOrEqual(minMs);
      expect(sample).toBeLessThanOrEqual(maxMs);
    }
  });

  it('respeita um range customizado (piso 30s, teto 60s)', () => {
    const range = { minSeconds: 30, maxSeconds: 60 };
    for (let seed = 0; seed < 200; seed++) {
      const sample = drawLogNormalJitterMs(range, seededRng(seed));
      expect(sample).toBeGreaterThanOrEqual(30_000);
      expect(sample).toBeLessThanOrEqual(60_000);
    }
  });
});

describe('drawLogNormalJitterMs — a distribuição NÃO é uniforme', () => {
  it('a moda fica perto de ~70s (mediana geométrica × exp(-sigma²)) — amostras concentram abaixo do centro do range', () => {
    const samples: number[] = [];
    for (let seed = 0; seed < 3000; seed++) {
      samples.push(drawLogNormalJitterMs(DEFAULT_JITTER_RANGE_SECONDS, seededRng(seed)));
    }
    const sorted = [...samples].sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const mean = samples.reduce((sum, v) => sum + v, 0) / samples.length;

    // Assinatura de log-normal: média > mediana (assimetria à direita — cauda
    // longa). Uma distribuição uniforme em [45000,180000] teria média ≈
    // mediana ≈ 112500, sem essa assimetria.
    expect(mean).toBeGreaterThan(median);

    // Centro geométrico do range (mediana da log-normal, por construção) —
    // longe da média aritmética de uma uniforme (112500ms), prova de que a
    // curva não está distribuída de forma linear/plana no intervalo.
    const rangeMidpointMs = ((DEFAULT_JITTER_RANGE_SECONDS.minSeconds + DEFAULT_JITTER_RANGE_SECONDS.maxSeconds) / 2) * 1000;
    expect(median).toBeLessThan(rangeMidpointMs * 0.85);
  });

  it('mais de 90% das amostras rejeitadas nas bordas seriam esperadas numa uniforme perfeita — aqui a maioria fica perto da moda (60-90s)', () => {
    let nearMode = 0;
    const total = 2000;
    for (let seed = 0; seed < total; seed++) {
      const sample = drawLogNormalJitterMs(DEFAULT_JITTER_RANGE_SECONDS, seededRng(seed));
      if (sample >= 50_000 && sample <= 100_000) nearMode++;
    }
    // Uma uniforme em [45000,180000] teria só ~37% das amostras nessa faixa de 50s;
    // a log-normal concentra muito mais massa perto da moda.
    expect(nearMode / total).toBeGreaterThan(0.5);
  });
});

describe('shouldTriggerMicroPause — piso e teto são determinísticos', () => {
  it('nunca dispara abaixo de everyMin, mesmo com um RNG que sempre devolve 0 (o menor limiar possível)', () => {
    const alwaysZero: RandomSource = () => 0;
    for (let count = 0; count < DEFAULT_MICRO_PAUSE_CONFIG.everyMin; count++) {
      expect(shouldTriggerMicroPause(count, DEFAULT_MICRO_PAUSE_CONFIG, alwaysZero)).toBe(false);
    }
  });

  it('sempre dispara a partir de everyMax, mesmo com um RNG que sempre devolve o maior limiar possível', () => {
    const almostOne: RandomSource = () => 0.999999;
    for (let count = DEFAULT_MICRO_PAUSE_CONFIG.everyMax; count <= DEFAULT_MICRO_PAUSE_CONFIG.everyMax + 3; count++) {
      expect(shouldTriggerMicroPause(count, DEFAULT_MICRO_PAUSE_CONFIG, almostOne)).toBe(true);
    }
  });

  it('dentro da banda [everyMin,everyMax), o resultado depende do RNG (não é sempre true nem sempre false)', () => {
    const results = new Set<boolean>();
    for (let seed = 0; seed < 200; seed++) {
      results.add(shouldTriggerMicroPause(20, DEFAULT_MICRO_PAUSE_CONFIG, seededRng(seed)));
    }
    expect(results.size).toBe(2);
  });

  it('mesma seed dá o mesmo resultado (determinismo)', () => {
    const a = shouldTriggerMicroPause(19, DEFAULT_MICRO_PAUSE_CONFIG, seededRng(7));
    const b = shouldTriggerMicroPause(19, DEFAULT_MICRO_PAUSE_CONFIG, seededRng(7));
    expect(a).toBe(b);
  });
});

describe('drawMicroPauseMs — respeita os limites configurados', () => {
  it('1000 amostras caem todas dentro de [pauseMinSeconds,pauseMaxSeconds]', () => {
    const minMs = DEFAULT_MICRO_PAUSE_CONFIG.pauseMinSeconds * 1000;
    const maxMs = DEFAULT_MICRO_PAUSE_CONFIG.pauseMaxSeconds * 1000;
    for (let seed = 0; seed < 1000; seed++) {
      const sample = drawMicroPauseMs(DEFAULT_MICRO_PAUSE_CONFIG, seededRng(seed));
      expect(sample).toBeGreaterThanOrEqual(minMs);
      expect(sample).toBeLessThanOrEqual(maxMs);
    }
  });

  it('determinístico com a mesma seed', () => {
    expect(drawMicroPauseMs(DEFAULT_MICRO_PAUSE_CONFIG, seededRng(3))).toBe(drawMicroPauseMs(DEFAULT_MICRO_PAUSE_CONFIG, seededRng(3)));
  });
});

describe('advanceSendPace — modo "full" (padrão)', () => {
  const NOW = new Date('2026-09-23T13:00:00.000Z');

  it('empurra o gate por um jitter dentro do range e incrementa sendsSinceMicroPause quando NÃO cruza o limiar', () => {
    const alwaysZero: RandomSource = () => 0; // nunca dispara micro-pausa (count=1 < everyMin=18)
    const result = advanceSendPace({ now: NOW, sendsSinceMicroPause: 0, rng: alwaysZero });
    expect(result.microPauseTriggered).toBe(false);
    expect(result.sendsSinceMicroPause).toBe(1);
    expect(result.nextSendAllowedAt.getTime()).toBeGreaterThan(NOW.getTime());
    expect(result.jitterMs).toBeGreaterThanOrEqual(DEFAULT_JITTER_RANGE_SECONDS.minSeconds * 1000);
    expect(result.jitterMs).toBeLessThanOrEqual(DEFAULT_JITTER_RANGE_SECONDS.maxSeconds * 1000);
  });

  it('ao cruzar o limiar (contador chegando em everyMax), dispara micro-pausa e ZERA o contador', () => {
    const almostOne: RandomSource = () => 0.999999; // garante disparo em everyMax
    const result = advanceSendPace({ now: NOW, sendsSinceMicroPause: DEFAULT_MICRO_PAUSE_CONFIG.everyMax - 1, rng: almostOne });
    expect(result.microPauseTriggered).toBe(true);
    expect(result.sendsSinceMicroPause).toBe(0);
    expect(result.jitterMs).toBeGreaterThanOrEqual(DEFAULT_MICRO_PAUSE_CONFIG.pauseMinSeconds * 1000);
    expect(result.jitterMs).toBeLessThanOrEqual(DEFAULT_MICRO_PAUSE_CONFIG.pauseMaxSeconds * 1000);
  });

  it('determinístico: mesma seed, mesmo now, mesmo sendsSinceMicroPause → mesmo resultado', () => {
    const a = advanceSendPace({ now: NOW, sendsSinceMicroPause: 5, rng: seededRng(11) });
    const b = advanceSendPace({ now: NOW, sendsSinceMicroPause: 5, rng: seededRng(11) });
    expect(a).toEqual(b);
  });
});

describe('advanceSendPace — modo "floor" (resposta a conversa aberta, override ignorePaceLock)', () => {
  const NOW = new Date('2026-09-23T13:00:00.000Z');

  it('empurra o gate exatamente pelo PISO do range, sem depender do RNG', () => {
    const result = advanceSendPace({ now: NOW, sendsSinceMicroPause: 10, mode: 'floor' });
    expect(result.jitterMs).toBe(DEFAULT_JITTER_RANGE_SECONDS.minSeconds * 1000);
    expect(result.nextSendAllowedAt).toEqual(new Date(NOW.getTime() + DEFAULT_JITTER_RANGE_SECONDS.minSeconds * 1000));
  });

  it('NÃO altera sendsSinceMicroPause — uma resposta não pode disparar a micro-pausa da campanha', () => {
    const result = advanceSendPace({ now: NOW, sendsSinceMicroPause: 24, mode: 'floor' });
    expect(result.sendsSinceMicroPause).toBe(24);
    expect(result.microPauseTriggered).toBe(false);
  });

  it('respeita um jitterRangeSeconds customizado', () => {
    const result = advanceSendPace({ now: NOW, sendsSinceMicroPause: 0, mode: 'floor', jitterRangeSeconds: { minSeconds: 30, maxSeconds: 90 } });
    expect(result.jitterMs).toBe(30_000);
  });
});

describe('resolveCampaignJitter (Fase 4.F.4, ARQUITETURA §6.8.10/A32 — campanha só estreita)', () => {
  const ENV_RANGE = { minSeconds: 45, maxSeconds: 180 };

  it('campanha dentro do piso da env: usa exatamente o range da campanha', () => {
    const result = resolveCampaignJitter(ENV_RANGE, { minSeconds: 60, maxSeconds: 120 });
    expect(result).toEqual({ minSeconds: 60, maxSeconds: 120 });
  });

  it('campanha pede um mínimo MENOR que o piso da env: o piso da env vence (nunca alarga)', () => {
    const result = resolveCampaignJitter(ENV_RANGE, { minSeconds: 10, maxSeconds: 120 });
    expect(result.minSeconds).toBe(ENV_RANGE.minSeconds);
  });

  it('campanha pede um máximo MAIOR que o teto da env: o teto da env vence', () => {
    const result = resolveCampaignJitter(ENV_RANGE, { minSeconds: 60, maxSeconds: 999 });
    expect(result.maxSeconds).toBe(ENV_RANGE.maxSeconds);
  });

  it('campanha totalmente fora do range da env (min > env.max): nunca inverte — max cai para o min resultante', () => {
    const result = resolveCampaignJitter(ENV_RANGE, { minSeconds: 500, maxSeconds: 600 });
    // minSeconds = max(45,500) = 500; maxSeconds = min(180,600) = 180 — invertido
    // (180 < 500), então cai no ponto seguro: maxSeconds = minSeconds.
    expect(result.minSeconds).toBeLessThanOrEqual(result.maxSeconds);
    expect(result).toEqual({ minSeconds: 500, maxSeconds: 500 });
  });

  it('respeita o piso duro MIN_JITTER_FLOOR_SECONDS quando já embutido no envRange (resolveSendPolicy é quem garante isso antes de chamar)', () => {
    const result = resolveCampaignJitter({ minSeconds: MIN_JITTER_FLOOR_SECONDS, maxSeconds: 180 }, { minSeconds: 1, maxSeconds: 5 });
    expect(result.minSeconds).toBe(MIN_JITTER_FLOOR_SECONDS);
  });
});
