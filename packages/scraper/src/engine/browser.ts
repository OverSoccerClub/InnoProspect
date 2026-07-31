/**
 * engine/browser.ts — pool Playwright: 1 `Browser` vivo, `BrowserContext`
 * reciclado a cada N buscas, pausa longa periódica. Ver ARQUITETURA §5.3
 * (tabela de parâmetros) e §5.4 (injeção de proxy, sempre chamada mesmo
 * recebendo `null`).
 */
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { contextOptionsFor, pickUserAgentProfile } from '../antidetect/user-agents.js';
import { ScrapeError } from '../errors.js';
import { NoopProxyProvider, type ProxyConfig, type ProxyProvider } from './proxy.js';

/** Ranking para combinar múltiplos desfechos (ver `reportOutcome`) — o pior desfecho da sessão prevalece. */
const OUTCOME_RANK = { ok: 0, error: 1, blocked: 2 } as const;
export type SessionOutcome = keyof typeof OUTCOME_RANK;

export type BrowserSessionConfig = {
  headless: boolean;
  /** Recicla o contexto (descarta cookies/estado acumulado) a cada N buscas. */
  contextTtlSearches: number;
  /** A cada ~N buscas, pausa longa ("operador saiu pra um café"). */
  longPauseEverySearches: number;
  longPauseMinMs: number;
  longPauseMaxMs: number;
};

/** Defaults batem com ARQUITETURA §5.3 / §10 (env vars documentadas ali). */
export function defaultSessionConfig(env: NodeJS.ProcessEnv = process.env): BrowserSessionConfig {
  return {
    headless: (env.SCRAPE_HEADLESS ?? 'true') !== 'false',
    contextTtlSearches: Number(env.SCRAPE_CONTEXT_TTL ?? 15),
    longPauseEverySearches: 50,
    longPauseMinMs: 3 * 60_000,
    longPauseMaxMs: 8 * 60_000,
  };
}

/**
 * Mantém 1 `Browser` vivo entre buscas (não relança Chromium a cada task —
 * caro e lento) e recicla o `BrowserContext` periodicamente. Uma instância
 * desta classe deve viver pelo tempo do processo `apps/worker` (próxima
 * rodada de Vega), não ser recriada por task.
 */
export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private searchesInContext = 0;
  private totalSearches = 0;
  private currentProxyConfig: ProxyConfig | null = null;
  private worstOutcomeInContext: SessionOutcome = 'ok';

  constructor(
    private readonly proxyProvider: ProxyProvider = new NoopProxyProvider(),
    private readonly config: BrowserSessionConfig = defaultSessionConfig(),
  ) {}

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    try {
      this.browser = await chromium.launch({ headless: this.config.headless });
      return this.browser;
    } catch (err) {
      throw new ScrapeError('BROWSER_CRASH', 'Falha ao iniciar o Chromium', { cause: err });
    }
  }

  /**
   * Devolve o `BrowserContext` corrente, reciclando-o se o TTL de buscas
   * estourou, e aplicando a pausa longa periódica antes de abrir um novo.
   * `proxyProvider.acquire()` é chamado SEMPRE (ARQUITETURA §5.4), mesmo
   * quando `NoopProxyProvider` devolve `null`.
   */
  async getContext(taskId: string, uf: string): Promise<BrowserContext> {
    await this.maybeLongPause();

    if (this.context && this.searchesInContext >= this.config.contextTtlSearches) {
      await this.closeContext();
    }

    if (!this.context) {
      const browser = await this.ensureBrowser();
      const profile = pickUserAgentProfile();
      const proxyConfig = await this.proxyProvider.acquire({ taskId, uf });

      try {
        this.context = await browser.newContext({
          ...contextOptionsFor(profile),
          ...(proxyConfig ? { proxy: proxyConfig } : {}),
        });
        this.currentProxyConfig = proxyConfig;
        this.worstOutcomeInContext = 'ok';
      } catch (err) {
        await this.proxyProvider.release(proxyConfig, 'error');
        throw new ScrapeError('BROWSER_CRASH', 'Falha ao abrir novo contexto de navegador', { cause: err });
      }
    }

    return this.context;
  }

  /** Chamar após cada busca concluída (com sucesso ou erro) para os contadores de reciclagem/pausa avançarem. */
  registerSearchDone(): void {
    this.searchesInContext += 1;
    this.totalSearches += 1;
  }

  /**
   * Registra o desfecho de uma busca feita com o proxy corrente — o pior
   * desfecho observado desde que o proxy foi adquirido é o que vai para
   * `proxyProvider.release()` quando o contexto for reciclado/fechado (ex.:
   * 3 buscas `ok` e 1 `blocked` no mesmo contexto = libera como `blocked`,
   * sinal de que ESTE proxy levou bloqueio, não a sessão em geral).
   */
  reportOutcome(outcome: SessionOutcome): void {
    if (OUTCOME_RANK[outcome] > OUTCOME_RANK[this.worstOutcomeInContext]) {
      this.worstOutcomeInContext = outcome;
    }
  }

  private async closeContext(): Promise<void> {
    await this.context?.close().catch(() => {});
    await this.proxyProvider.release(this.currentProxyConfig, this.worstOutcomeInContext);
    this.context = null;
    this.currentProxyConfig = null;
    this.worstOutcomeInContext = 'ok';
    this.searchesInContext = 0;
  }

  private async maybeLongPause(): Promise<void> {
    if (this.totalSearches === 0) return;
    if (this.totalSearches % this.config.longPauseEverySearches !== 0) return;

    const pauseMs =
      this.config.longPauseMinMs + Math.random() * (this.config.longPauseMaxMs - this.config.longPauseMinMs);
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }

  /** Fecha context + browser — chamar no graceful shutdown do worker. */
  async close(): Promise<void> {
    await this.closeContext();
    await this.browser?.close().catch(() => {});
    this.browser = null;
  }
}
