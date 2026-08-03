import { describe, expect, it } from 'vitest';
import { dailyLimitForWarmupDay, effectiveDailyLimit, isWarmupDayWarm, regressWarmupDay } from './warmup.js';

describe('dailyLimitForWarmupDay', () => {
  it('segue a tabela de warmup da ARQUITETURA §6.2', () => {
    expect(dailyLimitForWarmupDay(1)).toBe(20);
    expect(dailyLimitForWarmupDay(2)).toBe(20);
    expect(dailyLimitForWarmupDay(3)).toBe(40);
    expect(dailyLimitForWarmupDay(7)).toBe(70);
    expect(dailyLimitForWarmupDay(10)).toBe(110);
    expect(dailyLimitForWarmupDay(14)).toBe(160);
    expect(dailyLimitForWarmupDay(21)).toBe(220);
    expect(dailyLimitForWarmupDay(22)).toBe(300);
    expect(dailyLimitForWarmupDay(500)).toBe(300);
  });

  it('trata dia <= 0 como dia 1 (nunca lança, nunca teto negativo)', () => {
    expect(dailyLimitForWarmupDay(0)).toBe(20);
    expect(dailyLimitForWarmupDay(-5)).toBe(20);
  });
});

describe('isWarmupDayWarm', () => {
  it('só é true a partir do dia 22', () => {
    expect(isWarmupDayWarm(21)).toBe(false);
    expect(isWarmupDayWarm(22)).toBe(true);
    expect(isWarmupDayWarm(100)).toBe(true);
  });
});

describe('effectiveDailyLimit', () => {
  it('sem override, usa o teto da tabela', () => {
    expect(effectiveDailyLimit(1, null)).toBe(20);
    expect(effectiveDailyLimit(1, undefined)).toBe(20);
  });

  it('override só pode REDUZIR o teto, nunca aumentar acima da tabela', () => {
    expect(effectiveDailyLimit(1, 10)).toBe(10); // reduz: ok
    expect(effectiveDailyLimit(1, 999)).toBe(20); // tenta aumentar: ignorado, vale o teto da tabela
    expect(effectiveDailyLimit(22, 999)).toBe(300); // idem no teto máximo
  });

  it('override <= 0 vira 1 (nunca zera o teto)', () => {
    expect(effectiveDailyLimit(1, 0)).toBe(1);
    expect(effectiveDailyLimit(1, -10)).toBe(1);
  });
});

describe('regressWarmupDay', () => {
  it('recua 30%, arredondando para baixo, mínimo dia 1', () => {
    expect(regressWarmupDay(10)).toBe(7);
    expect(regressWarmupDay(1)).toBe(1);
    expect(regressWarmupDay(2)).toBe(1);
  });
});
