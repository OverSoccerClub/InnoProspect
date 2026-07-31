/**
 * extraction/types.ts — tipos da camada de extração. Sem I/O, sem Playwright
 * (só shapes de dado). Ver ARQUITETURA §5.1/§5.5.
 */

/** Saída de `extract-card.ts` — bruto, ainda como veio do HTML (strings, sem parsing numérico). */
export type RawBusiness = {
  name: string | null;
  phoneRaw: string | null;
  address: string | null;
  category: string | null;
  /** Texto/aria-label bruto de onde a nota é extraída (ex.: "4,5 estrelas"). */
  ratingRaw: string | null;
  /** Texto/aria-label bruto de onde a contagem de avaliações é extraída (ex.: "(123)"). */
  reviewCountRaw: string | null;
  website: string | null;
  /** cid/place id — extração best-effort a partir da URL do card (ver normalize.ts). */
  externalRef: string | null;
  /** URL da ficha do negócio (href do card), quando encontrado. */
  detailUrl: string | null;
};

export type CityContext = {
  name: string;
  uf: string;
  ibgeCode: string;
};

/** Contexto necessário para `normalize()` transformar `RawBusiness` em `ScrapedBusiness`. */
export type NormalizeContext = {
  city: CityContext;
  /** URL da página de busca de onde este card veio — fallback de `sourceUrl` quando não há `detailUrl`. */
  searchResultUrl: string;
};

/**
 * Saída de `normalize()` — o contrato público do motor de busca
 * (ARQUITETURA §5.1). `name` é o único campo obrigatório; todo o resto pode
 * faltar (o Maps nem sempre publica telefone/site/coordenadas).
 */
export type ScrapedBusiness = {
  name: string;
  phoneRaw: string | null;
  address: string | null;
  cityGuess: string | null;
  website: string | null;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  latitude: number | null;
  longitude: number | null;
  externalRef: string | null;
  /** ⚖️ obrigatório — LGPD, registro de origem (ARQUITETURA §7). */
  sourceUrl: string;
};
