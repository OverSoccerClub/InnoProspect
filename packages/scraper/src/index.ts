/**
 * @inno/scraper — porta única de entrada do motor de coleta (ARQUITETURA
 * §5). `apps/worker` (próxima rodada de Vega) importa SÓ daqui — nunca de
 * `engine/*` ou `extraction/*` diretamente, para o dia em que o motor
 * `maps-pb` (Fase 6) entrar como segunda implementação de `SearchEngine`
 * sem tocar em nada acima dele.
 *
 * ⚠️ Nenhum seletor CSS/XPath/texto do Google Maps existe fora de
 * `extraction/selectors.ts` (regra dura, ARQUITETURA §5.5, Órion audita).
 */
import {
  PlaywrightMapsEngine,
  buildQueryString,
  defaultEngineConfig,
  type ScrapeContext,
  type SearchInput,
  type SearchOutput,
} from './engine/playwright-engine.js';
import { NoopProxyProvider, type ProxyProvider } from './engine/proxy.js';

export type { RawBusiness, CityContext, NormalizeContext, ScrapedBusiness } from './extraction/types.js';
export type { SearchInput, SearchOutput, SearchOutputMeta, ScrapeContext } from './engine/playwright-engine.js';
export { buildQueryString, PlaywrightMapsEngine, defaultEngineConfig } from './engine/playwright-engine.js';
export type { PlaywrightEngineConfig } from './engine/playwright-engine.js';

export type { ProxyProvider, ProxyConfig } from './engine/proxy.js';
export { NoopProxyProvider } from './engine/proxy.js';

export { BrowserSession, defaultSessionConfig } from './engine/browser.js';
export type { BrowserSessionConfig, SessionOutcome } from './engine/browser.js';

export { openSearchAndCollectCards } from './engine/navigate.js';
export type { NavigateOptions, NavigateResult } from './engine/navigate.js';

export { extractCard } from './extraction/extract-card.js';
export { normalize } from './extraction/normalize.js';
export { SELECTORS } from './extraction/selectors.js';

export {
  ScrapeError,
  SCRAPE_ERROR_POLICY,
  applyJitter,
  randomDelay,
  backoffForAttempt,
  sleep,
} from './errors.js';
export type { ScrapeErrorCode, ScrapeErrorPolicy } from './errors.js';

export {
  checkZeroStreak,
  checkNameFillRate,
  checkPhoneFillRate,
  checkDataShape,
  evaluateSanity,
  DEFAULT_ZERO_STREAK_OPTIONS,
  DEFAULT_NAME_FILL_RATE_OPTIONS,
} from './sanity/assertions.js';
export type {
  SanityCheckResult,
  SanitySeverity,
  TaskResultForZeroStreak,
  ZeroStreakOptions,
  NameFillRateOptions,
  LeadShapeSample,
} from './sanity/assertions.js';
export { captureIncident } from './sanity/incident.js';
export type { IncidentCapture } from './sanity/incident.js';

export { USER_AGENT_PROFILES, pickUserAgentProfile, contextOptionsFor } from './antidetect/user-agents.js';
export type { UaProfile, UaPlatform } from './antidetect/user-agents.js';

/**
 * Contrato de motor de busca (ARQUITETURA §5.1) — `PlaywrightMapsEngine` é a
 * única implementação hoje (`id: 'playwright-maps'`). O motor `maps-pb`
 * (Fase 6, dívida D1/opção B do §5.1) entra implementando esta mesma
 * interface.
 */
export interface SearchEngine {
  readonly id: 'playwright-maps' | 'maps-pb';
  search(input: SearchInput, ctx: ScrapeContext): Promise<SearchOutput>;
}

let defaultEngine: PlaywrightMapsEngine | null = null;

function getDefaultEngine(): PlaywrightMapsEngine {
  if (!defaultEngine) {
    defaultEngine = new PlaywrightMapsEngine(new NoopProxyProvider(), defaultEngineConfig());
  }
  return defaultEngine;
}

/**
 * Porta única de entrada do pacote: roda 1 busca (1 nicho × 1 município,
 * ARQUITETURA §5.2) usando um `PlaywrightMapsEngine` singleton reaproveitado
 * entre chamadas — é isso que permite reciclagem de contexto e pausa longa
 * funcionarem entre `SearchTask`s consecutivas dentro do mesmo processo
 * `apps/worker`. Para controle explícito de ciclo de vida (proxy custom,
 * fechar no shutdown), instancie `PlaywrightMapsEngine` diretamente.
 */
export async function runSearch(input: SearchInput, ctx: ScrapeContext): Promise<SearchOutput> {
  return getDefaultEngine().search(input, ctx);
}

/** Fecha o engine singleton usado por `runSearch` — chamar no graceful shutdown do worker. */
export async function closeDefaultEngine(): Promise<void> {
  await defaultEngine?.close();
  defaultEngine = null;
}

/** Cria um engine com `ProxyProvider` customizado — uso avançado (worker gerenciando seu próprio ciclo de vida). */
export function createEngine(
  proxyProvider: ProxyProvider = new NoopProxyProvider(),
  config = defaultEngineConfig(),
): PlaywrightMapsEngine {
  return new PlaywrightMapsEngine(proxyProvider, config);
}
