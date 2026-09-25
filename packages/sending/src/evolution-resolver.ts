/**
 * evolution-resolver.ts — resolução do `EvolutionClient` (`@inno/messaging`)
 * a partir de uma `WhatsAppInstance`, compartilhada entre `apps/web`
 * (`lib/evolution.ts`) e `apps/worker` (`dispatch-tick.job`, ARQUITETURA
 * §6.8.0.1 previa este arquivo desde a 4.F.1 como "evolution-resolver" — não
 * foi feito naquela rodada porque `ports.ts` optou por receber o cliente já
 * pronto; a 4.F.4 é quem precisa de fato resolvê-lo, porque o worker não tem
 * `lib/evolution.ts` do web para importar (§2: apps não se importam).
 *
 * O que este módulo NÃO decide, de propósito (ARQUITETURA §6.8.0 — "a
 * política de erro continua de cada app"): o que fazer quando o servidor não
 * existe/está inativo. `apps/web` tem uma requisição HTTP esperando e
 * transforma isso em `502 UPSTREAM_ERROR`; `apps/worker` não tem requisição
 * nenhuma — precisa tirar a instância da rotação e, sem nenhuma sobrar,
 * haltar a campanha. Forçar as duas reações a serem iguais seria pior que a
 * duplicação que este módulo evita. Por isso `resolveInstanceEvolutionClient`
 * devolve um RESULTADO (nunca lança por servidor ausente/inativo — só por
 * erro de configuração real da cifra, ver `evolution-crypto.ts`), e cada app
 * traduz o resultado no seu próprio vocabulário.
 */
import { EvolutionClient, evolutionConfigFromEnv } from '@inno/messaging';
import type { EvolutionServer, PrismaClient } from '@inno/db';
import { decryptEvolutionApiKey, type EvolutionCryptoEnv } from './evolution-crypto.js';

export type EvolutionServerRow = Pick<EvolutionServer, 'baseUrl' | 'apiKeyCiphertext' | 'apiKeyIv' | 'apiKeyAuthTag' | 'apiKeyKeyVersion'>;

/** Decifra a credencial do servidor e monta o `EvolutionClient` — mesma conta que `apps/web` já fazia, agora num lugar só. */
export function buildEvolutionClientFromServer(server: EvolutionServerRow, env: EvolutionCryptoEnv): EvolutionClient {
  const apiKey = decryptEvolutionApiKey(server, env);
  return new EvolutionClient({ baseUrl: server.baseUrl, apiKey });
}

/**
 * Cliente construído a partir de `EVOLUTION_API_URL`/`EVOLUTION_API_KEY`
 * (comportamento PRÉ-Fase-4.B, mantido só para instância cujo
 * `evolutionServerId` ainda é `null` — migração `20260923140000_evolution_servers`,
 * ver comentário completo no schema Prisma). Cada app decide SE oferece este
 * fallback (via `deps.legacyClient` abaixo) e como cachear/logar o aviso —
 * isso é estado de processo (singleton, log-uma-vez), que este módulo não
 * tem motivo para gerenciar.
 */
export function buildLegacyEnvEvolutionClient(env: EvolutionCryptoEnv): EvolutionClient {
  return new EvolutionClient(evolutionConfigFromEnv(env));
}

export type ResolveInstanceEvolutionClientDeps = {
  prisma: Pick<PrismaClient, 'evolutionServer'>;
  env: EvolutionCryptoEnv;
  /** Ausente = instância legada sem `evolutionServerId` some direto como `server_not_found` (nenhum app deveria chegar aqui sem decidir o fallback explicitamente). */
  legacyClient?: () => EvolutionClient;
};

export type ResolveInstanceEvolutionClientResult =
  | { outcome: 'resolved'; client: EvolutionClient }
  | { outcome: 'server_not_found' }
  | { outcome: 'server_inactive' };

/**
 * Resolve o `EvolutionClient` de uma instância JÁ EXISTENTE. NUNCA lança por
 * servidor ausente/inativo (isso é dado de operação, não bug de código) —
 * lança só se a CIFRA falhar de verdade (chave-mestre ausente/malformada,
 * auth tag inválida), porque isso É um erro de configuração/integridade que
 * nenhum chamador consegue tratar como "servidor indisponível".
 */
export async function resolveInstanceEvolutionClient(
  deps: ResolveInstanceEvolutionClientDeps,
  instance: { evolutionServerId: string | null },
): Promise<ResolveInstanceEvolutionClientResult> {
  if (!instance.evolutionServerId) {
    if (deps.legacyClient) return { outcome: 'resolved', client: deps.legacyClient() };
    return { outcome: 'server_not_found' };
  }

  const server = await deps.prisma.evolutionServer.findUnique({ where: { id: instance.evolutionServerId } });
  if (!server) return { outcome: 'server_not_found' };
  if (!server.isActive) return { outcome: 'server_inactive' };
  return { outcome: 'resolved', client: buildEvolutionClientFromServer(server, deps.env) };
}
