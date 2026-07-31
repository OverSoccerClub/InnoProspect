/**
 * antidetect/user-agents.ts — pool de User-Agents reais e recentes de
 * Chrome/Edge desktop (Windows/macOS). Ver ARQUITETURA §5.3: sorteado POR
 * CONTEXTO de browser, nunca por requisição — trocar UA no meio de uma
 * sessão é mais suspeito do que manter um só. `viewport`, `locale` e
 * `timezoneId` são sorteados JUNTO e de forma coerente com o UA (um UA de
 * macOS com fingerprint de Windows é detectável).
 */

export type UaPlatform = 'Windows' | 'macOS';

export type UaProfile = {
  userAgent: string;
  platform: UaPlatform;
  viewport: { width: number; height: number };
};

/**
 * 10 perfis (Chrome/Edge, Windows/macOS, resoluções desktop comuns).
 * Atualizar a versão do Chrome aqui de tempos em tempos (UA muito antigo
 * também é sinal de bot) — não é seletor do Maps, então não cai na regra do
 * `extraction/selectors.ts`.
 */
export const USER_AGENT_PROFILES: readonly UaProfile[] = [
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    platform: 'Windows',
    viewport: { width: 1920, height: 1080 },
  },
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    platform: 'Windows',
    viewport: { width: 1536, height: 864 },
  },
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
    platform: 'Windows',
    viewport: { width: 1366, height: 768 },
  },
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
    platform: 'Windows',
    viewport: { width: 1920, height: 1200 },
  },
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    platform: 'Windows',
    viewport: { width: 1440, height: 900 },
  },
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    platform: 'macOS',
    viewport: { width: 1440, height: 900 },
  },
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    platform: 'macOS',
    viewport: { width: 1680, height: 1050 },
  },
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    platform: 'macOS',
    viewport: { width: 1512, height: 982 },
  },
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
    platform: 'macOS',
    viewport: { width: 1440, height: 900 },
  },
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    platform: 'Windows',
    viewport: { width: 1600, height: 900 },
  },
] as const;

/** Sorteia 1 perfil completo (UA + viewport) — chamar 1x por `BrowserContext`, nunca por request. */
export function pickUserAgentProfile(rng: () => number = Math.random): UaProfile {
  const index = Math.floor(rng() * USER_AGENT_PROFILES.length);
  return USER_AGENT_PROFILES[Math.min(index, USER_AGENT_PROFILES.length - 1)] as UaProfile;
}

/**
 * Opções de `browser.newContext()` coerentes com o perfil sorteado — sempre
 * `pt-BR`/`America/Sao_Paulo` (público-alvo é o Brasil inteiro), mas
 * centralizado aqui para nunca divergir do UA escolhido.
 */
export function contextOptionsFor(profile: UaProfile) {
  return {
    userAgent: profile.userAgent,
    viewport: profile.viewport,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  } as const;
}
