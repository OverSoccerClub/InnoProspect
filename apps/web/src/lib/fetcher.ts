import type { ApiErrorBody, ApiErrorCode } from '@/types/common';

// Base fica vazia (mesma origem) — as rotas já incluem o prefixo /api/v1
// (ARQUITETURA.md §4.0). Ajustável via env se um dia o front for servido
// separado da API.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

/**
 * Erro tipado que representa o envelope de erro padrão da API
 * (ARQUITETURA.md §4.0). Sempre prefira `error.message` para exibir ao
 * usuário — já vem em pt-BR e pronta pra tela.
 */
export class ApiRequestError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /**
   * Sub-código legível por máquina (ARQUITETURA.md §4.0/§4.9.7) — ex.:
   * `OPTED_OUT`, `DAILY_LIMIT_REACHED`, `QUIET_HOURS`. Use isto para
   * ramificar a UI de erro; `message` é só para exibir ao usuário.
   */
  readonly reason?: string;
  /** `path` pode ser um nome de campo (validação) ou uma chave semântica como `resetsAt`/`optedOutAt` (regra de negócio) — ver nota em `types/common.ts`. */
  readonly details?: Array<{ path: string; message: string }>;
  readonly requestId: string;

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body.code;
    this.reason = body.reason;
    this.details = body.details;
    this.requestId = body.requestId;
  }
}

export type QueryParams = Record<
  string,
  string | number | boolean | readonly string[] | undefined | null
>;

/** Monta querystring tratando arrays como CSV, conforme os contratos de listagem. */
export function toQueryString(params?: QueryParams): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      search.set(key, value.join(','));
    } else {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiRequestError(0, {
      code: 'UPSTREAM_ERROR',
      message: 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.',
      requestId: 'network-error',
    });
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    if (body && typeof body === 'object' && 'error' in body) {
      throw new ApiRequestError(res.status, (body as ApiErrorBody).error);
    }
    throw new ApiRequestError(res.status, {
      code: 'INTERNAL_ERROR',
      message: `Erro inesperado (HTTP ${res.status}). Tente novamente em instantes.`,
      requestId: 'unknown',
    });
  }

  return body as T;
}

export function apiGet<T>(path: string, params?: QueryParams): Promise<T> {
  return request<T>(`${path}${toQueryString(params)}`, { method: 'GET' });
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined });
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}
