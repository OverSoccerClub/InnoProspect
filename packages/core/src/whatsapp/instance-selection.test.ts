import { describe, expect, it } from 'vitest';
import { pickInstanceWeighted, type WeightedInstanceCandidate } from './instance-selection';
import type { RandomSource } from './jitter';

/** PRNG determinístico (mulberry32) — mesma seed sempre dá a mesma sequência. Duplicado de propósito de `jitter.test.ts` (ver `convention-api-routes-fase1`, regra de duplicação de test helper puro — este pacote ainda não tem um módulo de test-utils compartilhado). */
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

describe('pickInstanceWeighted — casos de borda', () => {
  it('lista vazia devolve null', () => {
    expect(pickInstanceWeighted([], seededRng(1))).toBeNull();
  });

  it('todos com cota zerada devolve null (nenhum peso > 0)', () => {
    const candidates: WeightedInstanceCandidate[] = [
      { instanceId: 'a', quotaRemaining: 0, isDegraded: false },
      { instanceId: 'b', quotaRemaining: 0, isDegraded: false },
    ];
    expect(pickInstanceWeighted(candidates, seededRng(1))).toBeNull();
  });

  it('um único candidato com peso > 0 é sempre ele, para qualquer draw do rng', () => {
    const candidates: WeightedInstanceCandidate[] = [{ instanceId: 'only', quotaRemaining: 50, isDegraded: false }];
    for (const seed of [0, 1, 2, 3, 4]) {
      expect(pickInstanceWeighted(candidates, seededRng(seed))?.instanceId).toBe('only');
    }
  });

  it('cota negativa (não deveria acontecer, mas é defendida) é tratada como peso zero, não como peso negativo', () => {
    const candidates: WeightedInstanceCandidate[] = [
      { instanceId: 'negativa', quotaRemaining: -10, isDegraded: false },
      { instanceId: 'positiva', quotaRemaining: 5, isDegraded: false },
    ];
    for (const seed of [0, 1, 2, 3, 4]) {
      expect(pickInstanceWeighted(candidates, seededRng(seed))?.instanceId).toBe('positiva');
    }
  });
});

describe('pickInstanceWeighted — determinismo', () => {
  it('a mesma seed produz exatamente o mesmo resultado', () => {
    const candidates: WeightedInstanceCandidate[] = [
      { instanceId: 'a', quotaRemaining: 100, isDegraded: false },
      { instanceId: 'b', quotaRemaining: 200, isDegraded: false },
    ];
    const first = pickInstanceWeighted(candidates, seededRng(42))?.instanceId;
    const second = pickInstanceWeighted(candidates, seededRng(42))?.instanceId;
    expect(first).toBe(second);
  });
});

/**
 * O teste que importa: 10.000 sorteios distribuem na proporção da cota
 * restante (critério de aceite da tabela §8/4.F.2).
 *
 * Por que a tolerância de 3 desvios-padrão (não é frouxa): para uma
 * proporção `p` sorteada corretamente `n=10.000` vezes, a contagem observada
 * segue (aproximadamente) uma binomial com desvio-padrão
 * `sqrt(n × p × (1-p))`. Para as proporções usadas abaixo (50/30/20%), isso
 * dá um desvio-padrão entre ~40 e ~50 amostras — então 3σ é uma banda de
 * ±120 a ±150 amostras (1,2%–1,5% de `n`). Uma implementação ERRADA
 * plausível (ex.: sorteio uniforme por candidato, ignorando o peso) produziria
 * ~3.333 para cada instância em vez de 5.000/3.000/2.000 — um desvio de
 * milhares, muito além da banda de ~150. A margem é estatisticamente
 * legítima (99.7% de confiança) E discrimina com folga contra a
 * implementação errada mais provável — não é "generosa a ponto de passar
 * com qualquer coisa".
 */
describe('pickInstanceWeighted — distribuição em 10.000 sorteios (critério de aceite)', () => {
  it('respeita a proporção quotaRestante × multiplicador de degradação', () => {
    const candidates: WeightedInstanceCandidate[] = [
      { instanceId: 'grande', quotaRemaining: 500, isDegraded: false }, // peso 500 → 50%
      { instanceId: 'media', quotaRemaining: 300, isDegraded: false }, // peso 300 → 30%
      { instanceId: 'pequena', quotaRemaining: 200, isDegraded: false }, // peso 200 → 20%
    ];
    const totalWeight = 1000;
    const draws = 10_000;
    const rng = seededRng(7);
    const counts: Record<string, number> = { grande: 0, media: 0, pequena: 0 };

    for (let i = 0; i < draws; i++) {
      const picked = pickInstanceWeighted(candidates, rng);
      counts[picked!.instanceId]!++;
    }

    for (const candidate of candidates) {
      const expectedProportion = candidate.quotaRemaining / totalWeight;
      const expectedCount = draws * expectedProportion;
      const stdDev = Math.sqrt(draws * expectedProportion * (1 - expectedProportion));
      const tolerance = 3 * stdDev; // ver comentário acima — ~1.2%-1.5% de `draws`, não "qualquer coisa passa".
      expect(counts[candidate.instanceId]).toBeGreaterThan(expectedCount - tolerance);
      expect(counts[candidate.instanceId]).toBeLessThan(expectedCount + tolerance);
    }
  });

  it('instância degradada recebe ~0.3× o peso de uma instância saudável com a MESMA cota', () => {
    const candidates: WeightedInstanceCandidate[] = [
      { instanceId: 'saudavel', quotaRemaining: 100, isDegraded: false }, // peso 100
      { instanceId: 'degradada', quotaRemaining: 100, isDegraded: true }, // peso 30
    ];
    // Proporções esperadas: 100/130 ≈ 76.9% vs 30/130 ≈ 23.1%.
    const totalWeight = 130;
    const draws = 10_000;
    const rng = seededRng(11);
    const counts = { saudavel: 0, degradada: 0 };

    for (let i = 0; i < draws; i++) {
      const picked = pickInstanceWeighted(candidates, rng);
      counts[picked!.instanceId as 'saudavel' | 'degradada']++;
    }

    const expectedHealthyProportion = 100 / totalWeight;
    const expectedHealthyCount = draws * expectedHealthyProportion;
    const stdDev = Math.sqrt(draws * expectedHealthyProportion * (1 - expectedHealthyProportion));
    const tolerance = 3 * stdDev;
    expect(counts.saudavel).toBeGreaterThan(expectedHealthyCount - tolerance);
    expect(counts.saudavel).toBeLessThan(expectedHealthyCount + tolerance);
  });
});
