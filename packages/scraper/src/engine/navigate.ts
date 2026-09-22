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
import { ScrapeError, sleep } from '../errors.js';

export type NavigateOptions = {
  queryString: string;
  maxResults: number;
  /** Timeout de navegação inicial (ms) — estoura -> `NAVIGATION_TIMEOUT`. */
  navigationTimeoutMs?: number;
  /** Máximo de passos de scroll sem NENHUM card novo antes de desistir (lista realmente acabou). */
  maxStagnantScrolls?: number;
  /** Teto de segurança de passos de scroll, independente de progresso. */
  maxScrollSteps?: number;
  /**
   * Orçamento REAL de espera (ms) para o feed de resultados aparecer (ou
   * para consentimento/captcha/bloqueio serem detectados) depois do
   * `domcontentloaded`. Ver nota grande em `classifyOnce` — o Maps é uma
   * SPA pesada, o feed pode legitimamente não existir no DOM ainda nos
   * primeiros ~1-2s.
   */
  feedTimeoutMs?: number;
  /** Intervalo (ms) entre tentativas de classificação dentro de `feedTimeoutMs`. */
  feedPollIntervalMs?: number;
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

/**
 * ⚠️ `Locator.isVisible({ timeout })` NÃO espera — a própria doc do
 * Playwright marca esse `timeout` como "deprecated, ignored": a chamada
 * responde com o estado ATUAL do DOM, na hora, e nunca fica tentando de
 * novo. Por isso este helper (e quem o chama) nunca deve receber `timeout`
 * como se fosse "espere até X ms" — quem precisa de espera real usa
 * `classifyOnce`/`waitForClassification` abaixo, que fazem polling de
 * verdade com `sleep` entre tentativas.
 *
 * Causa raiz do incidente LAYOUT_CHANGED de 2026-09: os checks de
 * consent/captcha/feed rodavam todos a poucos ms do `domcontentloaded`,
 * antes da SPA do Maps pintar qualquer coisa (confirmado ao vivo: body
 * praticamente vazio nesse instante, feed aparecendo ~2s depois, sem
 * nenhum consent/captcha na página). Não era layout novo — era falta de
 * espera real.
 */
async function findFirstVisible(page: Page, selectors: readonly string[]): Promise<string | null> {
  for (const selector of selectors) {
    const visible = await page.locator(selector).first().isVisible().catch(() => false);
    if (visible) return selector;
  }
  return null;
}

/** Clica o botão de ACEITAR do consent, se algum estiver visível AGORA. Nunca lança. */
async function tryClickConsent(page: Page): Promise<void> {
  const selector = await findFirstVisible(page, SELECTORS.consentButton);
  if (!selector) return;
  // `.click()` (diferente de `.isVisible()`) TEM auto-wait/actionability
  // real — o timeout aqui é honrado de verdade pelo Playwright.
  await page.locator(selector).first().click({ timeout: 3000 }).catch(() => {});
}

function isBlockedUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return SELECTORS.blockedUrlPaths.some((path) => pathname.startsWith(path));
  } catch {
    return false;
  }
}

/** Só olha o DOM/texto atual (sem esperar) — usado dentro do polling de `classifyOnce`. */
async function detectBlockedInDom(page: Page): Promise<'captcha' | 'rate_limited' | null> {
  const captchaSelector = await findFirstVisible(page, SELECTORS.captchaIndicators);
  if (captchaSelector) return 'captcha';

  const bodyText = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
  for (const pattern of SELECTORS.blockedIndicatorText) {
    if (pattern.test(bodyText)) return 'rate_limited';
  }

  return null;
}

type Classification =
  | { status: 'feed'; feedSelector: string }
  | { status: 'blocked'; kind: 'captcha' | 'rate_limited' }
  | { status: 'pending' };

/**
 * Um "tick" de classificação: olha a URL e o DOM tal como estão AGORA (sem
 * esperar nada) e decide entre feed encontrado / bloqueio detectado / nada
 * decisivo ainda. `waitForClassification` chama isto repetidamente com
 * espera real entre tentativas — é essa repetição que faz o papel que
 * `isVisible({ timeout })` fingia fazer.
 */
async function classifyOnce(page: Page): Promise<Classification> {
  const url = page.url();

  if (isBlockedUrl(url)) {
    // Página de bloqueio/captcha própria do Google (`/sorry/...`) — o
    // redirect de URL costuma chegar antes do corpo terminar de renderizar,
    // então não faz sentido procurar consent aqui.
    const kind = (await detectBlockedInDom(page)) ?? 'rate_limited';
    return { status: 'blocked', kind };
  }

  await tryClickConsent(page);

  const kind = await detectBlockedInDom(page);
  if (kind) return { status: 'blocked', kind };

  const feedSelector = await findFirstVisible(page, SELECTORS.resultsFeed);
  if (feedSelector) return { status: 'feed', feedSelector };

  return { status: 'pending' };
}

/**
 * Espera de verdade (poll com `sleep` entre tentativas, até `timeoutMs`)
 * até `classifyOnce` decidir algo. Devolve o último resultado mesmo que
 * ainda seja `'pending'` quando o orçamento de tempo esgota — quem chama
 * decide o que fazer com isso (hoje: `LAYOUT_CHANGED`).
 */
async function waitForClassification(
  page: Page,
  opts: { timeoutMs: number; pollIntervalMs: number },
): Promise<Classification> {
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    const result = await classifyOnce(page);
    if (result.status !== 'pending') return result;
    if (Date.now() >= deadline) return result;
    await sleep(opts.pollIntervalMs);
  }
}

/** Trecho curto e diagnosticável do body (nunca a página inteira) para anexar ao erro. */
async function snapshotSnippet(page: Page, maxChars = 220): Promise<string> {
  const text = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > maxChars ? `${collapsed.slice(0, maxChars)}…` : collapsed;
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
    feedTimeoutMs = 12_000,
    feedPollIntervalMs = 400,
  } = opts;

  const sourceUrl = GOOGLE_MAPS_SEARCH_URL(queryString);

  try {
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });
  } catch (err) {
    throw new ScrapeError('NAVIGATION_TIMEOUT', `Timeout ao navegar para busca "${queryString}"`, {
      cause: err,
    });
  }

  const classification = await waitForClassification(page, {
    timeoutMs: feedTimeoutMs,
    pollIntervalMs: feedPollIntervalMs,
  });

  if (classification.status === 'blocked') {
    if (classification.kind === 'captcha') {
      throw new ScrapeError('CAPTCHA_DETECTED', `Captcha detectado ao buscar "${queryString}"`);
    }
    throw new ScrapeError('RATE_LIMITED', `Indício de rate limit ao buscar "${queryString}"`);
  }

  if (classification.status === 'pending') {
    // Nem o feed de resultados apareceu, nem consent/captcha/bloqueio foram
    // detectados, mesmo depois de `feedTimeoutMs` de espera real — ou o
    // Maps não achou nada (raro para o formato de query usado), ou o
    // layout mudou de verdade. URL final + trecho curto do body vão no
    // erro para não obrigar quem investiga a baixar o incidente capturado
    // só para saber "o que a página era".
    const finalUrl = page.url();
    const snippet = await snapshotSnippet(page);
    throw new ScrapeError(
      'LAYOUT_CHANGED',
      `Feed de resultados não encontrado para "${queryString}" após ${feedTimeoutMs}ms de espera — ` +
        `nenhuma alternativa de SELECTORS.resultsFeed casou. url final: ${finalUrl}; trecho: "${snippet}"`,
    );
  }

  const feedSelector = classification.feedSelector;

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
