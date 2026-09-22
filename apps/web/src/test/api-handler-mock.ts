/**
 * test/api-handler-mock.ts — substituto leve de `lib/api-handler.ts` para os
 * testes de `lib/services/*`. Não é o `api-handler.ts` de verdade por dois
 * motivos:
 *   1. Ele está sendo alterado em paralelo nesta rodada (ver handoff do
 *      Atlas) — importar o real acoplaria estes testes a um arquivo instável.
 *   2. O real importa `next-auth`/`next/server` (Auth.js completo) só para
 *      expor 5 funções que lançam um erro tipado — peso desnecessário para
 *      testar regra de negócio pura.
 *
 * Uso: `vi.mock('@/lib/api-handler', apiHandlerMockFactory)` no topo do
 * arquivo de teste (funciona porque é uma função IMPORTADA, não uma const
 * local — não cai na armadilha de hoisting do `vi.mock`).
 */
import { vi } from 'vitest';

export class FakeApiHttpError extends Error {
  readonly code: string;
  readonly details?: unknown;
  /** `reason` — 🆕 v1.1 (ARQUITETURA §4.0), ver `packages/contracts/src/common.ts`. */
  readonly reason?: string;

  constructor(code: string, message: string, details?: unknown, reason?: string) {
    super(message);
    this.name = 'ApiHttpError';
    this.code = code;
    this.details = details;
    this.reason = reason;
  }
}

export function apiHandlerMockFactory() {
  return {
    ApiHttpError: FakeApiHttpError,
    badRequest: vi.fn((message: string, details?: unknown, reason?: string) => {
      throw new FakeApiHttpError('VALIDATION_ERROR', message, details, reason);
    }),
    unauthorized: vi.fn((message = 'Sessão inválida ou expirada. Faça login novamente.') => {
      throw new FakeApiHttpError('UNAUTHORIZED', message);
    }),
    forbidden: vi.fn((message = 'Você não tem permissão para esta ação.') => {
      throw new FakeApiHttpError('FORBIDDEN', message);
    }),
    notFound: vi.fn((message: string, reason?: string) => {
      throw new FakeApiHttpError('NOT_FOUND', message, undefined, reason);
    }),
    conflict: vi.fn((message: string, details?: unknown, reason?: string) => {
      throw new FakeApiHttpError('CONFLICT', message, details, reason);
    }),
    upstreamError: vi.fn((message: string, reason?: string) => {
      throw new FakeApiHttpError('UPSTREAM_ERROR', message, undefined, reason);
    }),
    rateLimited: vi.fn((message: string, reason?: string) => {
      throw new FakeApiHttpError('RATE_LIMITED', message, undefined, reason);
    }),
  };
}
