/**
 * Estimativa client-side de duração, só para preview antes de criar a busca
 * (a API só calcula `estimatedDurationMinutes` de verdade em
 * `POST /api/v1/searches`, depois que a busca já existe — ver
 * `search.contract.ts`). Mesma heurística documentada no comentário do
 * contrato ("totalTasks * ~40s / concorrência") e em ARQUITETURA.md §5.3
 * (`SCRAPE_CONCURRENCY` default 2) / §2587 (~40s por município). Puramente
 * para exibição — se o Vega expuser essa mesma constante via API no futuro,
 * troca-se por ela.
 */
const AVG_SECONDS_PER_CITY = 40;
const ASSUMED_CONCURRENCY = 2;

export function estimateSearchDurationMinutes(cityCount: number): number {
  if (cityCount <= 0) return 0;
  return Math.max(1, Math.round((cityCount * AVG_SECONDS_PER_CITY) / ASSUMED_CONCURRENCY / 60));
}
