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
export function mockNotFound(message: string): never {
  throw new ApiRequestError(404, { code: 'NOT_FOUND', message, requestId: 'mock' });
}
