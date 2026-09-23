/**
 * lib/pagination.ts — matemática pura de paginação numerada (página + registros
 * por página), compartilhada entre `mocks/leads.ts` e a tela de leads. Fica
 * fora de qualquer componente para poder ser testada sem React e para o
 * `Pagination` (`components/common/pagination.tsx`) e os mocks nunca
 * divergirem sobre "o que é a última página válida".
 *
 * As opções de tamanho de página (`25|50|100`) vêm de `@inno/contracts`
 * (`LEAD_PAGE_SIZES`, publicado pelo Vega em paralelo, 2026-09-23,
 * `leadPaginationQuerySchema`) — importe de lá, não daqui, para o front e o
 * backend nunca divergirem sobre quais tamanhos existem.
 */
import { LEAD_PAGE_SIZES } from '@inno/contracts';

/** `pageSize` fora do conjunto aceito (ex.: veio quebrado de uma URL) cai no default. */
export function normalizePageSize(size: number | undefined, allowed: readonly number[] = LEAD_PAGE_SIZES, fallback = 25): number {
  return size !== undefined && allowed.includes(size) ? size : fallback;
}

/**
 * `0` quando não há nenhum resultado (não `1`) — é o sinal que `clampPage` e a
 * UI usam para saber que não existe página nenhuma para mostrar controles.
 */
export function computeTotalPages(total: number, pageSize: number): number {
  if (pageSize <= 0 || total <= 0) return 0;
  return Math.ceil(total / pageSize);
}

/**
 * Garante que a página pedida nunca ultrapasse a última válida — o caso real
 * que motivou isto: o operador está na página 7, aplica um filtro que reduz o
 * resultado para 3 páginas, e a "página 7" que ele estava vendo não existe
 * mais. Em vez de devolver uma lista vazia sem explicação, cai na última
 * página que ainda existe (ou na 1ª, se não houver nenhum resultado).
 */
export function clampPage(page: number, totalPages: number): number {
  if (totalPages <= 0) return 1;
  if (page < 1) return 1;
  if (page > totalPages) return totalPages;
  return page;
}

/**
 * Janela de números de página ao redor da atual, com `'ellipsis'` nos saltos —
 * nunca renderiza uma linha com centenas de botões. Sempre inclui a primeira e
 * a última página, mais `siblings` de cada lado da atual.
 */
export function buildPageWindow(current: number, totalPages: number, siblings = 1): Array<number | 'ellipsis'> {
  if (totalPages <= 0) return [];

  const pages = new Set<number>([1, totalPages]);
  for (let i = current - siblings; i <= current + siblings; i++) {
    if (i >= 1 && i <= totalPages) pages.add(i);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const result: Array<number | 'ellipsis'> = [];
  for (let i = 0; i < sorted.length; i++) {
    const page = sorted[i]!;
    if (i > 0 && page - sorted[i - 1]! > 1) result.push('ellipsis');
    result.push(page);
  }
  return result;
}

/** Intervalo 1-based `[primeiro, último]` de itens exibidos na página — para o texto "Mostrando 26–50 de 180". */
export function pageItemRange(page: number, pageSize: number, total: number): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 };
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return { from, to };
}
