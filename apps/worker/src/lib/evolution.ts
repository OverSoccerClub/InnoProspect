/**
 * lib/evolution.ts — resolução do `EvolutionClient` (`@inno/messaging`) por
 * instância, do lado do WORKER (ARQUITETURA §6.8.0.1, Fase 4.F.4).
 *
 * A cifra e a resolução em si (achar o `EvolutionServer`, decifrar a
 * credencial, montar o cliente) moram em `@inno/sending`
 * (`evolution-crypto.ts`/`evolution-resolver.ts`) — compartilhadas com
 * `apps/web/src/lib/evolution.ts`, que resolve o MESMO problema do lado da
 * rota HTTP. Este arquivo é a camada fina do worker em cima disso, e a razão
 * de existir uma camada por app (em vez de uma função só) é a POLÍTICA DE
 * ERRO, que é deliberadamente diferente dos dois lados:
 *
 *   - `apps/web` tem uma requisição HTTP esperando → servidor ausente/
 *     inativo vira `502 UPSTREAM_ERROR` (nosso problema a resolver AGORA).
 *   - `apps/worker` não tem requisição nenhuma → o `dispatch-tick.job`
 *     precisa TIRAR a instância da rotação deste ciclo e, se não sobrar
 *     nenhuma, HALTAR a campanha com motivo legível (ARQUITETURA §6.8.3
 *     passo 2.2). Forçar as duas reações a serem iguais seria pior que a
 *     duplicação que `@inno/sending` já evita.
 *
 * Por isso `resolveWorkerEvolutionClient` NUNCA lança por servidor ausente/
 * inativo — devolve o MESMO `ResolveInstanceEvolutionClientResult` de
 * `@inno/sending`, e quem chama (`dispatch-tick.job`) decide o efeito.
 */
import type { PrismaClient } from '@inno/db';
import type { EvolutionClient } from '@inno/messaging';
import {
  buildLegacyEnvEvolutionClient,
  resolveInstanceEvolutionClient,
  type EvolutionCryptoEnv,
  type ResolveInstanceEvolutionClientResult,
} from '@inno/sending';
import { logger } from '../observability/logger.js';

let legacyEnvClient: EvolutionClient | null = null;
let legacyEnvFallbackWarned = false;

/**
 * Mesmo fallback de `apps/web/src/lib/evolution.ts#getLegacyEnvEvolutionClient`
 * — cliente único de PROCESSO a partir de `EVOLUTION_API_URL`/
 * `EVOLUTION_API_KEY`, usado só para `WhatsAppInstance` cujo
 * `evolutionServerId` ainda é `null` (linha legada, pré Fase 4.B). Cache e
 * aviso são DESTE processo (worker) — `apps/web` tem o seu próprio,
 * deliberadamente duplicado (mesmo princípio de log/alerta, §6.8.0.3).
 */
function getLegacyEnvEvolutionClient(env: EvolutionCryptoEnv): EvolutionClient {
  if (!legacyEnvClient) {
    legacyEnvClient = buildLegacyEnvEvolutionClient(env);
  }
  if (!legacyEnvFallbackWarned) {
    legacyEnvFallbackWarned = true;
    logger.warn(
      'evolution.fallback_env_ativo (worker) — instância(s) sem evolutionServerId ainda dependem de EVOLUTION_API_URL/EVOLUTION_API_KEY',
    );
  }
  return legacyEnvClient;
}

export type WorkerEvolutionResolveDeps = {
  prisma: Pick<PrismaClient, 'evolutionServer'>;
  env: EvolutionCryptoEnv;
};

/**
 * Resolve o cliente Evolution de uma `WhatsAppInstance` já existente, para o
 * `dispatch-tick.job` mandar `sendText`. Nunca lança por servidor ausente/
 * inativo — ver cabeçalho do arquivo. Lança só se a CIFRA falhar de verdade
 * (chave-mestre ausente/malformada) — erro de configuração real, que
 * nenhuma decisão de rotação de instância consegue tratar como "servidor
 * indisponível agora".
 */
export async function resolveWorkerEvolutionClient(
  deps: WorkerEvolutionResolveDeps,
  instance: { evolutionServerId: string | null },
): Promise<ResolveInstanceEvolutionClientResult> {
  return resolveInstanceEvolutionClient(
    { prisma: deps.prisma, env: deps.env, legacyClient: () => getLegacyEnvEvolutionClient(deps.env) },
    instance,
  );
}

/** Só para teste — reseta o cache do fallback legado entre casos. */
export function resetLegacyEnvEvolutionClientCacheForTest(): void {
  legacyEnvClient = null;
  legacyEnvFallbackWarned = false;
}
