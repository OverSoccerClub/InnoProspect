import { prisma } from '@inno/db';
import { logger } from './observability/logger.js';
import { logAlertingStatusOnce } from './observability/alerts.js';
import { startWorkers } from './scheduler.js';
import { requeueOrphanTasks } from './jobs/requeue-orphans.js';

async function main(): Promise<void> {
  // Onda 2: diz já no boot se ALERT_WEBHOOK_URL está configurada ou não —
  // sem isto, "o alerta está desligado" só se descobre quando um incidente
  // acontece e ninguém é avisado (o próprio motivo desta rodada existir).
  logAlertingStatusOnce();

  // Falha rápido e com mensagem clara se o processo subir sem banco
  // configurado — melhor que um erro genérico de conexão minutos depois,
  // no meio do processamento de uma SearchTask.
  await prisma.$connect();
  logger.info('conectado ao Postgres');

  const workers = startWorkers();
  logger.info('worker up');

  // Onda 1 item 1.5 (risco R10, REVISAO-ARQUITETURA §4.1): recolhe
  // SearchTask presas em `pending`/`running` de uma execução anterior —
  // Redis que perdeu a fila, enqueue que falhou silenciosamente
  // (`services/searches.ts`), ou worker que morreu no meio do processamento.
  // Roda 1x no boot, depois que a fila/worker já estão prontos para consumir
  // o que for reenfileirado.
  try {
    await requeueOrphanTasks(workers.scrapeSearchQueue);
  } catch (err) {
    logger.error({ err }, 'requeue-orphans falhou no boot — worker continua no ar, mas tasks órfãs podem seguir presas até o próximo restart');
  }

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'worker shutting down');
    try {
      await workers.close();
      await prisma.$disconnect();
    } catch (err) {
      logger.error({ err }, 'error while closing worker resources');
    } finally {
      logger.info('worker stopped');
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

main().catch((err: unknown) => {
  logger.error({ err }, 'worker failed to start');
  process.exit(1);
});
