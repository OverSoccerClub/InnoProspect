import { describe, expect, it } from 'vitest';

import {
  countAdvancedLeadFilters,
  describeActiveLeadFilters,
  EMPTY_LEADS_FILTER,
  hasAnyLeadFilter,
  removeLeadFilterChip,
  toApiLeadFilter,
  type LeadsFilterState,
} from './lead-filter-state';

function state(overrides: Partial<LeadsFilterState> = {}): LeadsFilterState {
  return { ...EMPTY_LEADS_FILTER, ...overrides };
}

describe('hasAnyLeadFilter', () => {
  it('é falso para o estado vazio', () => {
    expect(hasAnyLeadFilter(EMPTY_LEADS_FILTER)).toBe(false);
  });

  it('é verdadeiro quando qualquer campo string está preenchido', () => {
    expect(hasAnyLeadFilter(state({ hasWebsite: 'false' }))).toBe(true);
  });

  it('é verdadeiro quando status tem algum item', () => {
    expect(hasAnyLeadFilter(state({ status: ['new'] }))).toBe(true);
  });
});

describe('countAdvancedLeadFilters', () => {
  it('não conta busca/UF/cidade/status (ficam na barra principal)', () => {
    expect(countAdvancedLeadFilters(state({ q: 'padaria', uf: 'RN', status: ['new'] }))).toBe(0);
  });

  it('conta cada campo do painel "Mais filtros" separadamente', () => {
    expect(countAdvancedLeadFilters(state({ hasWebsite: 'false', minRating: '4' }))).toBe(2);
  });

  it('categoria/tags preenchidas contam 1 cada, independente de quantos itens têm dentro', () => {
    expect(countAdvancedLeadFilters(state({ category: 'restaurante, pizzaria' }))).toBe(1);
  });
});

describe('toApiLeadFilter', () => {
  it('estado vazio não manda nenhum campo definido', () => {
    const result = toApiLeadFilter(EMPTY_LEADS_FILTER);
    expect(Object.values(result).every((v) => v === undefined)).toBe(true);
  });

  it('traduz os tri-state para boolean', () => {
    const result = toApiLeadFilter(state({ hasWebsite: 'false', hasPhone: 'true', offNiche: 'true' }));
    expect(result.hasWebsite).toBe(false);
    expect(result.hasPhone).toBe(true);
    expect(result.offNiche).toBe(true);
  });

  it('minRating vira número', () => {
    expect(toApiLeadFilter(state({ minRating: '4.5' })).minRating).toBe(4.5);
  });

  it('categoria/tags em texto livre viram array, aparado e sem itens vazios', () => {
    const result = toApiLeadFilter(state({ category: ' restaurante ,, pizzaria ', tags: 'prioridade' }));
    expect(result.category).toEqual(['restaurante', 'pizzaria']);
    expect(result.tags).toEqual(['prioridade']);
  });

  it('createdFrom vira início do dia UTC e createdTo vira fim do dia UTC', () => {
    const result = toApiLeadFilter(state({ createdFrom: '2026-09-01', createdTo: '2026-09-20' }));
    expect(result.createdFrom).toBe('2026-09-01T00:00:00.000Z');
    expect(result.createdTo).toBe('2026-09-20T23:59:59.999Z');
  });

  it('uf vira array de 1 item (o filtro real aceita múltiplas UFs, a tela hoje só permite escolher 1)', () => {
    expect(toApiLeadFilter(state({ uf: 'RN' })).uf).toEqual(['RN']);
  });
});

describe('describeActiveLeadFilters', () => {
  it('estado vazio não gera nenhum chip', () => {
    expect(describeActiveLeadFilters(EMPTY_LEADS_FILTER)).toEqual([]);
  });

  it('gera um chip por status selecionado', () => {
    const chips = describeActiveLeadFilters(state({ status: ['new', 'won'] }));
    expect(chips.map((c) => c.key)).toEqual(['status:new', 'status:won']);
  });

  it('usa o lookup de rótulo quando fornecido', () => {
    const chips = describeActiveLeadFilters(state({ cityIbgeCode: '2408102' }), { cityLabel: 'Natal' });
    expect(chips).toEqual([{ key: 'cityIbgeCode', label: 'Cidade: Natal' }]);
  });

  it('cai no valor bruto quando não há lookup', () => {
    const chips = describeActiveLeadFilters(state({ cityIbgeCode: '2408102' }));
    expect(chips).toEqual([{ key: 'cityIbgeCode', label: 'Cidade: 2408102' }]);
  });

  it('descreve site/telefone/nicho pela direção certa do booleano', () => {
    const chips = describeActiveLeadFilters(state({ hasWebsite: 'false', hasPhone: 'true', offNiche: 'true' }));
    expect(chips.map((c) => c.label)).toEqual(['Fora do nicho buscado', 'Sem site', 'Tem telefone']);
  });
});

describe('removeLeadFilterChip', () => {
  it('remove só o status pedido, mantendo os outros', () => {
    const result = removeLeadFilterChip(state({ status: ['new', 'won'] }), 'status:new');
    expect(result.status).toEqual(['won']);
  });

  it('limpar UF também limpa a cidade (depende da UF)', () => {
    const result = removeLeadFilterChip(state({ uf: 'RN', cityIbgeCode: '2408102' }), 'uf');
    expect(result.uf).toBe('');
    expect(result.cityIbgeCode).toBe('');
  });

  it('limpar cidade não afeta a UF', () => {
    const result = removeLeadFilterChip(state({ uf: 'RN', cityIbgeCode: '2408102' }), 'cityIbgeCode');
    expect(result.uf).toBe('RN');
    expect(result.cityIbgeCode).toBe('');
  });

  it('chave desconhecida devolve o estado intacto', () => {
    const original = state({ q: 'padaria' });
    expect(removeLeadFilterChip(original, 'campo-que-nao-existe')).toEqual(original);
  });
});
