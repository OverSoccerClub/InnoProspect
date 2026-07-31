import { describe, expect, it } from 'vitest';
import {
  SpintaxSyntaxError,
  countSpintaxVariations,
  hasSpintax,
  parseSpintax,
  resolveSpintax,
} from './spintax.js';

describe('parseSpintax', () => {
  it('reconhece um texto sem spintax como válido, sem blocos', () => {
    const result = parseSpintax('Olá, tudo bem?');
    expect(result).toEqual({ valid: true, optionSets: [] });
  });

  it('reconhece blocos simples e retorna as opções', () => {
    const result = parseSpintax('{Olá|Oi|Bom dia}, tudo bem?');
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.optionSets).toEqual([['Olá', 'Oi', 'Bom dia']]);
  });

  it('ignora {{variável}} — não é spintax nem conta como bloco', () => {
    const result = parseSpintax('Olá {{nome}}, {tudo bem|como vai}?');
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.optionSets).toEqual([['tudo bem', 'como vai']]);
  });

  it('reproduz o exemplo completo do ARQUITETURA §6.4', () => {
    const text =
      '{Olá|Oi|Bom dia}, tudo bem? {Vi que|Notei que} a {{nome}} {atende|trabalha} em {{cidade}}...';
    const result = parseSpintax(text);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.optionSets).toEqual([
        ['Olá', 'Oi', 'Bom dia'],
        ['Vi que', 'Notei que'],
        ['atende', 'trabalha'],
      ]);
    }
  });

  it('erro UNCLOSED_BRACE em chave não fechada', () => {
    const result = parseSpintax('Olá {tudo bem|como vai');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error.code).toBe('UNCLOSED_BRACE');
  });

  it('erro UNEXPECTED_CLOSING_BRACE em "}" solto', () => {
    const result = parseSpintax('Olá tudo bem}');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error.code).toBe('UNEXPECTED_CLOSING_BRACE');
  });

  it('erro NESTED_SPINTAX em spintax aninhado (não suportado no MVP)', () => {
    const result = parseSpintax('{a|{b|c}}');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error.code).toBe('NESTED_SPINTAX');
  });

  it('erro EMPTY_OPTION quando um bloco tem opção vazia', () => {
    const result = parseSpintax('{a||b}');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error.code).toBe('EMPTY_OPTION');
  });
});

describe('countSpintaxVariations / hasSpintax', () => {
  it('texto sem spintax tem 1 variação e hasSpintax=false', () => {
    expect(countSpintaxVariations('Olá, tudo bem?')).toBe(1);
    expect(hasSpintax('Olá, tudo bem?')).toBe(false);
  });

  it('multiplica o número de opções de cada bloco', () => {
    // 3 * 2 * 2 = 12 combinações.
    const text =
      '{Olá|Oi|Bom dia}, tudo bem? {Vi que|Notei que} a {{nome}} {atende|trabalha} em {{cidade}}...';
    expect(countSpintaxVariations(text)).toBe(12);
    expect(hasSpintax(text)).toBe(true);
  });
});

describe('resolveSpintax', () => {
  it('remove os blocos, escolhendo sempre uma opção válida de cada um', () => {
    const text = '{Olá|Oi|Bom dia}, tudo bem?';
    for (let i = 0; i < 20; i++) {
      const resolved = resolveSpintax(text);
      expect(['Olá, tudo bem?', 'Oi, tudo bem?', 'Bom dia, tudo bem?']).toContain(resolved);
    }
  });

  it('preserva {{variável}} intocada quando não pré-renderizada', () => {
    const resolved = resolveSpintax('Olá {{nome}}, {tudo bem|como vai}?', { seed: 'target_1' });
    expect(resolved).toMatch(/^Olá \{\{nome\}\}, (tudo bem|como vai)\?$/);
  });

  it('é determinístico para a mesma semente (mesmo alvo em retry recebe o mesmo texto)', () => {
    const text = '{Olá|Oi|Bom dia|E aí|Salve}! {Somos|Trabalhamos n}a {{minha_empresa}}.';
    const first = resolveSpintax(text, { seed: 'campaign-target-abc123' });
    const second = resolveSpintax(text, { seed: 'campaign-target-abc123' });
    expect(first).toBe(second);
  });

  it('sementes diferentes tendem a produzir textos diferentes ao longo de várias chamadas', () => {
    const text = '{a|b|c|d|e|f|g|h}';
    const outputs = new Set(
      Array.from({ length: 15 }, (_, i) => resolveSpintax(text, { seed: `target-${i}` })),
    );
    // Não é garantido matematicamente, mas com 8 opções e 15 sementes distintas
    // é extremamente improvável colapsar tudo num único valor.
    expect(outputs.size).toBeGreaterThan(1);
  });

  it('lança SpintaxSyntaxError para sintaxe inválida', () => {
    expect(() => resolveSpintax('Olá {tudo bem')).toThrow(SpintaxSyntaxError);
  });
});
