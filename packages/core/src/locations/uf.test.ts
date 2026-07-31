import { describe, expect, it } from 'vitest';
import { UFS, getUfInfo, isValidUf, slugify } from './uf.js';

describe('UFS', () => {
  it('tem exatamente 27 unidades federativas (26 estados + DF)', () => {
    expect(UFS).toHaveLength(27);
  });

  it('todas as siglas têm 2 letras maiúsculas e são únicas', () => {
    const siglas = UFS.map((uf) => uf.sigla);
    expect(new Set(siglas).size).toBe(27);
    for (const sigla of siglas) {
      expect(sigla).toMatch(/^[A-Z]{2}$/);
    }
  });
});

describe('isValidUf / getUfInfo', () => {
  it('aceita UFs reais', () => {
    expect(isValidUf('SP')).toBe(true);
    expect(getUfInfo('SP')?.nome).toBe('São Paulo');
  });

  it('rejeita sigla inventada', () => {
    expect(isValidUf('XX')).toBe(false);
    expect(getUfInfo('XX')).toBeUndefined();
  });
});

describe('slugify', () => {
  it('remove acentos e usa minúsculas', () => {
    expect(slugify('São Paulo')).toBe('sao-paulo');
    expect(slugify('Espírito Santo')).toBe('espirito-santo');
  });

  it('colapsa espaços e pontuação em um único hífen, sem hífen nas pontas', () => {
    expect(slugify('  Clínica  Odontológica -- Ltda.  ')).toBe('clinica-odontologica-ltda');
  });
});
