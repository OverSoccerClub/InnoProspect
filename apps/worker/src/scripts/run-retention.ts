/**
 * scripts/run-retention.ts — execução MANUAL do `retention.job`
 * (ARQUITETURA §7.5/§6.9, Fase 5.3). Entry do tsup (ver
 * `apps/worker/tsup.config.ts`) — roda na imagem de PRODUÇÃO via
 * `node dist/scripts/run-retention.js`, nunca `pnpm run` (mesma regra do
 * `backfill-off-niche.ts`: a imagem final não tem `pnpm`/`tsx`/`src/`).
 *
 * ⚠️ DEFAULT INVERTIDO em relação a `backfill-off-niche.ts` (que default
 * APLICA, com `--dry-run` como opt-in de segurança) — DE PROPÓSITO, pedido
 * explícito do escopo desta rodada: "apagar é a exceção que se pede
 * explicitamente". Este é o job MAIS DESTRUTIVO do sistema — exclusão física
 * de `Lead`/`Message`/`LeadActivity`, sem desfazer. Sem NENHUMA flag, este
 * script SEMPRE simula (`dryRun: true`). Só `--apply` aplica de verdade.
 *
 * Este flag é INDEPENDENTE de `RETENTION_DRY_RUN` (env) — aquele knob
 * governa só o CRON agendado em `scheduler.ts`. As duas portas de entrada
 * decidem seu próprio dry-run de propósito: o dono pode querer rodar isto à
 * mão ("o que apagaria hoje?") sem tocar na env que controla o agendamento
 * automático, e vice-versa — nenhuma delas deveria depender da outra para
 * ficar segura.
 *
 * USO EM PRODUÇÃO (shell no container do worker, working dir `/app`):
 *   node dist/scripts/run-retention.js              # SIMULAÇÃO — nada é apagado/redigido
 *   node dist/scripts/run-retention.js --apply       # aplica de verdade
 *
 * USO EM DESENVOLVIMENTO (a partir de apps/worker, com o fonte à mão):
 *   pnpm exec tsx src/scripts/run-retention.ts [-- --apply]
 */
import { prisma } from '@inno/db';
import { resolveRetentionConfig } from '../lib/retention-config.js';
import { runRetention } from '../jobs/retention.job.js';
import { logger } from '../observability/logger.js';
import { sendAlert } from '../observability/alerts.js';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  // Herda os NÚMEROS (meses/tetos) da env, se configurados — só o `dryRun`
  // é decidido pelo flag da linha de comando, nunca pela env, aqui.
  const envConfig = resolveRetentionConfig(process.env);
  const config = { ...envConfig, dryRun: !apply };

  const summary = await runRetention({ prisma, logger, notify: sendAlert, config });

  const prefix = config.dryRun ? '[SIMULAÇÃO — nada foi apagado/redigido] ' : '[APLICADO] ';
  console.log(`\n${prefix}${JSON.stringify(summary, null, 2)}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
