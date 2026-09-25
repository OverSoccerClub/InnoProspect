import { describe, expect, it } from 'vitest';
import { DEFAULT_JITTER_RANGE_SECONDS, DEFAULT_MICRO_PAUSE_CONFIG, MIN_JITTER_FLOOR_SECONDS } from './jitter';
import { DEFAULT_SEND_WINDOW_CONFIG } from './send-window';
import { resolveSendPolicy } from './send-policy';

describe('resolveSendPolicy — sem nenhuma env, cai exatamente nos defaults de @inno/core', () => {
  it('devolve sendWindow/jitterRangeSeconds/microPause iguais aos padrões', () => {
    const policy = resolveSendPolicy({});
    expect(policy.sendWindow).toEqual(DEFAULT_SEND_WINDOW_CONFIG);
    expect(policy.jitterRangeSeconds).toEqual(DEFAULT_JITTER_RANGE_SECONDS);
    expect(policy.microPause).toEqual(DEFAULT_MICRO_PAUSE_CONFIG);
  });
});

describe('resolveSendPolicy — piso duro (G5) só pode ser ESTREITADO pela env', () => {
  it('DISPATCH_QUIET_HOURS_START maior que o padrão estreita', () => {
    const policy = resolveSendPolicy({ DISPATCH_QUIET_HOURS_START: '9' });
    expect(policy.sendWindow.quietHours.startHour).toBe(9);
  });

  it('DISPATCH_QUIET_HOURS_START menor que o padrão é IGNORADO (não alarga o piso)', () => {
    const policy = resolveSendPolicy({ DISPATCH_QUIET_HOURS_START: '5' });
    expect(policy.sendWindow.quietHours.startHour).toBe(DEFAULT_SEND_WINDOW_CONFIG.quietHours.startHour);
  });

  it('DISPATCH_QUIET_HOURS_END menor que o padrão estreita; maior é ignorado', () => {
    expect(resolveSendPolicy({ DISPATCH_QUIET_HOURS_END: '18' }).sendWindow.quietHours.endHour).toBe(18);
    expect(resolveSendPolicy({ DISPATCH_QUIET_HOURS_END: '23' }).sendWindow.quietHours.endHour).toBe(
      DEFAULT_SEND_WINDOW_CONFIG.quietHours.endHour,
    );
  });
});

describe('resolveSendPolicy — janela comercial (G6) segue direto o valor da env, sem clamp contra o padrão', () => {
  it('aceita início mais cedo e fim mais tarde do que o padrão — é a env quem define a janela "oficial"', () => {
    const policy = resolveSendPolicy({ DISPATCH_WINDOW_START: '7', DISPATCH_WINDOW_END: '20' });
    expect(policy.sendWindow.businessWindow.startHour).toBe(7);
    expect(policy.sendWindow.businessWindow.endHour).toBe(20);
  });
});

describe('resolveSendPolicy — piso do jitter NUNCA é contornável pela env (MIN_JITTER_FLOOR_SECONDS)', () => {
  it('pedir 1s de mínimo é recusado — o piso de 30s prevalece', () => {
    const policy = resolveSendPolicy({ DISPATCH_JITTER_MIN_S: '1' });
    expect(policy.jitterRangeSeconds.minSeconds).toBe(MIN_JITTER_FLOOR_SECONDS);
  });

  it('pedir 0s (ou negativo, via string inválida) também é recusado', () => {
    expect(resolveSendPolicy({ DISPATCH_JITTER_MIN_S: '0' }).jitterRangeSeconds.minSeconds).toBe(MIN_JITTER_FLOOR_SECONDS);
  });

  it('um mínimo válido ACIMA do piso é respeitado (a env pode estreitar para MAIS cauteloso, nunca para menos)', () => {
    const policy = resolveSendPolicy({ DISPATCH_JITTER_MIN_S: '60' });
    expect(policy.jitterRangeSeconds.minSeconds).toBe(60);
  });

  it('máximo só é aceito se for maior que o mínimo resolvido; senão cai no padrão', () => {
    // min efetivo vira 60 (env), max pedido (50) é menor que o min efetivo → ignorado, cai no padrão (180).
    const policy = resolveSendPolicy({ DISPATCH_JITTER_MIN_S: '60', DISPATCH_JITTER_MAX_S: '50' });
    expect(policy.jitterRangeSeconds.maxSeconds).toBe(DEFAULT_JITTER_RANGE_SECONDS.maxSeconds);
  });
});

describe('resolveSendPolicy — micro-pausa: env fora de ordem cai no padrão, nunca em NaN', () => {
  it('everyMax menor que everyMin é ignorado', () => {
    const policy = resolveSendPolicy({ DISPATCH_MICRO_PAUSE_EVERY_MIN: '20', DISPATCH_MICRO_PAUSE_EVERY_MAX: '10' });
    expect(policy.microPause.everyMin).toBe(20);
    expect(policy.microPause.everyMax).toBe(DEFAULT_MICRO_PAUSE_CONFIG.everyMax);
  });

  it('pauseMaxSeconds menor que pauseMinSeconds é ignorado', () => {
    const policy = resolveSendPolicy({ DISPATCH_MICRO_PAUSE_MIN_S: '600', DISPATCH_MICRO_PAUSE_MAX_S: '100' });
    expect(policy.microPause.pauseMinSeconds).toBe(600);
    expect(policy.microPause.pauseMaxSeconds).toBe(DEFAULT_MICRO_PAUSE_CONFIG.pauseMaxSeconds);
  });

  it('valor não numérico (env quebrada) não gera NaN — cai no padrão', () => {
    const policy = resolveSendPolicy({ DISPATCH_MICRO_PAUSE_EVERY_MIN: 'não-é-número' });
    expect(policy.microPause.everyMin).toBe(DEFAULT_MICRO_PAUSE_CONFIG.everyMin);
    expect(Number.isNaN(policy.microPause.everyMin)).toBe(false);
  });
});

describe('resolveSendPolicy — timezone', () => {
  it('usa APP_TIMEZONE quando presente', () => {
    expect(resolveSendPolicy({ APP_TIMEZONE: 'America/Manaus' }).sendWindow.timezone).toBe('America/Manaus');
  });

  it('cai no padrão (America/Sao_Paulo) quando ausente', () => {
    expect(resolveSendPolicy({}).sendWindow.timezone).toBe(DEFAULT_SEND_WINDOW_CONFIG.timezone);
  });
});

describe('resolveSendPolicy — aceita process.env real (mesmos nomes do §10)', () => {
  it('resolveSendPolicy(process.env) compila e roda sem parsing extra do chamador', () => {
    // Prova estrutural: `process.env` (dicionário `string | undefined`) satisfaz `SendPolicyEnv`
    // sem cast — é o que permite `apps/web` chamar isto direto, sem reescrever os clamps.
    expect(() => resolveSendPolicy(process.env)).not.toThrow();
  });
});
