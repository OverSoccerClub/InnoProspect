/**
 * lib/dispatch-config.ts — envs específicas do TICK (ARQUITETURA §6.8.2/
 * §6.8.3/§6.8.6/§10), separadas de `resolveSendPolicy` (`@inno/core`, que
 * cobre só janela/jitter/micro-pausa — compartilhado com o envio unitário).
 * Estas 5 aqui não têm equivalente no envio manual (lease, tentativas
 * máximas, patamares de incerto) ou são duplicação DELIBERADA de um valor
 * que já existe (janela anti-duplo-clique/cooldown de contato frio — mesma
 * proteção, mesma env, os dois caminhos de envio precisam do MESMO número).
 *
 * Lido só aqui (não em `@inno/core`/`@inno/sending` — zero `process.env` em
 * `packages/*`).
 */

export type DispatchConfig = {
  /** `DISPATCH_TICK_INTERVAL_S` (default 15s) — período do job repetível. */
  tickIntervalMs: number;
  /** `DISPATCH_LEASE_S` (default 120s) — §6.8.2: alvo reservado, expira sozinho. */
  leaseSeconds: number;
  /** `DISPATCH_MAX_ATTEMPTS` (default 3) — acima disso, `failed/max_attempts` no claim seguinte. */
  maxAttempts: number;
  /** `DISPATCH_UNCERTAIN_DEGRADE_AT` (default 3) — incertos seguidos → instância fora da rotação. */
  uncertainDegradeAt: number;
  /** `DISPATCH_UNCERTAIN_HALT_AT` (default 5) — incertos seguidos → halt da campanha. */
  uncertainHaltAt: number;
  /** `MANUAL_SEND_DUPLICATE_WINDOW_S` (default 60s) — MESMA proteção G9 do envio manual (`messages.ts`), mesma env: duplo-envio pro mesmo lead não pode acontecer só porque veio de canais diferentes. */
  duplicateWindowMs: number;
  /** `COLD_FOLLOWUP_COOLDOWN_H` (default 24h) — mesma env de `messages.ts`, G9b. */
  coldFollowupCooldownMs: number;
};

function parsedPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveDispatchConfig(env: Record<string, string | undefined>): DispatchConfig {
  return {
    tickIntervalMs: parsedPositiveInt(env.DISPATCH_TICK_INTERVAL_S, 15) * 1000,
    leaseSeconds: parsedPositiveInt(env.DISPATCH_LEASE_S, 120),
    maxAttempts: parsedPositiveInt(env.DISPATCH_MAX_ATTEMPTS, 3),
    uncertainDegradeAt: parsedPositiveInt(env.DISPATCH_UNCERTAIN_DEGRADE_AT, 3),
    uncertainHaltAt: parsedPositiveInt(env.DISPATCH_UNCERTAIN_HALT_AT, 5),
    duplicateWindowMs: parsedPositiveInt(env.MANUAL_SEND_DUPLICATE_WINDOW_S, 60) * 1000,
    coldFollowupCooldownMs: parsedPositiveInt(env.COLD_FOLLOWUP_COOLDOWN_H, 24) * 60 * 60 * 1000,
  };
}
