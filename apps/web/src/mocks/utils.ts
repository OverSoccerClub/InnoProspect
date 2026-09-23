import { MOCK_DELAY_MS } from '@/lib/config';
import { ApiRequestError } from '@/lib/fetcher';

// mulberry32/pick moraram aqui antes; agora vivem em `lib/utils.ts` (também
// usados por `lib/spintax.ts`, que não pode depender de `mocks/`) e são só
// reexportados por conveniência para quem já importava daqui.
export { mulberry32, pick } from '@/lib/utils';

/** Simula latência de rede para os mocks — ajuda a ver estados de loading de verdade. */
export function mockDelay(ms = MOCK_DELAY_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Simula o 404 { error } da API pra exercitar o estado de erro nas telas. */
export function mockNotFound(message: string, reason?: string): never {
  throw new ApiRequestError(404, { code: 'NOT_FOUND', reason, message, requestId: 'mock' });
}

/** Simula um `403 FORBIDDEN` — autoproteção (não se autoexcluir/autorrebaixar) e checagens de papel que o servidor recusa antes de tudo mais. */
export function mockForbidden(message: string, reason?: string): never {
  throw new ApiRequestError(403, { code: 'FORBIDDEN', reason, message, requestId: 'mock' });
}

/** Simula um `409 CONFLICT` com `reason` (ARQUITETURA §4.0 v1.1) e `details[]` opcional (campo OU meta pontual, ver `types/common.ts`). */
export function mockConflict(
  reason: string,
  message: string,
  opts?: { details?: Array<{ path: string; message: string }> },
): never {
  throw new ApiRequestError(409, { code: 'CONFLICT', reason, message, details: opts?.details, requestId: 'mock' });
}

/** Simula um `422 VALIDATION_ERROR` com `reason` — usado pelos gates de payload do envio de mensagem. */
export function mockValidationError(reason: string, message: string): never {
  throw new ApiRequestError(422, { code: 'VALIDATION_ERROR', reason, message, requestId: 'mock' });
}

/** Simula um `502 UPSTREAM_ERROR` — falha do provedor (Evolution), nunca `500` (ARQUITETURA §4.9.5). */
export function mockUpstreamError(reason: string, message: string): never {
  throw new ApiRequestError(502, { code: 'UPSTREAM_ERROR', reason, message, requestId: 'mock' });
}
