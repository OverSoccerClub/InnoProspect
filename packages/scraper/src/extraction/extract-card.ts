/**
 * extraction/extract-card.ts — DOM (HTML de 1 card) → `RawBusiness`. Puro:
 * sem Playwright, sem rede — só um parser de HTML (cheerio). É isso que
 * permite testar 100% da extração com fixtures congeladas
 * (`../sanity/fixtures/*.html`), sem bater na internet (ARQUITETURA §5.5).
 *
 * Todo seletor usado aqui vem de `./selectors.ts` — este arquivo nunca
 * declara uma string de seletor inline (regra dura, Órion audita).
 */
import * as cheerio from 'cheerio';
import type { Cheerio } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { SELECTORS } from './selectors.js';
import type { RawBusiness } from './types.js';

/**
 * Tenta cada seletor de `selectors`, na ordem, devolvendo o primeiro
 * elemento encontrado. Um seletor com sintaxe exclusiva do Playwright (ex.:
 * `:has-text(...)`) não é compreendido pelo parser CSS deste módulo — o erro
 * é capturado e a busca segue para a próxima alternativa (ver comentário em
 * selectors.ts sobre os dois "sabores" de seletor).
 */
function queryFirst(root: Cheerio<AnyNode>, selectors: readonly string[]): Cheerio<AnyNode> | null {
  for (const selector of selectors) {
    try {
      const found = root.find(selector).first();
      if (found.length > 0) return found;
    } catch {
      continue;
    }
  }
  return null;
}

function textOf(el: Cheerio<AnyNode> | null): string | null {
  if (!el) return null;
  const text = el.text().trim();
  return text.length > 0 ? text : null;
}

function attrOf(el: Cheerio<AnyNode> | null, attr: string): string | null {
  if (!el) return null;
  const value = el.attr(attr);
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

/**
 * Extrai o place id/cid da URL de um card do Maps, best-effort. O formato é
 * o protobuf não documentado do Maps (ARQUITETURA §5.1, risco descrito na
 * opção B) — por isso isto é só um "melhor esforço": se não achar, o
 * `dedupeKey` (packages/core) cai para o próximo nível de precedência
 * (telefone, depois nome+cidade), então uma falha aqui nunca é fatal.
 */
function extractExternalRefFromUrl(url: string | null): string | null {
  if (!url) return null;
  // Padrão observado: "!1s0x<hex>:0x<hex>" dentro do path de /maps/place/...
  const cidMatch = url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  if (cidMatch?.[1]) return cidMatch[1];

  // Fallback: parâmetro de query `place_id=`.
  try {
    const parsed = new URL(url, 'https://www.google.com');
    const placeId = parsed.searchParams.get('place_id') ?? parsed.searchParams.get('q_place_id');
    if (placeId) return placeId;
  } catch {
    // URL relativa/malformada — sem place id extraível.
  }

  return null;
}

/**
 * DOM → bruto. `html` é o `outerHTML` de UM elemento de card
 * (`SELECTORS.resultCard`), não a página inteira. Retorna `null` quando nem
 * o campo obrigatório (`name`) é encontrado — sinal de que o HTML recebido
 * não é um card reconhecível (lixo de scroll, elemento decorativo, etc.).
 */
export function extractCard(html: string | null | undefined): RawBusiness | null {
  const trimmed = html?.trim();
  if (!trimmed) return null;

  const $ = cheerio.load(trimmed);
  const root = $.root();

  const nameEl = queryFirst(root, SELECTORS.card.name);
  const name = attrOf(nameEl, 'aria-label') ?? textOf(nameEl);
  if (!name) return null;

  const linkEl = queryFirst(root, SELECTORS.card.link);
  const detailUrl = attrOf(linkEl, 'href');

  const ratingEl = queryFirst(root, SELECTORS.card.rating);
  const reviewCountEl = queryFirst(root, SELECTORS.card.reviewCount);

  return {
    name,
    phoneRaw: textOf(queryFirst(root, SELECTORS.card.phone)),
    address: textOf(queryFirst(root, SELECTORS.card.address)),
    category: textOf(queryFirst(root, SELECTORS.card.category)),
    ratingRaw: attrOf(ratingEl, 'aria-label') ?? textOf(ratingEl),
    reviewCountRaw: attrOf(reviewCountEl, 'aria-label') ?? textOf(reviewCountEl),
    website: attrOf(queryFirst(root, SELECTORS.card.website), 'href'),
    externalRef: extractExternalRefFromUrl(detailUrl),
    detailUrl,
  };
}
