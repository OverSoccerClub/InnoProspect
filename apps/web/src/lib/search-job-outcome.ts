import type { SearchJobStatus, SearchJobSummary } from '@/types/search';

/**
 * `status === 'completed'` só diz "o job terminou de processar todas as
 * tasks" — não diz NADA sobre o resultado. Uma busca pode terminar com os
 * 5 municípios falhando e 0 leads coletados, e o `status` da API continua
 * `'completed'` (bug real relatado pelo dono em produção: selo verde
 * "Concluída" em cima de fracasso total). `failed` no nível do job é outra
 * coisa — o job em si não conseguiu nem rodar/continuar (crash), não "rodou
 * e todo mundo falhou".
 *
 * Este helper deriva o resultado visual real a partir de `progress` (campos
 * que a API já expõe — `done`/`failed`/`total`, ver `search.contract.ts`),
 * sem inventar nenhum campo novo de contrato.
 */
export type SearchJobOutcome =
  | Exclude<SearchJobStatus, 'completed'>
  | 'completed_success'
  | 'completed_partial'
  | 'completed_empty';

export function getSearchJobOutcome(job: Pick<SearchJobSummary, 'status' | 'progress'>): SearchJobOutcome {
  if (job.status !== 'completed') return job.status;
  const { done, failed, total } = job.progress;
  if (total === 0 || failed === 0) return 'completed_success';
  if (done === 0) return 'completed_empty';
  return 'completed_partial';
}
