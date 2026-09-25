/**
 * jobs/health-check.job.ts — fatia MÍNIMA do health-check (ARQUITETURA §6.9,
 * §6.6, §6.2) que ENTRA na Fase 4: só o que faz o sistema PARAR de queimar
 * cota contra um provedor morto ou uma instância podre.
 *
 * O que este job faz (~90s, `DISPATCH_HEALTH_CHECK_INTERVAL_S`, agendado em
 * `scheduler.ts`):
 *   1. Ping em toda `EvolutionServer` ativa (+ o cliente legado da env, se
 *      existir alguma instância sem `evolutionServerId`). Se TODOS os pings
 *      desta rodada falharem, conta como "Evolution fora do ar" — o contador
 *      de falhas CONSECUTIVAS (`lib/health-check-state.ts`, Redis) sobe; ao
 *      atingir `DISPATCH_HEALTH_CHECK_PING_HALT_AT` (default 3), HALTA
 *      TODAS as campanhas `running` + alerta (ARQUITETURA §6.6: "Evolution
 *      API fora do ar (3x) → Todas as campanhas → halted").
 *      Decisão explícita: um outage PARCIAL (alguns servidores no ar, outros
 *      não, num deploy multi-servidor) NÃO dispara este halt global — cada
 *      envio individual contra o servidor caído já vira `evolution_api_error`
 *      pelo caminho existente (`send-one.ts`/`dispatch-tick.job.ts`). Este
 *      job só cobre o caso "não há NENHUM Evolution para onde mandar nada".
 *   2. Para cada instância ativa (não banida), taxa de falha nos últimos
 *      `DISPATCH_HEALTH_CHECK_FAILURE_RATE_SAMPLE` (default 50) envios
 *      RESOLVIDOS (sent/delivered/read/failed — nunca `queued`, que ainda não
 *      tem resultado). Acima de `DISPATCH_HEALTH_CHECK_FAILURE_RATE_THRESHOLD`
 *      (default 30%) → `isDegraded=true` + `warmupFrozenAt=now` (congela o
 *      `warmup-roll.job`, ARQUITETURA §6.2/§6.9). Quando a taxa volta ao
 *      normal, DESCONGELA (`warmupFrozenAt: null`) — mas NÃO força
 *      `isDegraded` de volta a `false`: a outra via de degradação
 *      (`consecutiveFailures >= 5`, `send-one.ts`) nunca grava
 *      `warmupFrozenAt`, e forçar `isDegraded: false` aqui apagaria um sinal
 *      de saúde que pode não ser deste mecanismo. `isDegraded` já tem um
 *      caminho de reset correto e existente (qualquer reconfirmação de
 *      `connected`, `instance-connection.ts`).
 *
 * O que este job NÃO faz, de propósito (ARQUITETURA §6.9 — critério de
 * corte explícito, "se a regra precisa de mais histórico do que o aceite da
 * Fase 4 produz, ela não é testável agora"): as duas heurísticas de
 * shadow-ban por taxa de RESPOSTA — "< 2% de resposta em 48h com >=100
 * enviadas" e "ausência total de resposta em 100+ envios". Com 50 alvos no
 * aceite da Fase 4, nenhuma das duas jamais atinge amostra suficiente;
 * entregá-las agora seria repetir a lição das "quatro funções sem chamador"
 * (§8.0 regra 3) — código que ninguém nunca viu disparar. Ficam para a Fase
 * 5/6, junto com o `retention.job`.
 */
import type { Job, Queue } from 'bullmq';
import { prisma as defaultPrisma, type PrismaClient, type WhatsAppInstance } from '@inno/db';
import { buildEvolutionClientFromServer, buildLegacyEnvEvolutionClient, type EvolutionCryptoEnv } from '@inno/sending';
import { resolveHealthCheckConfig, type HealthCheckConfig } from '../lib/health-check-config.js';
import { recordEvolutionPingFailure, resetEvolutionPingFailureStreak } from '../lib/health-check-state.js';
import { logger as defaultLogger, type Logger } from '../observability/logger.js';
import { sendAlert as defaultSendAlert, type AlertEvent } from '../observability/alerts.js';

export type HealthCheckDeps = {
  prisma: PrismaClient;
  logger: Logger;
  notify: (event: AlertEvent) => void | Promise<void>;
  /** Fila usada só para o `.client` do Redis (contador de falhas de ping, `lib/health-check-state.ts`) — mesmo truque de `dispatch-state.ts`. */
  maintenanceQueue: Queue;
  /** Default `() => new Date()` — testes de congelamento/recuperação injetam um relógio fixo. */
  now?: () => Date;
};

export function defaultHealthCheckDeps(maintenanceQueue: Queue): HealthCheckDeps {
  return { prisma: defaultPrisma, logger: defaultLogger, notify: defaultSendAlert, maintenanceQueue };
}

export async function runHealthCheck(deps: HealthCheckDeps): Promise<void> {
  const config = resolveHealthCheckConfig(process.env);
  const now = deps.now ? deps.now() : new Date();

  await checkEvolutionPing(deps, config);
  await checkInstanceFailureRates(deps, config, now);
}

export function createHealthCheckProcessor(deps: HealthCheckDeps) {
  return async function processHealthCheckJob(_job: Job): Promise<void> {
    await runHealthCheck(deps);
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Passo 1 — ping na Evolution (ARQUITETURA §6.6, linha "Evolution API fora
// do ar")
// ─────────────────────────────────────────────────────────────────────────

type PingRoundResult = { attempted: number; allFailed: boolean };

/**
 * Pinga TODA `EvolutionServer` ativa (via `testConnection`, o mesmo GET
 * `/instance/fetchInstances` que o botão "testar conexão" do admin já usa) e
 * também o cliente legado da env, se alguma instância ainda depender dele
 * (`evolutionServerId: null`, pré-Fase-4.B). `attempted: 0` quando não há
 * nenhum destino configurado — não é sinal de outage, é ausência de
 * configuração (ambiente recém-instalado), e não deve contar nem como
 * sucesso nem como falha.
 */
async function pingAllEvolutionTargets(deps: HealthCheckDeps): Promise<PingRoundResult> {
  const [servers, legacyInstanceCount] = await Promise.all([
    deps.prisma.evolutionServer.findMany({ where: { isActive: true } }),
    deps.prisma.whatsAppInstance.count({ where: { evolutionServerId: null, isActive: true } }),
  ]);

  const env = process.env as EvolutionCryptoEnv;
  const pings: Array<() => Promise<void>> = servers.map((server) => async () => {
    const client = buildEvolutionClientFromServer(server, env);
    await client.testConnection();
  });
  if (legacyInstanceCount > 0) {
    pings.push(async () => {
      const client = buildLegacyEnvEvolutionClient(env);
      await client.testConnection();
    });
  }

  if (pings.length === 0) return { attempted: 0, allFailed: false };

  const results = await Promise.allSettled(pings.map((run) => run()));
  const failures = results.filter((r) => r.status === 'rejected').length;
  return { attempted: pings.length, allFailed: failures === pings.length };
}

async function checkEvolutionPing(deps: HealthCheckDeps, config: HealthCheckConfig): Promise<void> {
  const { attempted, allFailed } = await pingAllEvolutionTargets(deps);
  if (attempted === 0) return;

  if (!allFailed) {
    await resetEvolutionPingFailureStreak(deps.maintenanceQueue);
    return;
  }

  const streak = await recordEvolutionPingFailure(deps.maintenanceQueue);
  deps.logger.warn({ streak, threshold: config.pingConsecutiveFailuresHaltAt }, 'health-check: ping na Evolution falhou (todos os destinos)');

  if (streak < config.pingConsecutiveFailuresHaltAt) return;

  // `updateMany` com filtro `status:'running'` já É o gate de "isto é novo"
  // (mesmo espírito de `haltCampaign`/`sweepQueuePause`): num ciclo seguinte,
  // com a Evolution ainda fora do ar, todas as campanhas já estão `halted` e
  // `result.count` volta 0 — não re-halta nada nem realerta a cada ~90s.
  const result = await deps.prisma.campaign.updateMany({
    where: { status: 'running' },
    data: { status: 'halted', haltReason: `Evolution API fora do ar — ${streak} falhas de ping consecutivas (health-check).` },
  });
  if (result.count === 0) return;

  deps.logger.error({ streak, haltedCount: result.count }, 'health-check: Evolution fora do ar — todas as campanhas running foram HALTADAS');
  void deps.notify({ kind: 'dispatch_evolution_down_all_halted', haltedCampaignCount: result.count, consecutivePingFailures: streak });
}

// ─────────────────────────────────────────────────────────────────────────
// Passo 2 — taxa de falha por instância (ARQUITETURA §6.6, linha "Taxa de
// falha > 30% em 50 envios")
// ─────────────────────────────────────────────────────────────────────────

async function checkInstanceFailureRates(deps: HealthCheckDeps, config: HealthCheckConfig, now: Date): Promise<void> {
  const instances = await deps.prisma.whatsAppInstance.findMany({ where: { isActive: true, status: { not: 'banned' } } });

  for (const instance of instances) {
    try {
      await evaluateInstanceFailureRate(deps, config, instance, now);
    } catch (err) {
      // Uma instância com erro de leitura NUNCA impede a avaliação das
      // outras — mesma postura de `processCampaign`/`gatherSanityInput`.
      deps.logger.error(
        { instanceId: instance.id, err: err instanceof Error ? err.message : String(err) },
        'health-check: erro avaliando taxa de falha da instância — outras instâncias continuam',
      );
    }
  }
}

async function evaluateInstanceFailureRate(
  deps: HealthCheckDeps,
  config: HealthCheckConfig,
  instance: WhatsAppInstance,
  now: Date,
): Promise<void> {
  const recent = await deps.prisma.message.findMany({
    where: { instanceId: instance.id, direction: 'outbound', status: { in: ['sent', 'delivered', 'read', 'failed'] } },
    orderBy: { createdAt: 'desc' },
    take: config.failureRateSampleSize,
    select: { status: true },
  });

  // Amostra insuficiente — nada a decidir ainda (mesmo critério de corte da
  // ARQUITETURA §6.9: "se a regra precisa de mais histórico do que produz o
  // aceite, ela não dispara" — aqui ela SIMPLESMENTE ESPERA a amostra, o que
  // é diferente das duas heurísticas de shadow-ban excluídas acima).
  if (recent.length < config.failureRateSampleSize) return;

  const failedCount = recent.filter((m) => m.status === 'failed').length;
  const failureRate = failedCount / recent.length;
  const triggered = failureRate > config.failureRateThreshold;

  if (triggered) {
    if (instance.warmupFrozenAt !== null) return; // já sinalizado — dedupe, não re-alerta a cada ciclo.
    await deps.prisma.whatsAppInstance.update({ where: { id: instance.id }, data: { isDegraded: true, warmupFrozenAt: now } });
    deps.logger.warn(
      { instanceId: instance.id, failureRate, sampleSize: recent.length, threshold: config.failureRateThreshold },
      'health-check: instância DEGRADADA por taxa de falha alta — warmup congelado',
    );
    void deps.notify({
      kind: 'dispatch_instance_failure_rate_degraded',
      instanceId: instance.id,
      instanceName: instance.name,
      failureRate,
      sampleSize: recent.length,
      threshold: config.failureRateThreshold,
    });
    return;
  }

  // Recuperação — só DESCONGELA (`warmupFrozenAt: null`), nunca toca
  // `isDegraded` de volta para `false`. Decisão deliberada: uma instância
  // pode estar degradada pela OUTRA via (`consecutiveFailures >= 5`,
  // `send-one.ts`, que nunca escreve `warmupFrozenAt`) AO MESMO TEMPO em que
  // a taxa de falha desta janela melhora — forçar `isDegraded: false` aqui
  // apagaria um sinal de saúde que não é deste mecanismo para apagar.
  // `isDegraded` já tem um caminho de reset existente e correto (qualquer
  // reconfirmação de `connected`, `instance-connection.ts`); este job só
  // devolve o que É seu: a permissão de o warmup voltar a avançar.
  if (instance.warmupFrozenAt !== null) {
    await deps.prisma.whatsAppInstance.update({ where: { id: instance.id }, data: { warmupFrozenAt: null } });
    deps.logger.info(
      { instanceId: instance.id, failureRate, sampleSize: recent.length },
      'health-check: taxa de falha normalizada — warmup descongelado',
    );
  }
}
