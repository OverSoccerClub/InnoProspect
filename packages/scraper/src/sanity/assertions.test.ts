import { describe, expect, it } from 'vitest';
import {
  checkDataShape,
  checkEnrichmentFillRate,
  checkNameFillRate,
  checkPhoneFillRate,
  checkZeroStreak,
  type LeadEnrichmentSample,
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
    const result = checkPhoneFillRate({ fillRate: 0.2, sampleSize: 50 }, 0.6);
    expect(result.triggered).toBe(true);
    if (result.triggered) {
      expect(result.severity).toBe('high');
      expect(result.pauseQueue).toBe(false);
    }
  });

  it('NÃO dispara quando ainda está acima do limiar relativo', () => {
    expect(checkPhoneFillRate({ fillRate: 0.4, sampleSize: 50 }, 0.6).triggered).toBe(false);
  });

  it('piso absoluto: dispara com 0% de telefone mesmo SEM média de 7 dias (sistema novo, incidente real de 2026-09)', () => {
    const result = checkPhoneFillRate({ fillRate: 0, sampleSize: 20 }, 0);
    expect(result.triggered).toBe(true);
    if (result.triggered) {
      expect(result.code).toBe('PHONE_FILL_RATE_LOW');
      expect(result.pauseQueue).toBe(false);
    }
  });

  it('piso absoluto: NÃO dispara com amostra pequena (ruído, não incidente)', () => {
    // 0/3 com telefone seria 0% — mas amostra abaixo do mínimo não conta.
    expect(checkPhoneFillRate({ fillRate: 0, sampleSize: 3 }, 0).triggered).toBe(false);
  });

  it('piso absoluto: NÃO dispara acima do piso, mesmo sem média de 7 dias', () => {
    expect(checkPhoneFillRate({ fillRate: 0.5, sampleSize: 50 }, 0).triggered).toBe(false);
  });

  it('piso absoluto dispara mesmo quando a média de 7 dias TAMBÉM já está baixa (o mesmo bug contaminando os dois)', () => {
    const result = checkPhoneFillRate({ fillRate: 0.05, sampleSize: 50 }, 0.08);
    expect(result.triggered).toBe(true);
    if (result.triggered) expect(result.threshold).toBeCloseTo(0.2);
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

describe('checkEnrichmentFillRate (A5 — incidente real de 2026-09-23: ~260 leads só com o nome, nenhuma assertion disparou)', () => {
  const nameOnly: LeadEnrichmentSample = { hasAddress: false, hasPhone: false, hasCategory: false, hasWebsite: false };
  const fullyEnriched: LeadEnrichmentSample = { hasAddress: true, hasPhone: true, hasCategory: true, hasWebsite: true };

  it('dispara reproduzindo o cenário real: janela inteira só com o nome', () => {
    const samples = Array.from({ length: 30 }, () => ({ ...nameOnly }));
    const result = checkEnrichmentFillRate(samples);
    expect(result.triggered).toBe(true);
    if (result.triggered) {
      expect(result.code).toBe('ENRICHMENT_FILL_RATE_LOW');
      expect(result.severity).toBe('critical');
      // Diferente de A3/A4: uma falha estrutural em TODOS os campos ao
      // mesmo tempo não tem explicação de nicho plausível — pausa a fila.
      expect(result.pauseQueue).toBe(true);
      expect(result.metric).toBeCloseTo(1);
    }
  });

  it('NÃO dispara com amostra abaixo do mínimo, mesmo 100% só-com-nome (ruído, não incidente)', () => {
    const samples = Array.from({ length: 10 }, () => ({ ...nameOnly }));
    expect(checkEnrichmentFillRate(samples).triggered).toBe(false);
  });

  it('NÃO dispara para nicho legítimo sem telefone/site — endereço+categoria ainda preenchidos bastam para NÃO contar como "só com o nome"', () => {
    const samples: LeadEnrichmentSample[] = Array.from({ length: 30 }, () => ({
      hasAddress: true,
      hasPhone: false,
      hasCategory: true,
      hasWebsite: false,
    }));
    expect(checkEnrichmentFillRate(samples).triggered).toBe(false);
  });

  it('NÃO dispara logo abaixo do piso de 30%', () => {
    const samples = [
      ...Array.from({ length: 8 }, () => ({ ...nameOnly })), // 8/30 = 26.7%
      ...Array.from({ length: 22 }, () => ({ ...fullyEnriched })),
    ];
    expect(checkEnrichmentFillRate(samples).triggered).toBe(false);
  });

  it('dispara logo acima do piso de 30%', () => {
    const samples = [
      ...Array.from({ length: 10 }, () => ({ ...nameOnly })), // 10/30 = 33.3%
      ...Array.from({ length: 20 }, () => ({ ...fullyEnriched })),
    ];
    const result = checkEnrichmentFillRate(samples);
    expect(result.triggered).toBe(true);
    if (result.triggered) expect(result.metric).toBeCloseTo(10 / 30);
  });

  it('um lead com SÓ telefone (sem endereço/categoria/site) NÃO conta como "só com o nome" — a métrica exige os 4 vazios ao mesmo tempo', () => {
    const partial: LeadEnrichmentSample = { hasAddress: false, hasPhone: true, hasCategory: false, hasWebsite: false };
    const samples = Array.from({ length: 30 }, () => ({ ...partial }));
    expect(checkEnrichmentFillRate(samples).triggered).toBe(false);
  });
});
