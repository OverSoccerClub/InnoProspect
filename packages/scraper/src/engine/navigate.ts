/**
 * engine/navigate.ts — abrir a busca no Maps, aceitar consent, rolar a
 * lista de resultados e coletar o HTML de cada card. NÃO extrai dados de
 * negócio (isso é `extraction/extract-card.ts` + `extraction/normalize.ts`)
 * — este arquivo só sabe navegar e coletar HTML bruto.
 *
 * Todo seletor vem de `../extraction/selectors.ts` (regra dura, §5.5) — este
 * arquivo nunca declara uma string de seletor/texto do Maps inline.
 */
import type { Page } from 'playwright';
import { SELECTORS } from '../extraction/selectors.js';
import { humanMouseJiggle, humanScrollStep, maybeHoverCard } from '../antidetect/humanize.js';
import { ScrapeError } from '../errors.js';

export type NavigateOptions = {
  queryString: string;
  maxResults: number;
  /** Timeout de navegação inicial (ms) — estoura -> `NAVIGATION_TIMEOUT`. */
  navigationTimeoutMs?: number;
  /** Máximo de passos de scroll sem NENHUM card novo antes de desistir (lista realmente acabou). */
  maxStagnantScrolls?: number;
  /** Teto de segurança de passos de scroll, independente de progresso. */
  maxScrollSteps?: number;
};

export type NavigateResult = {
  /** `outerHTML` de cada card único encontrado, na ordem em que apareceram. */
  cardHtmls: string[];
  /** `true` se o indicador de "chegou ao fim" apareceu (não só estagnou). */
  reachedEnd: boolean;
  scrolls: number;
  sourceUrl: string;
};

const GOOGLE_MAPS_SEARCH_URL = (query: string) =>
  `https://www.google.com/maps/search/${encodeURIComponent(query)}`;

async function tryClickConsent(page: Page): Promise<void> {
  for (const selector of SELECTORS.consentButton) {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible({ timeout: 1500 }).catch(() => false);
    if (visible) {
      await locator.click({ timeout: 3000 }).catch(() => {});
      return;
    }
  }
}

async function findFirstVisible(page: Page, selectors: readonly string[]): Promise<string | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible({ timeout: 500 }).catch(() => false);
    if (visible) return selector;
  }
  return null;
}

async function detectBlocked(page: Page): Promise<'captcha' | 'rate_limited' | null> {
  for (const selector of SELECTORS.captchaIndicators) {
    const visible = await page
      .locator(selector)
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (visible) return 'captcha';
  }

  const bodyText = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
  for (const pattern of SELECTORS.blockedIndicatorText) {
    if (pattern.test(bodyText)) return 'rate_limited';
  }

  return null;
}

/**
 * Abre a URL de busca do Maps, aceita consent (se aparecer), rola a lista
 * de resultados coletando HTML de cada card até atingir `maxResults`,
 * encontrar o fim da lista, ou estagnar (sem cards novos por N scrolls
 * seguidos). Lança `ScrapeError` classificado em falha de navegação,
 * bloqueio (captcha/rate limit) ou layout mudado (feed nunca aparece).
 */
export async function openSearchAndCollectCards(
  page: Page,
  opts: NavigateOptions,
): Promise<NavigateResult> {
  const {
    queryString,
    maxResults,
    navigationTimeoutMs = 45_000,
    maxStagnantScrolls = 4,
    maxScrollSteps = 60,
  } = opts;

  const sourceUrl = GOOGLE_MAPS_SEARCH_URL(queryString);

  try {
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });
  } catch (err) {
    throw new ScrapeError('NAVIGATION_TIMEOUT', `Timeout ao navegar para busca "${queryString}"`, {
      cause: err,
    });
  }

  await tryClickConsent(page);

  const blocked = await detectBlocked(page);
  if (blocked === 'captcha') {
    throw new ScrapeError('CAPTCHA_DETECTED', `Captcha detectado ao buscar "${queryString}"`);
  }
  if (blocked === 'rate_limited') {
    throw new ScrapeError('RATE_LIMITED', `Indício de rate limit ao buscar "${queryString}"`);
  }

  const feedSelector = await findFirstVisible(page, SELECTORS.resultsFeed);
  if (!feedSelector) {
    // Nem o feed de resultados apareceu — ou o Maps não achou nada (raro
    // para o formato de query usado), ou o layout mudou de verdade.
    throw new ScrapeError(
      'LAYOUT_CHANGED',
      `Feed de resultados não encontrado para "${queryString}" — nenhuma alternativa de SELECTORS.resultsFeed casou`,
    );
  }

  const seenCardHtmls = new Set<string>();
  const cardHtmls: string[] = [];
  let reachedEnd = false;
  let stagnantScrolls = 0;
  let scrolls = 0;

  while (
    cardHtmls.length < maxResults &&
    scrolls < maxScrollSteps &&
    stagnantScrolls < maxStagnantScrolls
  ) {
    // Recalculado a cada passo: a alternativa de SELECTORS.resultCard que
    // casa pode só aparecer depois do 1º scroll (lista carrega sob demanda).
    const cardSelector = (await findFirstVisible(page, SELECTORS.resultCard)) ?? SELECTORS.resultCard[0];
    const htmls = await page
      .locator(cardSelector)
      .evaluateAll((nodes: Element[]) => nodes.map((node) => node.outerHTML))
      .catch(() => [] as string[]);

    let newCount = 0;
    for (const html of htmls) {
      if (!seenCardHtmls.has(html)) {
        seenCardHtmls.add(html);
        cardHtmls.push(html);
        newCount++;
      }
    }

    stagnantScrolls = newCount === 0 ? stagnantScrolls + 1 : 0;

    const endOfListSelector = await findFirstVisible(page, SELECTORS.endOfList);
    if (endOfListSelector) {
      reachedEnd = true;
      break;
    }

    if (cardHtmls.length >= maxResults) break;

    await humanMouseJiggle(page);
    await humanScrollStep(page, feedSelector);
    await maybeHoverCard(page, cardSelector);
    scrolls++;
  }

  return {
    cardHtmls: cardHtmls.slice(0, maxResults),
    reachedEnd,
    scrolls,
    sourceUrl,
  };
}
