/**
 * leads/niche.ts — critério de divergência de nicho ("fora do nicho"), sem
 * I/O (ARQUITETURA §2/§3). Nasceu do relato do dono, 2026-09-23: a busca
 * "escritório de arquitetura" trouxe, entre os bons, Magazine Luiza ("Loja de
 * departamentos"), Cartório Benicio ("Cartório de Registro"), INFONOT
 * COMPUTADORES ("Assistência Técnica") e Ciano Cópias ("Copiadora") — o
 * Google Maps devolve resultados PRÓXIMOS, não só o nicho exato.
 *
 * DECISÃO DO DONO (não reabrir): marcar, nunca descartar. `isOffNiche` só
 * PRODUZ o sinal — nenhum chamador pode usar isto para excluir um lead da
 * coleta ou da listagem por padrão.
 *
 * CRITÉRIO (precisa ser explicável — o dono vai olhar os marcados e julgar
 * se acertou):
 *   1. Extrai as palavras SIGNIFICATIVAS do nicho da busca e da categoria
 *      devolvida pelo Google Maps (minúsculas, sem acento, sem pontuação,
 *      descartando stopwords em pt-BR e palavras com menos de
 *      `MIN_TOKEN_LENGTH` letras).
 *   2. Reduz cada palavra a um PREFIXO de `STEM_PREFIX_LENGTH` letras — uma
 *      raiz simples, não um stemmer linguístico de verdade — para casar
 *      variações como "arquitetura"/"arquiteto"/"arquitetônico" sem precisar
 *      de uma lista de sinônimos.
 *   3. Se NENHUMA raiz da categoria aparece entre as raízes do nicho, o lead
 *      é marcado como fora do nicho. Basta UMA raiz em comum para considerar
 *      aderente — é uma regra deliberadamente permissiva (falso negativo é
 *      mais barato que falso positivo: o dono pediu para nunca descartar, e
 *      marcar demais deixa a lista de "fora do nicho" com ruído que ele
 *      precisa raspar na mão).
 *   4. Sem categoria coletada, NÃO marcamos (`false`) — ausência de evidência
 *      não é evidência de divergência.
 *
 * COMO MUDAR O CRITÉRIO DEPOIS (sem migração de schema): é código puro, não
 * configuração em banco — ajuste `STOPWORDS`/`MIN_TOKEN_LENGTH`/
 * `STEM_PREFIX_LENGTH` (ou troque o algoritmo inteiro) aqui e faça deploy.
 * Isso NÃO recalcula sozinho os leads já persistidos (o valor de
 * `Lead.offNiche` é gravado no upsert do worker, ver
 * `apps/worker/src/jobs/scrape-search.job.ts`) — rode
 * `apps/worker/src/scripts/backfill-off-niche.ts` depois do deploy para
 * recalcular a base existente com o critério novo.
 *
 * LIMITAÇÃO ACEITA (o mesmo estabelecimento pode ser recoletado por outra
 * busca): `isOffNiche` é uma função pura — ela não sabe nada sobre qual
 * busca "é a certa". Quem decide isso é o CHAMADOR: o worker sempre compara
 * a categoria atual contra o nicho da busca de ORIGEM do lead
 * (`Lead.searchJobId`, imutável por desenho — ver schema.prisma), nunca
 * contra o nicho da busca que disparou o re-scraping. Efeito colateral
 * aceito: se a MESMA empresa for recoletada por uma busca de nicho diferente
 * (ex.: "cartório" encontrando de novo o Cartório Benicio, que já existia
 * como lead da busca "escritório de arquitetura"), o lead continua marcado
 * como fora do nicho da busca ORIGINAL — ele não "migra" para a busca nova.
 * Não há como resolver isso sem deixar de tratar `searchJobId` como imutável
 * (regra de origem/LGPD, fora do escopo desta mudança).
 */

/** Palavras funcionais em pt-BR sem valor de classificação — puro ruído para este critério. */
const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para', 'com', 'a', 'o', 'as', 'os',
  'um', 'uma', 'uns', 'umas', 'no', 'na', 'nos', 'nas', 'ao', 'aos',
]);

/** Palavra com menos letras que isto é ruído demais para decidir divergência (ex.: "de", "e" já caem em STOPWORDS; isto pega o resto). */
const MIN_TOKEN_LENGTH = 3;

/** Tamanho do prefixo usado como "raiz" — casa variações de gênero/número/grau sem stemmer linguístico de verdade. */
const STEM_PREFIX_LENGTH = 5;

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Palavras significativas de um texto: minúsculas, sem acento/pontuação, sem stopword, sem palavra curta demais. */
function significantTokens(text: string): string[] {
  return stripAccents(text.toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(token));
}

function stem(token: string): string {
  return token.length > STEM_PREFIX_LENGTH ? token.slice(0, STEM_PREFIX_LENGTH) : token;
}

/**
 * `true` quando a categoria do Google Maps não compartilha nenhuma raiz de
 * palavra com o nicho da busca — ver o comentário do módulo para o critério
 * completo e a limitação aceita sobre re-coleta por outra busca.
 *
 * @param niche Nicho da busca de ORIGEM do lead (`SearchJob.niche` de `Lead.searchJobId` — nunca da busca que disparou o re-scraping).
 * @param category Categoria capturada do Google Maps (`Lead.category`) — pode ser `null`/vazia.
 */
export function isOffNiche(niche: string, category: string | null | undefined): boolean {
  if (!category?.trim()) return false; // sem evidência, não marcamos

  const nicheStems = new Set(significantTokens(niche).map(stem));
  const categoryStems = new Set(significantTokens(category).map(stem));
  if (nicheStems.size === 0 || categoryStems.size === 0) return false;

  for (const categoryStem of categoryStems) {
    if (nicheStems.has(categoryStem)) return false; // ao menos uma raiz em comum -> aderente
  }
  return true;
}
