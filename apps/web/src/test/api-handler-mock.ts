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

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiHttpError';
    this.code = code;
    this.details = details;
  }
}

export function apiHandlerMockFactory() {
  return {
    ApiHttpError: FakeApiHttpError,
    badRequest: vi.fn((message: string, details?: unknown) => {
      throw new FakeApiHttpError('VALIDATION_ERROR', message, details);
    }),
    unauthorized: vi.fn((message = 'Sessão inválida ou expirada. Faça login novamente.') => {
      throw new FakeApiHttpError('UNAUTHORIZED', message);
    }),
    forbidden: vi.fn((message = 'Você não tem permissão para esta ação.') => {
      throw new FakeApiHttpError('FORBIDDEN', message);
    }),
    notFound: vi.fn((message: string) => {
      throw new FakeApiHttpError('NOT_FOUND', message);
    }),
    conflict: vi.fn((message: string, details?: unknown) => {
      throw new FakeApiHttpError('CONFLICT', message, details);
    }),
    upstreamError: vi.fn((message: string) => {
      throw new FakeApiHttpError('UPSTREAM_ERROR', message);
    }),
  };
}
