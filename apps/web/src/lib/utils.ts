import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combina classes condicionalmente e resolve conflitos do Tailwind
 * (ex.: "p-2 p-4" -> "p-4"). Padrão shadcn/ui.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Gerador determinístico simples (mesma seed = mesma sequência). Mora aqui
 * (não só em `mocks/utils.ts`) porque vários `mocks/*.ts` precisam dele para
 * gerar dados fictícios estáveis — `mocks/utils.ts` reexporta a partir daqui
 * para não duplicar. (`lib/spintax.ts` sorteia variação delegando a
 * `@inno/core#resolveSpintax`, que tem seu próprio gerador — não usa este.)
 */
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
