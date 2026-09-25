/**
 * whatsapp/warmup.ts — tabela de aquecimento de número novo (ARQUITETURA
 * §6.2). Lógica pura (sem Prisma/I/O) para que a API (`GET /whatsapp/instances`,
 * Vega) e o futuro `warmup-roll.job`/`dispatch-tick.job` (worker, Fase 4)
 * consumam a MESMA fonte da verdade — a tabela nunca deve ser reescrita em
 * dois lugares.
 *
 * `WhatsAppInstance.warmupDay` é avançado explicitamente pelo
 * `warmup-roll.job` (1x por dia de calendário com ao menos 1 envio) — este
 * módulo não sabe NADA sobre tempo, só responde "dado o dia X, qual é o
 * teto?".
 */

export type WarmupTier = { minDay: number; maxDay: number; dailyLimit: number };

/** CONTRATO ARQUITETURA §6.2 — não reordenar/editar sem atualizar o documento. */
export const WARMUP_TABLE: readonly WarmupTier[] = [
  { minDay: 1, maxDay: 2, dailyLimit: 20 },
  { minDay: 3, maxDay: 4, dailyLimit: 40 },
  { minDay: 5, maxDay: 7, dailyLimit: 70 },
  { minDay: 8, maxDay: 10, dailyLimit: 110 },
  { minDay: 11, maxDay: 14, dailyLimit: 160 },
  { minDay: 15, maxDay: 21, dailyLimit: 220 },
  { minDay: 22, maxDay: Infinity, dailyLimit: 300 },
];

/** Teto máximo absoluto (dia 22+, ARQUITETURA §6.2/§10 `DISPATCH_MAX_DAILY_ABSOLUTE`) — nenhum override pode ultrapassar. */
export const WARMUP_MAX_DAILY_LIMIT = 300;

/** Primeiro dia em que a instância é considerada "aquecida" (`isWarm`, ARQUITETURA §4.6/§6.2). */
export const WARMUP_WARM_DAY = 22;

/** Teto diário da tabela de warmup para `warmupDay` (dias fora da tabela, ex. `<=0`, caem no primeiro tier). */
export function dailyLimitForWarmupDay(warmupDay: number): number {
  const day = Math.max(1, Math.floor(warmupDay));
  const tier = WARMUP_TABLE.find((t) => day >= t.minDay && day <= t.maxDay);
  return tier?.dailyLimit ?? WARMUP_MAX_DAILY_LIMIT;
}

/** `true` a partir do dia 22 (ramp-up concluído, ARQUITETURA §6.2). */
export function isWarmupDayWarm(warmupDay: number): boolean {
  return warmupDay >= WARMUP_WARM_DAY;
}

/**
 * Teto diário EFETIVO de uma instância: `dailyLimitOverride` só pode REDUZIR
 * o teto da tabela, nunca aumentar acima dele (ARQUITETURA §6.2 — "o produto
 * não deixa o usuário se sabotar"). `override` nulo/ausente = usa a tabela.
 */
export function effectiveDailyLimit(warmupDay: number, override: number | null | undefined): number {
  const tableLimit = dailyLimitForWarmupDay(warmupDay);
  if (override === null || override === undefined) return tableLimit;
  return Math.min(tableLimit, Math.max(1, Math.floor(override)));
}

/**
 * Regressão automática de warmup (ARQUITETURA §6.2: "se a instância ficar
 * disconnected/banned e voltar, o warmupDay recua 30%, mín. dia 1"). 🆕 Fase
 * 4.F.5 — ligada em `apps/web/src/lib/services/instance-connection.ts#
 * applyInstanceConnectionTransition` (dentro de uma transação com `SELECT
 * ... FOR UPDATE`, para não perder a escrita concorrente do
 * `warmup-roll.job`), disparada só na transição REAL `disconnected`/`banned`
 * → `connected` (webhook `connection.update` e a reconciliação FORÇADA;
 * NUNCA na reconciliação automática da listagem, que só reconfirma instância
 * JÁ `connected` — não existe transição de queda ali para regredir).
 */
export function regressWarmupDay(currentDay: number): number {
  return Math.max(1, Math.floor(currentDay * 0.7));
}
