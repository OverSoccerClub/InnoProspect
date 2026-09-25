/**
 * Nível de vida do WORKER do motor de disparo, a partir de `lastTickAt`
 * (`GET /api/v1/dispatch/queue`, ver `lib/services/dispatch.ts`).
 *
 * Isto é DELIBERADAMENTE separado de `DispatchQueueStatus` ('paused' |
 * 'running'): aquele é a decisão do OPERADOR (pausei/retomei); este é se o
 * PROCESSO do worker está de pé. O heartbeat é gravado de propósito mesmo
 * com o motor pausado (ARQUITETURA §6.8.9) — as duas coisas podem ser
 * verdade ao mesmo tempo, e a tela (`components/dispatch/*`) precisa
 * conseguir dizer as duas juntas sem virar sopa.
 *
 * A matemática do limiar vem do lado do worker
 * (`apps/worker/src/lib/dispatch-state.ts`): o heartbeat é escrito a cada
 * `DISPATCH_TICK_INTERVAL_MS` (15s) com `SET ... EX 45`
 * (`DISPATCH_HEARTBEAT_TTL_SECONDS`). Ou seja:
 *   - Enquanto o worker está vivo, a idade do heartbeat oscila entre 0 e ~15s
 *     (reset a cada tick) — nunca deveria passar disso em operação normal.
 *   - Se o worker perder UM tick (hiccup, mas ainda vivo), a idade sobe até
 *     ~30s antes do próximo `SET` — ainda dentro da folga do TTL.
 *   - Se o worker morreu de verdade, a chave no Redis SOME depois de 45s sem
 *     escrita — `lastTickAt` vira `null` na API, indistinguível de "nunca
 *     rodou". Por isso `dead` cobre as duas leituras: a API não tenta
 *     diferenciá-las (não dá, o dado já não existe), e a tela também não deve
 *     fingir que sabe.
 */

/** 2x o intervalo de tick (15s) — tolera perder 1 batida sem já soar alarme. */
export const DISPATCH_HEARTBEAT_LAGGING_MS = 30_000;

export type DispatchHeartbeatLevel = 'alive' | 'lagging' | 'dead';

export function getDispatchHeartbeatLevel(lastTickAt: string | null, now: number = Date.now()): DispatchHeartbeatLevel {
  if (!lastTickAt) return 'dead';
  const lastTickMs = new Date(lastTickAt).getTime();
  if (Number.isNaN(lastTickMs)) return 'dead';
  const ageMs = now - lastTickMs;
  if (ageMs < 0) return 'alive'; // relógio do cliente atrasado em relação ao servidor — não é sinal de problema
  return ageMs < DISPATCH_HEARTBEAT_LAGGING_MS ? 'alive' : 'lagging';
}
