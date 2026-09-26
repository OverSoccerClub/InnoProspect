import { describe, expect, it } from 'vitest';
import { renderTemplate, resolveSpintax } from '@inno/core';

import {
  checkSpintaxSyntax,
  countVariations,
  extractKnownVariables,
  extractVariables,
  findUnknownVariables,
  hasSpintax,
  renderSample,
  renderSamples,
  renderWithSeed,
} from './spintax';

// Templates reais do dono (corrigidos após o bug dos dois parsers) — o
// segundo é exatamente o caso que travava antes: spintax com uma variável
// `{{nome}}` dentro de uma das opções.
const REAL_TEMPLATES = [
  '{Vou encerrar meu contato por aqui|Este é meu último contato} para não ficar insistindo. 🙂',
  '{Eu tinha procurado vocês|Procurei vocês} para falar sobre a presença da {{nome}} na internet.',
  '{Sucesso para vocês!|Desejo sucesso para a empresa!}',
];

const COM_VAR_DENTRO = '{Sucesso para vocês!|Sucesso para a {{nome}}!}';

describe('checkSpintaxSyntax — motor único (@inno/core), sem falso positivo de aninhamento', () => {
  it('aceita spintax com uma variável dentro de uma das opções (o caso que travava com os dois parsers)', () => {
    expect(checkSpintaxSyntax(COM_VAR_DENTRO)).toEqual([]);
  });

  it('aceita os 3 templates reais do dono', () => {
    for (const body of REAL_TEMPLATES) {
      expect(checkSpintaxSyntax(body)).toEqual([]);
    }
  });

  it('recusa spintax de fato aninhado, com mensagem legível', () => {
    const issues = checkSpintaxSyntax('{a|{b|c}}');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('não podem ser aninhadas');
  });

  it('recusa chave de spintax não fechada', () => {
    const issues = checkSpintaxSyntax('Olá {a|b, tudo bem?');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('não foi fechada');
  });

  it('recusa "}" órfã (sem "{" correspondente)', () => {
    const issues = checkSpintaxSyntax('Olá a|b}, tudo bem?');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('sem uma "{" correspondente');
  });

  it('recusa variável "{{...}}" não fechada — checagem própria da tela, o backend hoje não valida isso (ver PENDÊNCIAS)', () => {
    const issues = checkSpintaxSyntax('Oi {{nome, tudo bem?');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('variável "{{...}}" não foi fechada');
  });

  it('recusa opção vazia dentro de um bloco spintax', () => {
    const issues = checkSpintaxSyntax('Olá {a||b}, tudo bem?');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('opção de variação está vazia');
  });
});

describe('hasSpintax / countVariations — delegam para @inno/core, não reimplementam', () => {
  it('conta as variações certas para o template com variável dentro da opção', () => {
    expect(hasSpintax(COM_VAR_DENTRO)).toBe(true);
    expect(countVariations(COM_VAR_DENTRO)).toBe(2);
  });

  it('corpo sem spintax tem 1 variação e hasSpintax false', () => {
    expect(hasSpintax('Olá, tudo bem?')).toBe(false);
    expect(countVariations('Olá, tudo bem?')).toBe(1);
  });
});

describe('extração de variáveis', () => {
  it('extractVariables inclui desconhecidas; extractKnownVariables só as permitidas', () => {
    expect(extractVariables('Oi {{nome}}, {{campo_invalido}}')).toEqual(['nome', 'campo_invalido']);
    expect(extractKnownVariables('Oi {{nome}}, {{campo_invalido}}')).toEqual(['nome']);
  });

  it('findUnknownVariables aponta a variável fora do contrato', () => {
    expect(findUnknownVariables('Oi {{nome}}')).toEqual([]);
    expect(findUnknownVariables('Oi {{campo_invalido}}')).toEqual(['campo_invalido']);
  });
});

describe('preview da tela === o que o motor de envio produziria (mesma semente)', () => {
  const FULL_VALUES = {
    nome: 'Clínica Sorriso Ltda',
    primeiro_nome: 'Clínica',
    cidade: 'Campinas',
    uf: 'SP',
    categoria: 'clínica odontológica',
    site: 'clinicasorriso.com.br',
    telefone: '(19) 99876-5432',
    minha_empresa: 'Sua Empresa',
  };

  it.each(REAL_TEMPLATES)('renderWithSeed(%s) bate com renderTemplate + resolveSpintax do @inno/core', (body) => {
    for (const seed of ['seed-1', 'lead-42:template-7:2026-09-26', 'outra-semente']) {
      const preview = renderWithSeed(body, seed, FULL_VALUES);
      const engineOfSend = resolveSpintax(renderTemplate(body, FULL_VALUES), { seed });
      expect(preview).toBe(engineOfSend);
    }
  });

  it('com variável faltando, cai no valor de exemplo (fallback só da tela) em vez de string vazia (do backend)', () => {
    const body = 'Oi {{nome}}, aqui é a {{minha_empresa}}.';
    const preview = renderWithSeed(body, 'seed-x', {});
    expect(preview).not.toContain('{{');
    expect(preview).toContain('Clínica Sorriso Ltda');
  });

  it('nunca lança durante um estado intermediário de digitação (chave ainda não fechada) — só o preview cai para o texto cru', () => {
    // `resolveSpintax` do @inno/core LANÇA em sintaxe inválida (correto para
    // o envio real). O preview roda a cada tecla, então precisa sobreviver
    // a este estado — regressão real que apareceu ao unificar o motor.
    expect(() => renderSamples('Oi {opção a', 3)).not.toThrow();
    expect(() => renderSample('Oi {opção a', 1)).not.toThrow();
    expect(() => renderWithSeed('Oi {opção a', 'seed', {})).not.toThrow();
    expect(renderSample('Oi {opção a', 1)).toBe('Oi {opção a');
  });

  it('renderSample/renderSamples usam o mesmo par renderTemplate+resolveSpintax, com valores de amostra', () => {
    const SAMPLE_VALUES = {
      nome: 'Clínica Sorriso Ltda',
      primeiro_nome: 'Clínica',
      cidade: 'Campinas',
      uf: 'SP',
      categoria: 'clínica odontológica',
      site: 'clinicasorriso.com.br',
      telefone: '(19) 99876-5432',
      minha_empresa: 'Sua Empresa',
    };
    for (const body of [...REAL_TEMPLATES, COM_VAR_DENTRO]) {
      expect(renderSample(body, 1234)).toBe(resolveSpintax(renderTemplate(body, SAMPLE_VALUES), { seed: '1234' }));
    }
    const samples = renderSamples(COM_VAR_DENTRO, 3);
    expect(samples).toHaveLength(3);
    for (const text of samples) expect(text).not.toContain('{{');
  });
});
