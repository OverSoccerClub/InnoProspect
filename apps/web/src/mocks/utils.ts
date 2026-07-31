import { MOCK_DELAY_MS } from '@/lib/config';
import { ApiRequestError } from '@/lib/fetcher';

/** Simula latência de rede para os mocks — ajuda a ver estados de loading de verdade. */
export function mockDelay(ms = MOCK_DELAY_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Gerador determinístico simples (mesma seed = mesma sequência) — mocks estáveis entre reloads. */
export function mulberry32(seed: number) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(arr: readonly T[], random: () => number): T {
  const item = arr[Math.floor(random() * arr.length)];
  if (item === undefined) throw new Error('pick: array vazio');
  return item;
}

/** Simula o 404 { error } da API pra exercitar o estado de erro nas telas. */
export function mockNotFound(message: string): never {
  throw new ApiRequestError(404, { code: 'NOT_FOUND', message, requestId: 'mock' });
}
