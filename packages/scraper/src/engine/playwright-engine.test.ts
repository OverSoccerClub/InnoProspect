import { describe, expect, it } from 'vitest';
import { buildQueryString } from './playwright-engine.js';

describe('buildQueryString', () => {
  it('monta a string de consulta no formato CONTRATO (ARQUITETURA §5.2): "${niche} em ${city}, ${uf}"', () => {
    expect(buildQueryString('clínica odontológica', 'Campinas', 'SP')).toBe(
      'clínica odontológica em Campinas, SP',
    );
  });

  it('normaliza espaços (trim + colapso), sem remover acento', () => {
    expect(buildQueryString('  clínica   odontológica  ', '  Campinas  ', 'SP')).toBe(
      'clínica odontológica em Campinas, SP',
    );
  });
});
