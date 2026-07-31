/**
 * locations/uf.ts — enum de UFs e slugificação, sem I/O (ARQUITETURA §2/§3).
 *
 * A lista de UFs e o algoritmo `slugify` espelham EXATAMENTE
 * `packages/db/prisma/seed.ts` (dono: Cronos) — mesmo texto, mesma ordem de
 * transformação. Isso importa porque `slugify` aqui é usado para compor
 * `Lead.dedupeKey` (ver ../leads/dedupe.ts) e precisa produzir o mesmo
 * resultado que o slug de `City.slug` para o mesmo texto de entrada — dois
 * algoritmos de slug divergentes no mesmo sistema é a receita de um bug de
 * dedupe difícil de reproduzir. Se o seed mudar o algoritmo, mude aqui
 * também (não há import cruzado possível: core não pode depender de db).
 */

export type UfInfo = { sigla: string; nome: string; regiao: string };

export const UFS: readonly UfInfo[] = [
  { sigla: 'AC', nome: 'Acre', regiao: 'Norte' },
  { sigla: 'AL', nome: 'Alagoas', regiao: 'Nordeste' },
  { sigla: 'AP', nome: 'Amapá', regiao: 'Norte' },
  { sigla: 'AM', nome: 'Amazonas', regiao: 'Norte' },
  { sigla: 'BA', nome: 'Bahia', regiao: 'Nordeste' },
  { sigla: 'CE', nome: 'Ceará', regiao: 'Nordeste' },
  { sigla: 'DF', nome: 'Distrito Federal', regiao: 'Centro-Oeste' },
  { sigla: 'ES', nome: 'Espírito Santo', regiao: 'Sudeste' },
  { sigla: 'GO', nome: 'Goiás', regiao: 'Centro-Oeste' },
  { sigla: 'MA', nome: 'Maranhão', regiao: 'Nordeste' },
  { sigla: 'MT', nome: 'Mato Grosso', regiao: 'Centro-Oeste' },
  { sigla: 'MS', nome: 'Mato Grosso do Sul', regiao: 'Centro-Oeste' },
  { sigla: 'MG', nome: 'Minas Gerais', regiao: 'Sudeste' },
  { sigla: 'PA', nome: 'Pará', regiao: 'Norte' },
  { sigla: 'PB', nome: 'Paraíba', regiao: 'Nordeste' },
  { sigla: 'PR', nome: 'Paraná', regiao: 'Sul' },
  { sigla: 'PE', nome: 'Pernambuco', regiao: 'Nordeste' },
  { sigla: 'PI', nome: 'Piauí', regiao: 'Nordeste' },
  { sigla: 'RJ', nome: 'Rio de Janeiro', regiao: 'Sudeste' },
  { sigla: 'RN', nome: 'Rio Grande do Norte', regiao: 'Nordeste' },
  { sigla: 'RS', nome: 'Rio Grande do Sul', regiao: 'Sul' },
  { sigla: 'RO', nome: 'Rondônia', regiao: 'Norte' },
  { sigla: 'RR', nome: 'Roraima', regiao: 'Norte' },
  { sigla: 'SC', nome: 'Santa Catarina', regiao: 'Sul' },
  { sigla: 'SP', nome: 'São Paulo', regiao: 'Sudeste' },
  { sigla: 'SE', nome: 'Sergipe', regiao: 'Nordeste' },
  { sigla: 'TO', nome: 'Tocantins', regiao: 'Norte' },
] as const;

export type UfSigla = (typeof UFS)[number]['sigla'];

const UF_SIGLAS = new Set<string>(UFS.map((uf) => uf.sigla));

/** `true` se `sigla` for uma das 27 UFs válidas (2 letras maiúsculas). */
export function isValidUf(sigla: string): sigla is UfSigla {
  return UF_SIGLAS.has(sigla);
}

export function getUfInfo(sigla: string): UfInfo | undefined {
  return UFS.find((uf) => uf.sigla === sigla);
}

/**
 * Slug ASCII: remove acentos, minúsculas, tudo que não é `[a-z0-9]` vira
 * `-`, sem `-` nas pontas. Usado para nome de município (deve bater com
 * `City.slug` do seed) e para o nome do Lead na composição do dedupeKey.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove marcas diacríticas combinantes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
