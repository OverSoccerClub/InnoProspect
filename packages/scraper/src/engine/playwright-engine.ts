/**
 * engine/playwright-engine.ts — implementação `playwright-maps` de
 * `SearchEngine` (ARQUITETURA §5.1). Orquestra: delay/jitter → contexto de
 * browser (recicla/pausa via `BrowserSession`) → navegação + scroll
 * (`navigate.ts`) → extração (`extraction/extract-card.ts` +
 * `extraction/normalize.ts`) → captura de incidente em erro grave.
 */
import { extractCard } from '../extraction/extract-card.js';
import { normalize } from '../extraction/normalize.js';
import type { ScrapedBusiness } from '../extraction/types.js';
import { ScrapeError, randomDelay, sleep } from '../errors.js';
import { BrowserSession, defaultSessionConfig, type BrowserSessionConfig } from './browser.js';
import { openSearchAndCollectCards } from './navigate.js';
import { NoopProxyProvider, type ProxyProvider } from './proxy.js';
import { captureIncident } from '../sanity/incident.js';

export type PlaywrightEngineConfig = {
  session: BrowserSessionConfig;
  /** Delay aleatório ANTES de cada busca (ARQUITETURA §5.3: "8–25s aleatório"). */
  delayMinMs: number;
  delayMaxMs: number;
};

export function defaultEngineConfig(env: NodeJS.ProcessEnv = process.env): PlaywrightEngineConfig {
  return {
    session: defaultSessionConfig(env),
    delayMinMs: Number(env.SCRAPE_DELAY_MIN_MS ?? 8_000),
    delayMaxMs: Number(env.SCRAPE_DELAY_MAX_MS ?? 25_000),
  };
}

export type SearchInput = {
  niche: string;
  city: { name: string; uf: string; ibgeCode: string };
  maxResults: number;
};

export type SearchOutputMeta = {
  engineId: 'playwright-maps';
  queryString: string;
  durationMs: number;
  scrolls: number;
  reachedEnd: boolean;
  sourceUrl: string;
};

export type SearchOutput = {
  businesses: ScrapedBusiness[];
  meta: SearchOutputMeta;
};

export type ScrapeContext = {
  /** ID da SearchTask (1 nicho × 1 município) — repassado ao ProxyProvider e usado em nome de incidente. */
  taskId: string;
};

/** String de consulta materializada (CONTRATO, ARQUITETURA §5.2): `${niche} em ${city.name}, ${uf}`. */
export function buildQueryString(niche: string, cityName: string, uf: string): string {
  const normalizedNiche = niche.trim().replace(/\s+/g, ' ');
  const normalizedCity = cityName.trim().replace(/\s+/g, ' ');
  return `${normalizedNiche} em ${normalizedCity}, ${uf}`;
}

export class PlaywrightMapsEngine {
  readonly id = 'playwright-maps' as const;

  private readonly session: BrowserSession;

  constructor(
    proxyProvider: ProxyProvider = new NoopProxyProvider(),
    private readonly config: PlaywrightEngineConfig = defaultEngineConfig(),
  ) {
    this.session = new BrowserSession(proxyProvider, config.session);
  }

  async search(input: SearchInput, ctx: ScrapeContext): Promise<SearchOutput> {
    const startedAt = Date.now();
    const queryString = buildQueryString(input.niche, input.city.name, input.city.uf);

    // Delay aleatório antes de cada busca — nunca intervalo fixo (ARQUITETURA §5.3).
    await sleep(randomDelay(this.config.delayMinMs, this.config.delayMaxMs));

    const browserContext = await this.session.getContext(ctx.taskId, input.city.uf);
    let outcome: 'ok' | 'blocked' | 'error' = 'ok';

    try {
      const page = await browserContext.newPage();
      try {
        const navResult = await openSearchAndCollectCards(page, {
          queryString,
          maxResults: input.maxResults,
        }).catch(async (err) => {
          // Captura screenshot + HTML só em erro grave (ARQUITETURA §5.7) —
          // não em todo NAVIGATION_TIMEOUT isolado, que é rotina de retry.
          if (err instanceof ScrapeError && (err.code === 'LAYOUT_CHANGED' || err.code === 'CAPTCHA_DETECTED')) {
            await captureIncident(page, `${ctx.taskId}-${Date.now()}`);
          }
          throw err;
        });

        const businesses = navResult.cardHtmls
          .map((html) => extractCard(html))
          .filter((raw): raw is NonNullable<typeof raw> => raw !== null)
          .map((raw) =>
            normalize(raw, {
              city: input.city,
              searchResultUrl: navResult.sourceUrl,
            }),
          );

        return {
          businesses,
          meta: {
            engineId: this.id,
            queryString,
            durationMs: Date.now() - startedAt,
            scrolls: navResult.scrolls,
            reachedEnd: navResult.reachedEnd,
            sourceUrl: navResult.sourceUrl,
          },
        };
      } finally {
        await page.close().catch(() => {});
      }
    } catch (err) {
      if (err instanceof ScrapeError && (err.code === 'RATE_LIMITED' || err.code === 'CAPTCHA_DETECTED')) {
        outcome = 'blocked';
      } else {
        outcome = 'error';
      }
      throw err instanceof ScrapeError
        ? err
        : new ScrapeError('UNKNOWN', `Falha não classificada ao buscar "${queryString}"`, { cause: err });
    } finally {
      this.session.registerSearchDone();
      // Repassa o desfecho para a sessão — é o que decide, no próximo
      // recycle/close de contexto, com que status o ProxyProvider.release()
      // é chamado (NoopProxyProvider ignora; um provider real, Fase 6/D1,
      // usa isto para banir proxy ruim).
      this.session.reportOutcome(outcome);
    }
  }

  async close(): Promise<void> {
    await this.session.close();
  }
}
