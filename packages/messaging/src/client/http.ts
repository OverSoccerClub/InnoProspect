/**
 * client/http.ts — executor HTTP genérico contra a Evolution API: timeout
 * explícito (`AbortController`), classificação de erro (`MessagingError`) e
 * retry automático SÓ para erro transitório (rede/timeout/5xx) — NUNCA para
 * 4xx (RATE_LIMITED incluso, ver `errors.ts`). Isolado de `evolution-client.ts`
 * para que a classificação de status HTTP → `MessagingErrorCode` fique num
 * único lugar, testável sem montar a API pública inteira.
 */
import { MessagingError, MESSAGING_ERROR_POLICY, backoffForAttempt, sleep } from '../errors.js';
import { extractErrorMessage } from './wire.js';

export type EvolutionHttpConfig = {
  baseUrl: string;
  apiKey: string;
  /** Timeout por tentativa, em ms. Default 15s — Evolution roda na mesma rede interna (ARQUITETURA §1.2), não precisa de mais. */
  timeoutMs?: number;
  /** Injeção para teste — default `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
};

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export type HttpRequestInput = {
  method: HttpMethod;
  path: string;
  body?: unknown;
  /**
   * `false` para requisições cujo EFEITO não é seguro repetir só porque a
   * RESPOSTA se perdeu — hoje só `sendText` (achado do Órion, revisão de
   * 2026-09-22, ARQUITETURA §4.9): num timeout, ou num 5xx que só chega
   * DEPOIS de a Evolution ter recebido a chamada, não há garantia de que a
   * mensagem NÃO foi enviada. Reenviar automaticamente arrisca duplicar a
   * mensagem pro lead — no primeiro contato frio, duplicar é o próprio risco
   * de banimento que o produto existe para evitar. Default `true`: o resto
   * do cliente (criar/conectar/status/deletar instância, definir webhook,
   * checar número) é seguro de repetir — ou é idempotente por natureza (GET,
   * "criar se não existir"), ou o pior caso de duplicar é inofensivo.
   * Quando `false`, `evolutionRequest` NUNCA retenta, seja qual for o
   * `MessagingErrorCode` — a decisão de tentar de novo passa a ser do
   * CHAMADOR, que tem contexto de negócio (ver `sendLeadMessage`, que trata
   * timeout/erro transitório de envio como resultado INCERTO, não repete).
   */
  retryable?: boolean;
};

const DEFAULT_TIMEOUT_MS = 15_000;

function classifyStatus(status: number, body: unknown): MessagingError {
  const fallback = `Evolution API respondeu ${status}`;
  const message = extractErrorMessage(body, fallback);

  if (status === 401 || status === 403) {
    return new MessagingError('AUTH_ERROR', message, { status, cause: body });
  }
  if (status === 404) {
    return new MessagingError('INSTANCE_NOT_FOUND', message, { status, cause: body });
  }
  if (status === 429) {
    return new MessagingError('RATE_LIMITED', message, { status, cause: body });
  }
  if (status >= 500) {
    return new MessagingError('TRANSIENT_ERROR', message, { status, cause: body });
  }
  if (status === 400 || status === 422) {
    const lower = message.toLowerCase();
    if (/(not connected|is not open|connection closed|desconectad|instance.*not.*(open|connect))/.test(lower)) {
      return new MessagingError('INSTANCE_DISCONNECTED', message, { status, cause: body });
    }
    if (/(not exist|invalid number|not a whatsapp|not on whatsapp|n[uú]mero inv[aá]lido|number.*not.*found)/.test(lower)) {
      return new MessagingError('INVALID_NUMBER', message, { status, cause: body });
    }
    return new MessagingError('VALIDATION_ERROR', message, { status, cause: body });
  }
  return new MessagingError('UNKNOWN', message, { status, cause: body });
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function doRequest(config: EvolutionHttpConfig, input: HttpRequestInput): Promise<unknown> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}${input.path}`, {
      method: input.method,
      headers: {
        'Content-Type': 'application/json',
        apikey: config.apiKey,
      },
      body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new MessagingError('TIMEOUT', `Evolution API não respondeu em ${timeoutMs}ms`, { cause: err });
    }
    throw new MessagingError('TRANSIENT_ERROR', 'Falha de rede ao chamar a Evolution API', { cause: err });
  } finally {
    clearTimeout(timer);
  }

  const rawText = await response.text();
  const parsedBody = rawText.length > 0 ? safeJsonParse(rawText) : null;

  if (!response.ok) {
    throw classifyStatus(response.status, parsedBody);
  }
  return parsedBody;
}

/**
 * Executa uma chamada à Evolution API com timeout + retry automático de
 * TRANSPORTE — só para `TRANSIENT_ERROR`/`TIMEOUT` (rede, timeout, 5xx), e só
 * quando `input.retryable !== false`. Qualquer 4xx (incluindo
 * `RATE_LIMITED`) propaga na primeira tentativa; ver `MESSAGING_ERROR_POLICY`
 * para o porquê. Backoff sempre com jitter — retry sincronizado é assinatura
 * de bot (mesmo racional do scraper, ARQUITETURA §5.6).
 */
export async function evolutionRequest(config: EvolutionHttpConfig, input: HttpRequestInput): Promise<unknown> {
  const retryable = input.retryable ?? true;
  let attempt = 0;
  for (;;) {
    try {
      return await doRequest(config, input);
    } catch (err) {
      if (!(err instanceof MessagingError)) throw err;
      if (!retryable) throw err;
      const policy = MESSAGING_ERROR_POLICY[err.code];
      if (attempt >= policy.maxAttempts) throw err;
      await sleep(backoffForAttempt(err.code, attempt));
      attempt++;
    }
  }
}
