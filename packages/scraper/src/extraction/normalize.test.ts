import { describe, expect, it } from 'vitest';
import { normalize } from './normalize.js';
import type { NormalizeContext, RawBusiness } from './types.js';

const ctx: NormalizeContext = {
  city: { name: 'Rio de Janeiro', uf: 'RJ', ibgeCode: '3304557' },
  searchResultUrl: 'https://www.google.com/maps/search/padaria%20em%20Rio%20de%20Janeiro%2C%20RJ',
};

function baseRaw(overrides: Partial<RawBusiness> = {}): RawBusiness {
  return {
    name: 'Padaria Nova Esperança',
    phoneRaw: '(21) 98765-4321',
    address: 'Rua das Flores, 123',
    category: 'Padaria',
    ratingRaw: '4,5 estrelas',
    reviewCountRaw: '123 avaliações',
    website: 'https://padarianovaesperanca.com.br',
    externalRef: '0x9bde559108a05b:0x513a40d5c37d3a5c',
    detailUrl:
      'https://www.google.com/maps/place/x/@-22.9068,-43.1729,17z/data=!3m1!4b1',
    ...overrides,
  };
}

describe('normalize', () => {
  it('converte rating e reviewCount de string (pt-BR) para número', () => {
    const result = normalize(baseRaw(), ctx);
    expect(result.rating).toBe(4.5);
    expect(result.reviewCount).toBe(123);
  });

  it('extrai latitude/longitude do padrão @lat,lng, da URL da ficha', () => {
    const result = normalize(baseRaw(), ctx);
    expect(result.latitude).toBeCloseTo(-22.9068, 4);
    expect(result.longitude).toBeCloseTo(-43.1729, 4);
  });

  it('usa detailUrl como sourceUrl quando presente; cai para searchResultUrl quando ausente', () => {
    const withDetail = normalize(baseRaw(), ctx);
    expect(withDetail.sourceUrl).toBe(baseRaw().detailUrl);

    const withoutDetail = normalize(baseRaw({ detailUrl: null }), ctx);
    expect(withoutDetail.sourceUrl).toBe(ctx.searchResultUrl);
  });

  it('cityGuess vem do contexto de busca (a cidade que foi de fato pesquisada)', () => {
    const result = normalize(baseRaw(), ctx);
    expect(result.cityGuess).toBe('Rio de Janeiro');
  });

  it('campos ausentes viram null, sem lançar', () => {
    const result = normalize(
      baseRaw({
        phoneRaw: null,
        ratingRaw: null,
        reviewCountRaw: null,
        website: null,
        externalRef: null,
        detailUrl: null,
      }),
      ctx,
    );
    expect(result.phoneRaw).toBeNull();
    expect(result.rating).toBeNull();
    expect(result.reviewCount).toBeNull();
    expect(result.website).toBeNull();
    expect(result.externalRef).toBeNull();
    expect(result.latitude).toBeNull();
    expect(result.longitude).toBeNull();
  });

  it('rating fora de 0-5 passa adiante sem correção (é a assertion A4 que deve flagar, não normalize)', () => {
    const result = normalize(baseRaw({ ratingRaw: '7,0' }), ctx);
    expect(result.rating).toBe(7);
  });

  it('lança se raw.name vier vazio — nunca deveria acontecer se extractCard for usado antes', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => normalize(baseRaw({ name: null as any }), ctx)).toThrow();
  });
});
