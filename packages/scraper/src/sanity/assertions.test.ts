import { describe, expect, it } from 'vitest';
import {
  checkDataShape,
  checkNameFillRate,
  checkPhoneFillRate,
  checkZeroStreak,
} from './assertions.js';

describe('checkZeroStreak (A1)', () => {
  it('dispara quando as últimas 5 tasks elegíveis (pop > 20k) deram 0 resultado', () => {
    const tasks = Array.from({ length: 5 }, () => ({ resultCount: 0, cityPopulation: 50_000 }));
    const result = checkZeroStreak(tasks);
    expect(result.triggered).toBe(true);
    if (result.triggered) {
      expect(result.severity).toBe('critical');
      expect(result.pauseQueue).toBe(true);
    }
  });

  it('NÃO dispara para município pequeno (pop <= 20k) com 0 resultado — resultado esperado, não bug', () => {
    const tasks = Array.from({ length: 10 }, () => ({ resultCount: 0, cityPopulation: 3_000 }));
    expect(checkZeroStreak(tasks).triggered).toBe(false);
  });

  it('NÃO dispara se houver menos de 5 tasks elegíveis ainda', () => {
    const tasks = Array.from({ length: 4 }, () => ({ resultCount: 0, cityPopulation: 50_000 }));
    expect(checkZeroStreak(tasks).triggered).toBe(false);
  });

  it('NÃO dispara se qualquer uma das últimas 5 elegíveis teve resultado', () => {
    const tasks = [
      { resultCount: 0, cityPopulation: 50_000 },
      { resultCount: 0, cityPopulation: 50_000 },
      { resultCount: 3, cityPopulation: 50_000 },
      { resultCount: 0, cityPopulation: 50_000 },
      { resultCount: 0, cityPopulation: 50_000 },
    ];
    expect(checkZeroStreak(tasks).triggered).toBe(false);
  });

  it('ignora tasks de município pequeno ao montar a janela das últimas 5 elegíveis', () => {
    const tasks = [
      { resultCount: 5, cityPopulation: 50_000 }, // elegível, com resultado -> não deveria contar no streak de zero
      { resultCount: 0, cityPopulation: 3_000 }, // pequeno, ignorado
      { resultCount: 0, cityPopulation: 50_000 },
      { resultCount: 0, cityPopulation: 50_000 },
      { resultCount: 0, cityPopulation: 50_000 },
      { resultCount: 0, cityPopulation: 50_000 },
      { resultCount: 0, cityPopulation: 50_000 },
    ];
    // As últimas 5 elegíveis são todas 0 -> dispara.
    expect(checkZeroStreak(tasks).triggered).toBe(true);
  });
});

describe('checkNameFillRate (A2)', () => {
  it('dispara quando fill-rate de nome cai abaixo de 95% numa janela de 50', () => {
    const names: (string | null)[] = Array.from({ length: 50 }, (_, i) => (i < 10 ? null : 'Empresa X'));
    const result = checkNameFillRate(names);
    expect(result.triggered).toBe(true);
    if (result.triggered) expect(result.severity).toBe('critical');
  });

  it('NÃO dispara com fill-rate >= 95%', () => {
    const names: (string | null)[] = Array.from({ length: 50 }, (_, i) => (i < 2 ? null : 'Empresa X'));
    expect(checkNameFillRate(names).triggered).toBe(false);
  });

  it('NÃO dispara sem janela completa de 50', () => {
    const names: (string | null)[] = Array.from({ length: 10 }, () => null);
    expect(checkNameFillRate(names).triggered).toBe(false);
  });
});

describe('checkPhoneFillRate (A3)', () => {
  it('dispara quando cai abaixo de 50% da média móvel de 7 dias, sem pausar a fila', () => {
    const result = checkPhoneFillRate(0.2, 0.6);
    expect(result.triggered).toBe(true);
    if (result.triggered) {
      expect(result.severity).toBe('high');
      expect(result.pauseQueue).toBe(false);
    }
  });

  it('NÃO dispara quando ainda está acima do limiar', () => {
    expect(checkPhoneFillRate(0.4, 0.6).triggered).toBe(false);
  });
});

describe('checkDataShape (A4)', () => {
  it('dispara em >10% de ratings fora de 0-5', () => {
    const samples = [
      ...Array.from({ length: 8 }, () => ({ rating: 4, phoneNormalizationFailed: false })),
      ...Array.from({ length: 2 }, () => ({ rating: 9, phoneNormalizationFailed: false })),
    ];
    const result = checkDataShape(samples);
    expect(result.triggered).toBe(true);
    if (result.triggered) expect(result.code).toBe('RATING_OUT_OF_RANGE');
  });

  it('dispara em >10% de falha de normalização de telefone', () => {
    const samples = [
      ...Array.from({ length: 8 }, () => ({ rating: 4, phoneNormalizationFailed: false })),
      ...Array.from({ length: 2 }, () => ({ rating: 4, phoneNormalizationFailed: true })),
    ];
    const result = checkDataShape(samples);
    expect(result.triggered).toBe(true);
    if (result.triggered) expect(result.code).toBe('PHONE_NORMALIZATION_FAILURE_RATE');
  });

  it('NÃO dispara com dados dentro da forma esperada', () => {
    const samples = Array.from({ length: 20 }, () => ({ rating: 4.2, phoneNormalizationFailed: false }));
    expect(checkDataShape(samples).triggered).toBe(false);
  });
});
