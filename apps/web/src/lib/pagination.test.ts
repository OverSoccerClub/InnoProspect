import { describe, expect, it } from 'vitest';

import { buildPageWindow, clampPage, computeTotalPages, normalizePageSize, pageItemRange } from './pagination';

describe('normalizePageSize', () => {
  it('aceita um valor do conjunto permitido', () => {
    expect(normalizePageSize(50)).toBe(50);
  });

  it('cai no default quando o valor não está no conjunto permitido', () => {
    expect(normalizePageSize(37)).toBe(25);
  });

  it('cai no default quando o valor é undefined', () => {
    expect(normalizePageSize(undefined)).toBe(25);
  });
});

describe('computeTotalPages', () => {
  it('devolve 0 quando não há nenhum resultado', () => {
    expect(computeTotalPages(0, 25)).toBe(0);
  });

  it('arredonda para cima uma divisão não exata', () => {
    expect(computeTotalPages(101, 25)).toBe(5);
  });

  it('divisão exata não gera página extra', () => {
    expect(computeTotalPages(100, 25)).toBe(4);
  });

  it('devolve 0 com pageSize inválido', () => {
    expect(computeTotalPages(100, 0)).toBe(0);
  });
});

describe('clampPage', () => {
  it('mantém a página quando ela é válida', () => {
    expect(clampPage(2, 5)).toBe(2);
  });

  // Caso real do escopo: filtro mudou, a página que o operador estava vendo
  // (7) não existe mais no resultado reduzido (3 páginas) — cai na última válida.
  it('cai na última página válida quando a página pedida ultrapassa o total', () => {
    expect(clampPage(7, 3)).toBe(3);
  });

  it('sobe para a página 1 quando a página pedida é menor que 1', () => {
    expect(clampPage(0, 5)).toBe(1);
  });

  it('devolve 1 quando não há nenhuma página (lista vazia)', () => {
    expect(clampPage(3, 0)).toBe(1);
  });
});

describe('buildPageWindow', () => {
  it('lista vazia (totalPages 0) não gera nenhum controle', () => {
    expect(buildPageWindow(1, 0)).toEqual([]);
  });

  it('quando tudo cabe na janela, mostra todas as páginas sem elipse', () => {
    expect(buildPageWindow(1, 3, 1)).toEqual([1, 2, 3]);
  });

  it('página 1 de muitas: janela no início, elipse antes da última', () => {
    expect(buildPageWindow(1, 10, 1)).toEqual([1, 2, 'ellipsis', 10]);
  });

  it('página do meio: elipse dos dois lados', () => {
    expect(buildPageWindow(5, 10, 1)).toEqual([1, 'ellipsis', 4, 5, 6, 'ellipsis', 10]);
  });

  it('última página: elipse só antes da janela final', () => {
    expect(buildPageWindow(10, 10, 1)).toEqual([1, 'ellipsis', 9, 10]);
  });
});

describe('pageItemRange', () => {
  it('lista vazia devolve 0–0', () => {
    expect(pageItemRange(1, 25, 0)).toEqual({ from: 0, to: 0 });
  });

  it('primeira página cheia', () => {
    expect(pageItemRange(1, 25, 180)).toEqual({ from: 1, to: 25 });
  });

  it('última página parcial não passa do total', () => {
    expect(pageItemRange(8, 25, 180)).toEqual({ from: 176, to: 180 });
  });
});
