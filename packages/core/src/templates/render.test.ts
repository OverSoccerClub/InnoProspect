import { describe, expect, it } from 'vitest';
import {
  extractKnownVariables,
  findMissingVariables,
  firstName,
  renderTemplate,
  validateTemplateVariables,
} from './render.js';

describe('validateTemplateVariables', () => {
  it('aceita corpo só com variáveis permitidas', () => {
    const result = validateTemplateVariables('Olá {{primeiro_nome}}, aqui é da {{minha_empresa}}.');
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.variablesUsed).toEqual(['primeiro_nome', 'minha_empresa']);
  });

  it('422 UNKNOWN_VARIABLE — rejeita variável fora da lista fechada', () => {
    const result = validateTemplateVariables('Olá {{apelido}}!');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.unknownVariables).toEqual(['apelido']);
  });

  it('corpo sem variáveis é válido, lista vazia', () => {
    const result = validateTemplateVariables('Mensagem fixa, sem variação.');
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.variablesUsed).toEqual([]);
  });
});

describe('renderTemplate', () => {
  it('substitui variáveis conhecidas pelos valores informados', () => {
    const out = renderTemplate('Olá {{primeiro_nome}}, tudo bem em {{cidade}}?', {
      primeiro_nome: 'Maria',
      cidade: 'Campinas',
    });
    expect(out).toBe('Olá Maria, tudo bem em Campinas?');
  });

  it('variável sem valor vira string vazia', () => {
    const out = renderTemplate('Site: {{site}}', {});
    expect(out).toBe('Site: ');
  });
});

describe('findMissingVariables', () => {
  it('lista variáveis conhecidas referenciadas mas sem valor', () => {
    const missing = findMissingVariables('{{nome}} de {{cidade}}, site {{site}}', {
      nome: 'Padaria X',
      cidade: '',
    });
    expect(missing).toEqual(['cidade', 'site']);
  });
});

describe('extractKnownVariables', () => {
  it('ignora nomes de variável desconhecidos', () => {
    expect(extractKnownVariables('{{nome}} {{apelido}} {{uf}}')).toEqual(['nome', 'uf']);
  });
});

describe('firstName', () => {
  it('extrai o primeiro token do nome completo', () => {
    expect(firstName('Maria da Silva')).toBe('Maria');
    expect(firstName('  Ana   ')).toBe('Ana');
    expect(firstName('')).toBe('');
  });
});
