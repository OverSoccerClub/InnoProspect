/**
 * jobs/warmup-roll.job.ts — ARQUITETURA §6.2/§6.9. Diário, ~00:10
 * `APP_TIMEZONE` (agendado via BullMQ `pattern` cron + `tz`, `scheduler.ts`).
 *
 * Sem este job, `WhatsAppInstance.warmupDay` NUNCA avança e toda instância
 * fica presa em 20 msgs/dia para sempre — `WARMUP_TABLE`/`effectiveDailyLimit`
 * (`@inno/core`) já são lidos pelo guard/tick desde a Fase 4.A/4.F.4, mas até
 * esta rodada ninguém escrevia o dia. Não é melhoria: é o que faz o §6.2
 * existir de fato (ver ARQUITETURA §6.9, linha `warmup-roll.job`).
 *
 * Os 3 passos do §6.9, aplicados por instância:
 *   1. Se `InstanceDailyStat` de ONTEM (dia civil no fuso do app,
 *      `localDateKey` — mesma função religada na 4.F.2, não uma quarta cópia
 *      manual) tiver `sentCount > 0` → `warmupDay += 1`. Instância parada
 *      não "amadurece sozinha".
 *   2. Se `warmupFrozenAt` estiver setado (escrito pelo `health-check.job`,
 *      §6.6, taxa de falha > 30% em 50 envios), NÃO avança — só congela,
 *      nunca recua aqui. 🔵 A heurística que congela por taxa de RESPOSTA
 *      (<2% em 48h, >=100 enviadas) é Fase 5/6 (§6.9) — esta rodada só
 *      RESPEITA a coluna `warmupFrozenAt`, não a calcula por essa via. Não é
 *      esquecimento: é o mesmo critério de corte "sem histórico suficiente
 *      no aceite da Fase 4, não é testável agora" que exclui a heurística em
 *      si — decisão registrada no handoff do Vega, não implementada em
 *      silêncio.
 *   3. Zera `sendsSinceMicroPause`/`consecutiveUncertain` — INCONDICIONAL,
 *      toda instância ativa, independente dos passos 1/2 (§6.3/§6.8.6: os
 *      dois contadores são "do dia", e um dia novo os zera mesmo que o
 *      warmup não tenha avançado).
 *
 * ⚠️ Restart no meio do ciclo: cada instância é processada com o SEU PRÓPRIO
 * `update`, dentro de um laço com `try/catch` por item (mesma postura de
 * `processCampaign`/`checkInstanceFailureRates`) — se o worker cair na
 * metade, as instâncias já processadas mantêm o avanço, e as que faltaram
 * simplesmente NÃO avançam hoje (autolimitado: o pior efeito é "não ganhou
 * 1 dia de aquecimento", nunca um dado incoerente). O agendamento em si
 * (`upsertJobScheduler` com `pattern` cron, não um `setTimeout`) já resolve
 * o caso "o processo estava fora do ar EXATAMENTE às 00:10": o BullMQ calcula
 * a PRÓXIMA ocorrência do padrão a partir de agora, não reexecuta a de ontem
 * — perder o disparo de um dia é seguro (mesmo efeito autolimitado do
 * parágrafo anterior); o que NÃO poderia acontecer, e por isso o agendamento
 * usa `upsertJobScheduler` (idempotente por `jobSchedulerId`, mesmo padrão
 * do `dispatch-tick`) em vez de `add(..., {repeat})`, é rodar DUAS VEZES no
 * mesmo dia por causa de um restart reagendando por cima.
 */
import type { Job } from 'bullmq';
import { prisma as defaultPrisma, type Prisma, type PrismaClient, type WhatsAppInstance } from '@inno/db';
import { localDateKey } from '@inno/core';
import { logger as defaultLogger, type Logger } from '../observability/logger.js';

export type WarmupRollDeps = {
  prisma: PrismaClient;
  logger: Logger;
  /** Default `() => new Date()` — testes de virada de dia injetam um relógio fixo. */
  now?: () => Date;
};

export function defaultWarmupRollDeps(): WarmupRollDeps {
  return { prisma: defaultPrisma, logger: defaultLogger };
}

type RollOutcome = 'advanced' | 'frozen' | 'skipped';

export async function runWarmupRoll(deps: WarmupRollDeps): Promise<void> {
  const now = deps.now ? deps.now() : new Date();
  const tz = process.env.APP_TIMEZONE || 'America/Sao_Paulo';
  const today = localDateKey(now, tz);
  // `localDateKey` devolve meia-noite UTC do dia civil — subtrair 24h em
  // millis dá sempre o dia civil ANTERIOR, sem depender de fuso na conta
  // (a normalização de fuso já aconteceu dentro de `localDateKey`).
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  const instances = await deps.prisma.whatsAppInstance.findMany({ where: { isActive: true } });
  const counts: Record<RollOutcome, number> = { advanced: 0, frozen: 0, skipped: 0 };

  for (const instance of instances) {
    try {
      const outcome = await rollOneInstance(deps.prisma, instance, yesterday);
      counts[outcome]++;
    } catch (err) {
      deps.logger.error(
        { instanceId: instance.id, err: err instanceof Error ? err.message : String(err) },
        'warmup-roll: erro avançando instância — outras continuam',
      );
    }
  }

  deps.logger.info({ total: instances.length, yesterday: yesterday.toISOString(), ...counts }, 'warmup-roll: ciclo concluído');
}

export function createWarmupRollProcessor(deps: WarmupRollDeps) {
  return async function processWarmupRollJob(_job: Job): Promise<void> {
    await runWarmupRoll(deps);
  };
}

async function rollOneInstance(prisma: PrismaClient, instance: WhatsAppInstance, yesterday: Date): Promise<RollOutcome> {
  // Passo 3 — incondicional, sempre presente no `data`.
  const data: Prisma.WhatsAppInstanceUpdateInput = { sendsSinceMicroPause: 0, consecutiveUncertain: 0 };

  // Passo 2 — congelado, não avança (nunca recua aqui — regressão é
  // `regressWarmupDay`, ligado só ao reconectar, `instance-connection.ts`).
  if (instance.warmupFrozenAt !== null) {
    await prisma.whatsAppInstance.update({ where: { id: instance.id }, data });
    return 'frozen';
  }

  // Passo 1 — precisa ter enviado ONTEM para ganhar o dia.
  const stat = await prisma.instanceDailyStat.findUnique({
    where: { instanceId_date: { instanceId: instance.id, date: yesterday } },
  });
  if (!stat || stat.sentCount <= 0) {
    await prisma.whatsAppInstance.update({ where: { id: instance.id }, data });
    return 'skipped';
  }

  data.warmupDay = { increment: 1 };
  await prisma.whatsAppInstance.update({ where: { id: instance.id }, data });
  return 'advanced';
}
