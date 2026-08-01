/**
 * errors.ts — classificação de erro da Evolution API. Mesmo espírito de
 * `packages/scraper/src/errors.ts` (ler aquele arquivo antes de mexer aqui):
 * um `MessagingError` tipado com `code` fechado + `retryable` derivado, para
 * que quem consome (dispatch worker / kill switch, ARQUITETURA §6.6) decida
 * o que fazer sem reimplementar a tabela de classificação.
 *
 * Arquivo isolado de propósito: não importa nada do resto do pacote, só é
 * importado por ele (`client/http.ts`, `client/evolution-client.ts`).
 */

export type MessagingErrorCode =
  /** Instância existe mas não está conectada ao WhatsApp — precisa de novo QR (ARQUITETURA §6.1/§6.6). */
  | 'INSTANCE_DISCONNECTED'
  /** Instância referenciada não existe na Evolution API (nome errado / já deletada). */
  | 'INSTANCE_NOT_FOUND'
  /** Número mal formado (falha antes da rede) ou confirmadamente sem WhatsApp (resposta da Evolution). */
  | 'INVALID_NUMBER'
  /** 429 — throttling da própria Evolution API. Distinto de falha transitória: ver nota em `MESSAGING_ERROR_POLICY`. */
  | 'RATE_LIMITED'
  /** 401/403 — `EVOLUTION_API_KEY` inválida/ausente. Erro de configuração, não de dado do chamador. */
  | 'AUTH_ERROR'
  /** 400/422 que não casou com nenhum padrão conhecido de instância desconectada/número inválido. */
  | 'VALIDATION_ERROR'
  /** 5xx ou erro de rede (conexão recusada/resetada) — o provedor está com problema momentâneo. */
  | 'TRANSIENT_ERROR'
  /** Timeout do nosso lado (`AbortController`). Separado de `TRANSIENT_ERROR` só para log/observabilidade mais preciso — mesma política de retry. */
  | 'TIMEOUT'
  /** Resposta em formato inesperado / status HTTP fora do mapa conhecido. */
  | 'UNKNOWN';

/**
 * Códigos retryable em algum nível (transporte OU cadência do dispatch
 * worker que ainda será implementado). `RATE_LIMITED` é retryable em nível
 * de NEGÓCIO, mas nunca em nível de TRANSPORTE — ver `MESSAGING_ERROR_POLICY`.
 */
const RETRYABLE_CODES = new Set<MessagingErrorCode>(['TRANSIENT_ERROR', 'TIMEOUT', 'RATE_LIMITED']);

export type MessagingErrorPolicy = {
  /**
   * Tentativas automáticas ADICIONAIS (retries) feitas DENTRO do cliente
   * HTTP deste pacote (transporte) — não conta a tentativa inicial. Só é
   * `> 0` para erro de rede/5xx/timeout — NUNCA para 4xx. `RATE_LIMITED`
   * fica com `0` de propósito: reagir automaticamente a um 429 batendo de
   * novo no mesmo instante conflita com a cadência deliberada do dispatch
   * worker (ARQUITETURA §6.1/§6.3 — jitter/backoff fazem parte do anti-ban,
   * não só da resiliência). Quem decide QUANDO reenviar depois de
   * `RATE_LIMITED` é a camada de cima, não este cliente.
   */
  maxAttempts: number;
  /** Backoff (ms) por tentativa de transporte — índice 0 = após a 1ª falha, antes do jitter. */
  backoffMs: number[];
};

export const MESSAGING_ERROR_POLICY: Record<MessagingErrorCode, MessagingErrorPolicy> = {
  TRANSIENT_ERROR: { maxAttempts: 2, backoffMs: [1_000, 4_000] },
  TIMEOUT: { maxAttempts: 2, backoffMs: [1_000, 4_000] },
  RATE_LIMITED: { maxAttempts: 0, backoffMs: [] },
  INSTANCE_DISCONNECTED: { maxAttempts: 0, backoffMs: [] },
  INSTANCE_NOT_FOUND: { maxAttempts: 0, backoffMs: [] },
  INVALID_NUMBER: { maxAttempts: 0, backoffMs: [] },
  AUTH_ERROR: { maxAttempts: 0, backoffMs: [] },
  VALIDATION_ERROR: { maxAttempts: 0, backoffMs: [] },
  UNKNOWN: { maxAttempts: 0, backoffMs: [] },
};

export type MessagingErrorOptions = {
  cause?: unknown;
  /** Status HTTP original, quando existir (ausente em erro de rede/timeout puro). */
  status?: number;
};

/**
 * Erro tipado do pacote de mensageria. `retryable` deriva de
 * `RETRYABLE_CODES` — quem consome (worker de disparo, kill switch) decide o
 * que fazer olhando só este campo, sem conhecer a tabela inteira.
 */
export class MessagingError extends Error {
  readonly code: MessagingErrorCode;
  readonly retryable: boolean;
  readonly status?: number;
  override readonly cause?: unknown;

  constructor(code: MessagingErrorCode, message: string, opts: MessagingErrorOptions = {}) {
    super(message);
    this.name = 'MessagingError';
    this.code = code;
    this.retryable = RETRYABLE_CODES.has(code);
    this.status = opts.status;
    this.cause = opts.cause;
  }
}

/** Aplica jitter de `±ratio` sobre `ms` — retry sincronizado é assinatura de bot (mesmo racional do scraper, ARQUITETURA §5.6). */
export function applyJitter(ms: number, ratio = 0.2): number {
  if (ms <= 0 || !Number.isFinite(ms)) return ms;
  const delta = ms * ratio;
  return Math.round(ms - delta + Math.random() * delta * 2);
}

/** Backoff (com jitter) para a tentativa `attempt` (0-based, de transporte) de um `MessagingErrorCode`. */
export function backoffForAttempt(code: MessagingErrorCode, attempt: number): number {
  const policy = MESSAGING_ERROR_POLICY[code];
  if (policy.backoffMs.length === 0) return 0;
  const base = policy.backoffMs[Math.min(attempt, policy.backoffMs.length - 1)] ?? 0;
  return applyJitter(base);
}

/** `sleep` simples baseado em Promise — usado pelo executor HTTP para os retries de transporte. */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
