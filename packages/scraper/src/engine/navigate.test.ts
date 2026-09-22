/**
 * engine/navigate.test.ts — regressão do incidente LAYOUT_CHANGED de
 * 2026-09 (§5.5/§5.6/§5.7): `Locator.isVisible({ timeout })` não espera de
 * verdade (é `deprecated, ignored` na própria API do Playwright), então os
 * checks de consent/captcha/feed rodavam a poucos ms do
 * `domcontentloaded` — antes da SPA do Maps renderizar qualquer coisa — e
 * classificavam erroneamente como "layout mudou".
 *
 * Sem bater no Google de verdade (instável, quebraria o CI): um Page falso
 * baseado em cheerio, dirigido por fixtures de HTML congeladas em
 * `../sanity/fixtures/`, que responde `isVisible`/`innerText`/`url()` a
 * partir do HTML "atual" e pode trocar de HTML quando um seletor esperado é
 * clicado (simula o consent interstitial dando lugar aos resultados).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { openSearchAndCollectCards } from './navigate.js';
import { ScrapeError } from '../errors.js';

function loadFixture(name: string): string {
  const path = fileURLToPath(new URL(`../sanity/fixtures/${name}`, import.meta.url));
  return readFileSync(path, 'utf8');
}

type PageState = { url: string; html: string };

/**
 * Page falso mínimo — só implementa o que `navigate.ts` realmente chama.
 * `clickTransitions` mapeia "selector clicado" -> novo estado da página
 * (URL/HTML), para simular navegação/re-render disparada por um clique
 * (ex.: aceitar consent leva de volta aos resultados).
 */
function createFakePage(
  initial: PageState,
  clickTransitions: Record<string, PageState> = {},
): Page {
  let state: PageState = { ...initial };

  function matches(selector: string): boolean {
    try {
      return cheerio.load(state.html)(selector).length > 0;
    } catch {
      // Sintaxe exclusiva do Playwright (ex.: `:has-text(...)`) não é
      // entendida pelo parser CSS do cheerio — tratado como "não casou",
      // igual ao `extract-card.test.ts` faz para os seletores de card.
      return false;
    }
  }

  function locatorFor(selector: string) {
    const locator = {
      first: () => locator,
      isVisible: async () => matches(selector),
      click: async () => {
        const next = clickTransitions[selector];
        if (next) state = { ...next };
      },
      innerText: async () => cheerio.load(state.html)('body').text(),
      evaluateAll: async () => [] as string[],
    };
    return locator;
  }

  return {
    goto: async () => undefined,
    url: () => state.url,
    locator: (selector: string) => locatorFor(selector),
  } as unknown as Page;
}

const RESULTS_URL =
  'https://www.google.com/maps/search/clinica%20odontologica%20em%20Natal%2C%20RN';

async function expectScrapeError(promise: Promise<unknown>): Promise<ScrapeError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ScrapeError);
    return err as ScrapeError;
  }
  throw new Error('esperava que a Promise rejeitasse com ScrapeError');
}

describe('openSearchAndCollectCards — classificação da página (causa raiz: espera real, não isVisible)', () => {
  it('feed presente desde o 1º tick: não lança, devolve sourceUrl mesmo sem coletar cards (maxResults 0)', async () => {
    const page = createFakePage({ url: RESULTS_URL, html: loadFixture('maps-feed-ok.html') });

    const result = await openSearchAndCollectCards(page, {
      queryString: 'clinica odontologica em Natal, RN',
      maxResults: 0,
    });

    expect(result.sourceUrl).toBe(RESULTS_URL);
    expect(result.cardHtmls).toEqual([]);
  });

  it('consent interstitial: clica "Concordo" (nunca "Rejeitar tudo") e enxerga o feed depois da transição', async () => {
    const consentSelector = 'button[aria-label*="Concordo"]';
    const page = createFakePage(
      { url: RESULTS_URL, html: loadFixture('maps-consent.html') },
      { [consentSelector]: { url: RESULTS_URL, html: loadFixture('maps-feed-ok.html') } },
    );

    const result = await openSearchAndCollectCards(page, {
      queryString: 'clinica odontologica em Natal, RN',
      maxResults: 0,
    });

    expect(result.sourceUrl).toBe(RESULTS_URL);
  });

  it('página de bloqueio do Google (/sorry) com iframe de recaptcha -> CAPTCHA_DETECTED, não LAYOUT_CHANGED', async () => {
    const page = createFakePage({
      url: 'https://www.google.com/sorry/index?continue=...',
      html: loadFixture('maps-blocked-captcha.html'),
    });

    const err = await expectScrapeError(
      openSearchAndCollectCards(page, {
        queryString: 'clinica odontologica em Natal, RN',
        maxResults: 5,
      }),
    );

    expect(err.code).toBe('CAPTCHA_DETECTED');
    expect(err.retryable).toBe(true);
  });

  it('página de bloqueio do Google (/sorry) sem captcha interativo -> RATE_LIMITED, não LAYOUT_CHANGED', async () => {
    const page = createFakePage({
      url: 'https://www.google.com/sorry/index?continue=...',
      html: loadFixture('maps-blocked-rate-limited.html'),
    });

    const err = await expectScrapeError(
      openSearchAndCollectCards(page, {
        queryString: 'clinica odontologica em Natal, RN',
        maxResults: 5,
      }),
    );

    expect(err.code).toBe('RATE_LIMITED');
  });

  it('texto de tráfego incomum na própria página (sem redirect para /sorry) também é RATE_LIMITED', async () => {
    const page = createFakePage({
      url: RESULTS_URL,
      html: loadFixture('maps-blocked-rate-limited.html'),
    });

    const err = await expectScrapeError(
      openSearchAndCollectCards(page, {
        queryString: 'clinica odontologica em Natal, RN',
        maxResults: 5,
      }),
    );

    expect(err.code).toBe('RATE_LIMITED');
  });

  it('feed nunca aparece (nem consent, nem captcha, nem bloqueio) -> LAYOUT_CHANGED com URL final + trecho no erro, NÃO retryable', async () => {
    const page = createFakePage({
      url: RESULTS_URL,
      html: loadFixture('maps-blank-not-rendered.html'),
    });

    const err = await expectScrapeError(
      openSearchAndCollectCards(page, {
        queryString: 'clinica odontologica em Natal, RN',
        maxResults: 5,
        // Orçamento de teste minúsculo — o comportamento sob teste é "o
        // que acontece quando o tempo esgota", não o tamanho do orçamento
        // real de produção (12s). Evita um teste lento de verdade.
        feedTimeoutMs: 30,
        feedPollIntervalMs: 10,
      }),
    );

    expect(err.code).toBe('LAYOUT_CHANGED');
    expect(err.retryable).toBe(false);
    expect(err.message).toContain(RESULTS_URL);
    // Evidência diagnosticável, mas curta — não é um despejo da página inteira.
    expect(err.message.length).toBeLessThan(600);
  });

  it('espera de verdade: feed que só passa a existir depois do 1º tick NÃO é classificado como layout mudado (regressão direta do incidente — o bug antigo parava no 1º tick)', async () => {
    // Simula exatamente o que o repro ao vivo mostrou: nos primeiros ticks
    // a SPA ainda não pintou o feed (conta como "página em branco"); só a
    // partir do 3º tick de `classifyOnce` o feed passa a existir no DOM.
    const page = createFakePage({ url: RESULTS_URL, html: loadFixture('maps-blank-not-rendered.html') });
    let feedChecks = 0;
    const realLocator = page.locator.bind(page);
    (page as unknown as { locator: Page['locator'] }).locator = ((selector: string) => {
      if (selector === 'div[role="feed"]') {
        feedChecks += 1;
        const nowVisible = feedChecks >= 3;
        return { first: () => ({ isVisible: async () => nowVisible }) } as unknown as ReturnType<
          Page['locator']
        >;
      }
      return realLocator(selector);
    }) as Page['locator'];

    const result = await openSearchAndCollectCards(page, {
      queryString: 'clinica odontologica em Natal, RN',
      maxResults: 0,
      feedTimeoutMs: 500,
      feedPollIntervalMs: 5,
    });

    expect(result.sourceUrl).toBe(RESULTS_URL);
    expect(feedChecks).toBeGreaterThanOrEqual(3);
  });
});
