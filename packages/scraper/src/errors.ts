/**
 * errors.ts — classificação de erro do scraper, retry e backoff.
 * Ver ARQUITETURA §5.6 (tabela de tentativas/backoff) e §5.7.
 */

export type ScrapeErrorCode =
  | 'NAVIGATION_TIMEOUT' // retryable
  | 'RATE_LIMITED' // retryable, backoff longo (429 / "unusual traffic")
  | 'CAPTCHA_DETECTED' // retryable com backoff MUITO longo + alarme
  | 'LAYOUT_CHANGED' // 🔴 FATAL — não adianta retentar, para a fila e alarma
  | 'EMPTY_RESULTS' // não é erro; alimenta o zero-streak (sanity/assertions.ts)
  | 'BROWSER_CRASH' // retryable
  | 'UNKNOWN';

export type ScrapeErrorPolicy = {
  maxAttempts: number;
  /** Backoff (ms) por tentativa (índice 0 = após a 1ª falha), antes do jitter. */
  backoffMs: number[];
  /** Se definido, a fila `scrape-search` inteira deve pausar por este tempo. */
  pauseQueueMs?: number;
  alarmSeverity?: 'high' | 'critical';
};

/** Tabela de retry/backoff — CONTRATO, ARQUITETURA §5.6. */
export const SCRAPE_ERROR_POLICY: Record<ScrapeErrorCode, ScrapeErrorPolicy> = {
  NAVIGATION_TIMEOUT: { maxAttempts: 3, backoffMs: [30_000, 120_000, 480_000] },
  BROWSER_CRASH: { maxAttempts: 3, backoffMs: [30_000, 120_000, 480_000] },
  RATE_LIMITED: {
    maxAttempts: 2,
    backoffMs: [15 * 60_000, 45 * 60_000],
    pauseQueueMs: 15 * 60_000,
  },
  CAPTCHA_DETECTED: {
    maxAttempts: 1,
    backoffMs: [60 * 60_000],
    pauseQueueMs: 60 * 60_000,
    alarmSeverity: 'high',
  },
  LAYOUT_CHANGED: {
    maxAttempts: 0,
    backoffMs: [],
    pauseQueueMs: Number.POSITIVE_INFINITY,
    alarmSeverity: 'critical',
  },
  EMPTY_RESULTS: { maxAttempts: 0, backoffMs: [] },
  UNKNOWN: { maxAttempts: 2, backoffMs: [60_000, 300_000] },
};

export type ScrapeErrorOptions = { cause?: unknown };

/**
 * Erro tipado do scraper. `retryable` deriva de `SCRAPE_ERROR_POLICY` — quem
 * consome (o worker, próxima rodada) decide se tenta de novo olhando este
 * campo, sem precisar conhecer a tabela inteira.
 */
export class ScrapeError extends Error {
  readonly code: ScrapeErrorCode;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(code: ScrapeErrorCode, message: string, opts: ScrapeErrorOptions = {}) {
    super(message);
    this.name = 'ScrapeError';
    this.code = code;
    this.retryable = SCRAPE_ERROR_POLICY[code].maxAttempts > 0;
    this.cause = opts.cause;
  }
}

/** Aplica jitter de `±ratio` sobre `ms` — nunca usar delay/backoff sem jitter (ARQUITETURA §5.6: "retry sincronizado de N jobs é um novo pico de tráfego suspeito"). */
export function applyJitter(ms: number, ratio = 0.2): number {
  if (ms <= 0 || !Number.isFinite(ms)) return ms;
  const delta = ms * ratio;
  return Math.round(ms - delta + Math.random() * delta * 2);
}

/** Delay aleatório dentro de `[minMs, maxMs]` (ex.: 8–25s entre buscas, ARQUITETURA §5.3). */
export function randomDelay(minMs: number, maxMs: number): number {
  if (maxMs <= minMs) return Math.max(0, minMs);
  return Math.round(minMs + Math.random() * (maxMs - minMs));
}

/** Backoff (com jitter) para a tentativa `attempt` (0-based) de um `ScrapeErrorCode`. */
export function backoffForAttempt(code: ScrapeErrorCode, attempt: number): number {
  const policy = SCRAPE_ERROR_POLICY[code];
  if (policy.backoffMs.length === 0) return 0;
  const base = policy.backoffMs[Math.min(attempt, policy.backoffMs.length - 1)] ?? 0;
  return applyJitter(base);
}

/** `sleep` simples baseado em Promise — usado pelo engine para os delays acima. */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
