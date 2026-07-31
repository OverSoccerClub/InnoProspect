import { prisma } from '@inno/db';
import { logger } from './observability/logger.js';
import { startWorkers } from './scheduler.js';

async function main(): Promise<void> {
  // Falha rápido e com mensagem clara se o processo subir sem banco
  // configurado — melhor que um erro genérico de conexão minutos depois,
  // no meio do processamento de uma SearchTask.
  await prisma.$connect();
  logger.info('conectado ao Postgres');

  const workers = startWorkers();
  logger.info('worker up');

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
