/**
 * Liga/desliga o camada de mocks locais em uma linha só.
 *
 * As rotas reais (§4 do ARQUITETURA.md) ainda não existem — o Vega está
 * implementando em paralelo. Cada módulo em `lib/api/*` checa esta flag: se
 * `true`, devolve fixtures de `mocks/`; se `false`, chama a API de verdade
 * via `lib/fetcher.ts`. Quando as rotas subirem, basta setar
 * NEXT_PUBLIC_USE_MOCKS=false (ou apagar a env) — nenhum componente muda.
 */
export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS !== 'false';

/** Delay artificial pros mocks simularem latência de rede (ajuda a ver loading states). */
export const MOCK_DELAY_MS = 350;
