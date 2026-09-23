import { prisma } from '@inno/db';
import { logger } from './observability/logger.js';
import { logAlertingStatusOnce } from './observability/alerts.js';
import { startWorkers } from './scheduler.js';
import { requeueOrphanTasks } from './jobs/requeue-orphans.js';
import { runSelfTest } from './selftest-checks.js';

async function main(): Promise<void> {
  // Onda 2: diz já no boot se ALERT_WEBHOOK_URL está configurada ou não —
  // sem isto, "o alerta está desligado" só se descobre quando um incidente
  // acontece e ninguém é avisado (o próprio motivo desta rodada existir).
  logAlertingStatusOnce();

  // Auto-teste COMPLETO antes de subir qualquer Worker/Queue de verdade — ver
  // `selftest.ts` para o porquê (5 incidentes de 22-23/09 que passaram por
  // typecheck/lint/testes/build e só apareceram no boot do container real:
  // nome de fila inválido, `.ts` fonte no bundle, Chromium divergente da
  // imagem base, `require` de CommonJS em ESM, script operacional impossível
  // de rodar). Substitui o antigo `prisma.$connect()` isolado — a checagem
  // `postgres` do selftest já faz um `SELECT 1` real — e estende o mesmo
  // fail-fast para Redis/filas e Chromium: se algo aqui quebrar, o processo
  // encerra ANTES de aceitar qualquer job, com o passo exato que falhou no
  // log, em vez de crash-loop silencioso ou sucesso aparente sem conseguir
  // trabalhar.
  const selftest = await runSelfTest('full');
  for (const step of selftest.steps) {
    if (step.ok) {
      logger.info({ step: step.name, durationMs: step.durationMs, detail: step.detail }, 'selftest: passo OK');
    } else {
      logger.fatal({ step: step.name, durationMs: step.durationMs, error: step.error }, 'selftest: passo FALHOU');
    }
  }
  if (!selftest.ok) {
    logger.fatal('selftest falhou no boot — worker não vai subir Workers/Queues; ver os passos acima');
    process.exit(1);
  }
  logger.info('selftest ok — módulos internos, Postgres, Redis/filas e Chromium confirmados de verdade');

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
