/**
 * lib/health-check-config.ts — envs da fatia MÍNIMA do `health-check.job`
 * que entra na Fase 4 (ARQUITETURA §6.6/§6.9): ping na Evolution (3 falhas
 * seguidas → halt em todas as campanhas `running`) e taxa de falha > 30% em
 * 50 envios → instância `degraded` + warmup congelado.
 *
 * Mesmo espírito de `dispatch-config.ts` (ARQUITETURA §6.8.6 já expõe
 * `DISPATCH_UNCERTAIN_DEGRADE_AT`/`_HALT_AT` como env, mesmo sendo "número da
 * política" — este arquivo segue a MESMA convenção para os 2 números
 * equivalentes do health-check). Lido só aqui — zero `process.env` em
 * `packages/*`.
 *
 * `parsedPositiveInt` é uma pequena duplicação DELIBERADA de
 * `dispatch-config.ts` (não exportada de lá) — mesmo padrão de duplicação
 * documentada já usado em outros pontos do worker (ex.: nome de fila em
 * `queues.ts` vs. `apps/web/lib/queue.ts`): 4 linhas, sem motivo para criar
 * um módulo `lib/env-parsing.ts` só para isto.
 */

export type HealthCheckConfig = {
  /** `DISPATCH_HEALTH_CHECK_INTERVAL_S` (default 90s, ARQUITETURA §6.6 "health-check, ~90s") — período do job repetível. */
  intervalMs: number;
  /** `DISPATCH_HEALTH_CHECK_PING_HALT_AT` (default 3) — falhas de ping CONSECUTIVAS na Evolution → halt em todas as campanhas `running`. */
  pingConsecutiveFailuresHaltAt: number;
  /** `DISPATCH_HEALTH_CHECK_FAILURE_RATE_SAMPLE` (default 50) — tamanho da janela de envios resolvidos (sent/delivered/read/failed) por instância avaliada. */
  failureRateSampleSize: number;
  /** `DISPATCH_HEALTH_CHECK_FAILURE_RATE_THRESHOLD` (default 0.3 = 30%) — acima disso, `isDegraded=true` + `warmupFrozenAt` (congela o warmup-roll.job). */
  failureRateThreshold: number;
};

function parsedPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Fração entre 0 e 1 (exclusive de negativo/>1) — devolve o fallback para qualquer valor fora do intervalo, nunca clampa silenciosamente para a borda (evitaria mascarar um valor de env digitado errado, ex. "30" em vez de "0.3"). */
function parsedRateFraction(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
}

export function resolveHealthCheckConfig(env: Record<string, string | undefined>): HealthCheckConfig {
  return {
    intervalMs: parsedPositiveInt(env.DISPATCH_HEALTH_CHECK_INTERVAL_S, 90) * 1000,
    pingConsecutiveFailuresHaltAt: parsedPositiveInt(env.DISPATCH_HEALTH_CHECK_PING_HALT_AT, 3),
    failureRateSampleSize: parsedPositiveInt(env.DISPATCH_HEALTH_CHECK_FAILURE_RATE_SAMPLE, 50),
    failureRateThreshold: parsedRateFraction(env.DISPATCH_HEALTH_CHECK_FAILURE_RATE_THRESHOLD, 0.3),
  };
}
