import { describe, expect, it } from 'vitest';
import { classifyPhone, normalizeBrPhone, toE164 } from './phone.js';

describe('normalizeBrPhone', () => {
  it('normaliza celular já com o nono dígito e DDD de SP', () => {
    expect(normalizeBrPhone('(11) 98765-4321')).toEqual({ e164: '+5511987654321', type: 'mobile' });
  });

  it('reinsere o nono dígito quando o scraper captura celular sem ele (armadilha do nono dígito)', () => {
    // "8765-4321" começando em 8: prefixo histórico de celular sem o 9.
    expect(normalizeBrPhone('11 8765-4321')).toEqual({ e164: '+5511987654321', type: 'mobile' });
  });

  it('reconhece fixo de 8 dígitos (prefixo 2-5) sem adicionar nono dígito', () => {
    expect(normalizeBrPhone('(11) 3345-6789')).toEqual({ e164: '+551133456789', type: 'landline' });
  });

  it('aceita o prefixo internacional +55', () => {
    expect(normalizeBrPhone('+55 11 98765-4321')).toEqual({ e164: '+5511987654321', type: 'mobile' });
  });

  it('aceita o 0 de discagem doméstica antes do DDD', () => {
    expect(normalizeBrPhone('0 21 98765-4321')).toEqual({ e164: '+5521987654321', type: 'mobile' });
  });

  it('rejeita DDD fora do conjunto fechado da ANATEL (ex.: 20, 00)', () => {
    expect(normalizeBrPhone('20 98765-4321')).toEqual({ e164: null, type: 'unknown' });
    expect(normalizeBrPhone('00 98765-4321')).toEqual({ e164: null, type: 'unknown' });
  });

  it('rejeita string vazia, nula ou sem dígitos', () => {
    expect(normalizeBrPhone(null)).toEqual({ e164: null, type: 'unknown' });
    expect(normalizeBrPhone(undefined)).toEqual({ e164: null, type: 'unknown' });
    expect(normalizeBrPhone('')).toEqual({ e164: null, type: 'unknown' });
    expect(normalizeBrPhone('não tem telefone')).toEqual({ e164: null, type: 'unknown' });
  });

  it('rejeita 9 dígitos locais que não começam em 9 (padrão BR inexistente)', () => {
    expect(normalizeBrPhone('11 123456789')).toEqual({ e164: null, type: 'unknown' });
  });

  it('classifica DDD do Rio de Janeiro (celular)', () => {
    expect(classifyPhone('(21) 99999-1234')).toBe('mobile');
  });

  it('toE164 é atalho de normalizeBrPhone().e164', () => {
    expect(toE164('11987654321')).toBe('+5511987654321');
    expect(toE164('telefone invalido')).toBeNull();
  });
});
