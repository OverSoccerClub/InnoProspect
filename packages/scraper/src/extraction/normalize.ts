/**
 * extraction/normalize.ts — `RawBusiness` (bruto, strings) → `ScrapedBusiness`
 * (domínio: números tipados, contexto de cidade aplicado). Puro, sem I/O —
 * testável sem fixture de HTML, só com objetos `RawBusiness` construídos à
 * mão (ver normalize.test.ts).
 */
import type { NormalizeContext, RawBusiness, ScrapedBusiness } from './types.js';

/**
 * Extrai o primeiro número (aceitando vírgula decimal, comum em pt-BR) de
 * uma string como `"4,5 estrelas"` ou `"4.5"`. `null` se nada for
 * reconhecível — melhor não adivinhar (fill-rate de A4, ARQUITETURA §5.7,
 * mede exatamente isso).
 */
function parseRating(raw: string | null): number | null {
  if (!raw) return null;
  const match = raw.replace(',', '.').match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const value = Number.parseFloat(match[0]);
  if (!Number.isFinite(value)) return null;
  // Fora de 0-5 é dado ruim (seletor pegou o campo errado) — normalize()
  // devolve o valor mesmo assim (não é papel desta função silenciar isso);
  // é exatamente o que a assertion A4 (sanity/assertions.ts) vai flagar.
  return value;
}

/** Extrai a contagem de avaliações de algo como `"(123)"` ou `"123 avaliações"`. */
function parseReviewCount(raw: string | null): number | null {
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, '');
  if (digits.length === 0) return null;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * Latitude/longitude best-effort a partir do padrão `@lat,lng,zoom` presente
 * em URLs de ficha do Maps. `null` quando a URL não tem esse padrão (comum —
 * nem toda URL de card carrega coordenada explícita).
 */
function parseLatLngFromUrl(url: string | null): { latitude: number; longitude: number } | null {
  if (!url) return null;
  const match = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+),/);
  if (!match) return null;
  const latitude = Number.parseFloat(match[1] ?? '');
  const longitude = Number.parseFloat(match[2] ?? '');
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

/**
 * Bruto → domínio. `raw.name` é obrigatório (garantido por `extractCard`
 * antes de chegar aqui — nunca chamar `normalize` com `raw.name === null`).
 */
export function normalize(raw: RawBusiness, ctx: NormalizeContext): ScrapedBusiness {
  if (!raw.name) {
    throw new Error('normalize(): RawBusiness.name é obrigatório e veio vazio — bug no chamador (extractCard já deveria ter retornado null)');
  }

  const latLng = parseLatLngFromUrl(raw.detailUrl);

  return {
    name: raw.name,
    phoneRaw: raw.phoneRaw,
    address: raw.address,
    cityGuess: ctx.city.name,
    website: raw.website,
    category: raw.category,
    rating: parseRating(raw.ratingRaw),
    reviewCount: parseReviewCount(raw.reviewCountRaw),
    latitude: latLng?.latitude ?? null,
    longitude: latLng?.longitude ?? null,
    externalRef: raw.externalRef,
    sourceUrl: raw.detailUrl ?? ctx.searchResultUrl,
  };
}
