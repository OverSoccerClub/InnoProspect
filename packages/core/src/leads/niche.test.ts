/**
 * niche.test.ts — critério de "fora do nicho" (ver comentário completo em
 * `niche.ts`). Os 4 casos "achados no relato do dono" são os REAIS da busca
 * "escritório de arquitetura" em produção, 2026-09-23 — não são exemplos
 * inventados.
 */
import { describe, expect, it } from 'vitest';
import { isOffNiche } from './niche.js';

const NICHE_ARQUITETURA = 'escritório de arquitetura';

describe('isOffNiche — achados reais do relato do dono (busca "escritório de arquitetura")', () => {
  it.each([
    ['Magazine Luiza', 'Loja de departamentos'],
    ['Cartório Benicio', 'Cartório de Registro'],
    ['INFONOT COMPUTADORES', 'Assistência Técnica'],
    ['Ciano Cópias', 'Copiadora'],
  ])('%s (categoria "%s") é marcado como fora do nicho', (_nome, categoria) => {
    expect(isOffNiche(NICHE_ARQUITETURA, categoria)).toBe(true);
  });

  it('um escritório de arquitetura legítimo NUNCA cai como divergente', () => {
    expect(isOffNiche(NICHE_ARQUITETURA, 'Escritório de arquitetura')).toBe(false);
  });

  it('variações de gênero/número da mesma raiz (arquiteto/arquitetônico) continuam aderentes', () => {
    expect(isOffNiche(NICHE_ARQUITETURA, 'Arquiteto')).toBe(false);
    expect(isOffNiche(NICHE_ARQUITETURA, 'Escritório de projetos arquitetônicos')).toBe(false);
  });
});

describe('isOffNiche — casos de borda', () => {
  it('sem categoria (null) não marca — ausência de evidência não é evidência de divergência', () => {
    expect(isOffNiche(NICHE_ARQUITETURA, null)).toBe(false);
  });

  it('sem categoria (undefined) não marca', () => {
    expect(isOffNiche(NICHE_ARQUITETURA, undefined)).toBe(false);
  });

  it('categoria vazia/só espaço não marca', () => {
    expect(isOffNiche(NICHE_ARQUITETURA, '   ')).toBe(false);
  });

  it('categoria idêntica ao nicho nunca diverge', () => {
    expect(isOffNiche(NICHE_ARQUITETURA, NICHE_ARQUITETURA)).toBe(false);
  });

  it('nicho e categoria só com stopwords/palavras curtas (sem raiz nenhuma) não marca — falta evidência nos dois lados', () => {
    expect(isOffNiche('de e a', 'de e a')).toBe(false);
  });

  it('é insensível a maiúsculas/acento/pontuação', () => {
    expect(isOffNiche('Clínica Odontológica', 'CLÍNICA ODONTOLÓGICA!')).toBe(false);
    expect(isOffNiche('clinica odontologica', 'clinica-odontologica')).toBe(false);
  });
});

describe('isOffNiche — outros nichos plausíveis, mesma lógica', () => {
  it('categoria correlata mas sem raiz em comum diverge (ex.: "Design de interiores" para busca de arquitetura)', () => {
    expect(isOffNiche(NICHE_ARQUITETURA, 'Design de interiores')).toBe(true);
  });

  it('"Clínica veterinária" não diverge de si mesma com grafia levemente diferente', () => {
    expect(isOffNiche('clínica veterinária', 'Clínica Veterinária Ltda')).toBe(false);
  });

  it('"Petshop" diverge de "clínica veterinária" (nenhuma raiz em comum)', () => {
    expect(isOffNiche('clínica veterinária', 'Petshop')).toBe(true);
  });
});
