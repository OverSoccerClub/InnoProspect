/**
 * test/logger-mock.ts — silencia `lib/logger.ts` (console.* estruturado) nos
 * testes de serviço, para o output de `pnpm test` não ficar poluído com JSON
 * de log de cada cenário de erro esperado. Não muda o comportamento
 * testado — os serviços não fazem asserção sobre o que é logado.
 */
import { vi } from 'vitest';

export function loggerMockFactory() {
  return { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
}
