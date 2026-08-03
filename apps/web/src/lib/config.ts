/**
 * Liga/desliga a camada de mocks locais em uma linha só.
 *
 * Cada módulo em `lib/api/*` checa esta flag: se `true`, devolve fixtures de
 * `mocks/`; se `false`, chama a API de verdade via `lib/fetcher.ts`.
 *
 * ⚠️ O DEFAULT É DADO REAL, e isso é decisão de segurança, não de estilo.
 *
 * A versão anterior era `!== 'false'` — ou seja, qualquer ambiente que não
 * declarasse a variável servia dado FALSO, silenciosamente. A única coisa que
 * separava a produção de mostrar leads inventados era um `ARG` no Dockerfile;
 * se ele sumisse num refactor, o sistema passaria a mentir sem nenhum sinal.
 * Isso é fail-open: o modo degradado tem que ser o difícil de ativar, não o
 * padrão. (Achado da Nova na revisão da Fase 3.)
 *
 * Para desenvolver com mocks, ligue explicitamente:
 *   NEXT_PUBLIC_USE_MOCKS=true pnpm dev
 */
export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

/** Delay artificial pros mocks simularem latência de rede (ajuda a ver loading states). */
export const MOCK_DELAY_MS = 350;
