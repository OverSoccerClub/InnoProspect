/**
 * engine/proxy.ts — ponto de injeção de proxy (ARQUITETURA §5.4). Encaixe
 * pronto, SEM implementação — dívida técnica consciente D1 (ARQUITETURA
 * §9.2): custo recorrente sem problema comprovado ainda.
 *
 * `browser.ts` (BrowserSession) SEMPRE passa por `proxyProvider.acquire()`
 * desde o dia 1, mesmo recebendo `null` de volta. Ligar proxy no futuro é:
 * escrever uma classe `RotatingProxyProvider` e trocar 1 linha na injeção
 * (`PROXY_PROVIDER=rotating` em vez de `noop`, ARQUITETURA §10) — sem
 * refatoração, sem risco.
 */

export type ProxyConfig = { server: string; username?: string; password?: string };

export interface ProxyProvider {
  /** Retorna a config de proxy para a próxima sessão, ou `null` para conexão direta. */
  acquire(ctx: { taskId: string; uf: string }): Promise<ProxyConfig | null>;
  /** Devolve o proxy ao pool, sinalizando o desfecho — permite banir proxy ruim no futuro. */
  release(proxy: ProxyConfig | null, outcome: 'ok' | 'blocked' | 'error'): Promise<void>;
}

/** Implementação atual: conexão direta. Trocar por `RotatingProxyProvider` não muda mais nada. */
export class NoopProxyProvider implements ProxyProvider {
  async acquire(): Promise<ProxyConfig | null> {
    return null;
  }

  async release(): Promise<void> {
    // nada a fazer — não há proxy para devolver ao pool.
  }
}
