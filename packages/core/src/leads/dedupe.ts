/**
 * leads/dedupe.ts — chave natural de deduplicação de Lead + a lista dos
 * ÚNICOS campos que um re-scraping pode atualizar. Ver ARQUITETURA §3.2
 * regra 1 e o handoff do Cronos: "dado humano vence dado de máquina, sem
 * exceção".
 */
import { slugify } from '../locations/uf.js';

/**
 * ⚠️ Único ponto de verdade dos campos que o UPSERT de (re-)scraping pode
 * escrever num `Lead` já existente. Todo o resto do model é HUMANO (status,
 * notes, tags, ownerId — só operador ou funil de mensageria escrevem) ou de
 * ORIGEM (imutável desde a criação, LGPD §7.2) — ver os blocos comentados em
 * `packages/db/prisma/schema.prisma` no model `Lead`.
 *
 * O worker (próxima rodada de Vega) DEVE montar o `update:` do
 * `prisma.lead.upsert(...)` passando por `buildMachineUpdate` abaixo, nunca
 * espalhando um objeto literal solto — é isso que transforma "alguém
 * adicionou `status` aqui num refactor" de bug silencioso em erro de tipo +
 * exceção em runtime.
 */
export const MACHINE_UPDATABLE_FIELDS = [
  'name',
  'phoneRaw',
  'phoneE164',
  'phoneType',
  'address',
  'website',
  'category',
  'rating',
  'reviewCount',
  'latitude',
  'longitude',
  'lastSeenAt',
  // 🆕 2026-09-23: DERIVADO de `category` (acima, máquina/mutável) + o nicho
  // da busca de ORIGEM (`Lead.searchJobId`, imutável) — recalculado a cada
  // upsert para acompanhar uma correção de categoria do Google Maps entre
  // uma coleta e outra. Ver packages/core/src/leads/niche.ts (`isOffNiche`)
  // para o critério e a limitação sobre recoleta por outra busca.
  'offNiche',
] as const;
export type MachineUpdatableField = (typeof MACHINE_UPDATABLE_FIELDS)[number];

/**
 * Campos HUMANO ou de ORIGEM — o upsert de scraping NUNCA pode tocar aqui.
 * Existe só para o teste `dedupe.test.ts` provar, por interseção de
 * conjuntos, que nenhum destes vazou para `MACHINE_UPDATABLE_FIELDS`.
 */
export const HUMAN_OR_ORIGIN_FIELDS = [
  'status',
  'notes',
  'tags',
  'ownerId',
  'sourceType',
  'sourceUrl',
  'sourceQuery',
  'collectedAt',
  'searchJobId',
  'searchTaskId',
  'engineId',
] as const;

const MACHINE_FIELD_SET: ReadonlySet<string> = new Set(MACHINE_UPDATABLE_FIELDS);

/**
 * Monta o `data` de um `prisma.lead.upsert({ update: ... })` restrito a
 * `MACHINE_UPDATABLE_FIELDS`. TypeScript já rejeita, em tempo de compilação,
 * um objeto literal com chave fora de `MachineUpdatableField` (excess
 * property check); o `throw` em runtime cobre o caso de alguém montar o
 * objeto dinamicamente (spread, `Object.assign`, etc.) e ainda assim tentar
 * passar um campo humano por engano.
 */
export function buildMachineUpdate<T extends Partial<Record<MachineUpdatableField, unknown>>>(
  fields: T,
): T {
  const forbidden = Object.keys(fields).filter((key) => !MACHINE_FIELD_SET.has(key));
  if (forbidden.length > 0) {
    throw new Error(
      `buildMachineUpdate: campo(s) fora de MACHINE_UPDATABLE_FIELDS (não pode vir de re-scraping): ${forbidden.join(', ')}`,
    );
  }
  return fields;
}

export type DedupeKeyInput = {
  /** cid/place id do Google Maps, quando capturado — maior precedência. */
  externalRef?: string | null;
  /** Telefone já normalizado em E.164 — segunda precedência. */
  phoneE164?: string | null;
  /** Nome da empresa — usado junto com `cityIbgeCode` como último recurso. */
  name: string;
  /** Código IBGE (7 dígitos) do município onde o lead foi coletado. */
  cityIbgeCode: string;
};

/**
 * Chave de deduplicação materializada (ARQUITETURA §3.2, regra 1; ver também
 * o comentário do campo `Lead.dedupeKey` em schema.prisma), nesta ordem de
 * precedência:
 *   1. `externalRef` (cid/place id do Maps), se capturado — mais confiável;
 *   2. senão `phoneE164` normalizado;
 *   3. senão `slug(name) + ':' + cityIbgeCode`.
 *
 * Retorna literalmente o `externalRef`/`phoneE164` nos dois primeiros casos
 * (sem prefixo artificial) porque é assim que o contrato está descrito —
 * colisão entre os três formatos é praticamente impossível (place id do
 * Maps, `+55...` em E.164, e `slug:7-digitos` têm formatos visualmente
 * incompatíveis).
 */
export function computeDedupeKey(input: DedupeKeyInput): string {
  const externalRef = input.externalRef?.trim();
  if (externalRef) return externalRef;

  const phoneE164 = input.phoneE164?.trim();
  if (phoneE164) return phoneE164;

  return `${slugify(input.name)}:${input.cityIbgeCode}`;
}
