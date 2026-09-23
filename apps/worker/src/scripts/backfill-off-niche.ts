/**
 * backfill-off-niche.ts — recalcula `Lead.offNiche` para leads já
 * persistidos (ver o campo em `packages/db/prisma/schema.prisma` e o
 * critério em `packages/core/src/leads/niche.ts`, `isOffNiche`).
 *
 * POR QUE EXISTE
 * `Lead.offNiche` é escrito pelo UPSERT do scraping (`jobs/scrape-search.
 * job.ts`), a cada coleta/re-coleta — mas os leads coletados ANTES deste
 * campo existir nunca passaram por esse upsert com o critério novo, e ficam
 * com o valor padrão (`false`) sem terem sido de fato avaliados. Este
 * script fecha essa lacuna sem exigir um re-scraping completo.
 *
 * TAMBÉM é como o critério de divergência (`isOffNiche`) é aplicado à base
 * já existente sempre que ele MUDAR de lógica (ver "COMO MUDAR O CRITÉRIO
 * DEPOIS" no comentário de `niche.ts`) — mudar o algoritmo é só código +
 * deploy; refletir a mudança nos leads já gravados é rodar este script de
 * novo. Idempotente: rodar 2x sem nada ter mudado não altera nenhuma linha.
 *
 * offNiche é sempre relativo ao nicho da busca de ORIGEM do lead
 * (`Lead.searchJobId`, imutável) — nunca recalculado contra outra busca.
 *
 * PAGINA POR CURSOR (nunca `findMany` sem `take`) — mesmo padrão de
 * `iterateLeadsForExport` (`apps/web/src/lib/services/leads.ts`). Hoje a
 * base tem ~180 linhas (sem drama nenhum); em 500k linhas isso é o que evita
 * carregar a tabela inteira em memória de uma vez — ver nota de escala na
 * migração `20260923090000_lead_off_niche`.
 *
 * USO EM PRODUÇÃO (shell no container do worker, working dir `/app`):
 *   node dist/scripts/backfill-off-niche.js [--dry-run]
 *
 * ⚠️ NÃO use `pnpm run backfill:off-niche` no container. A imagem final não
 * tem `pnpm`, não tem `tsx` e não copia `src/` — ela carrega só `dist/`, o
 * `package.json` e o node_modules de produção. O comando com `pnpm` falha
 * com `/bin/sh: 1: pnpm: not found`, que foi o que aconteceu na primeira
 * tentativa real (2026-09-23). É por isso que este arquivo é uma ENTRADA do
 * tsup (ver `apps/worker/tsup.config.ts`) e não só um script de
 * desenvolvimento.
 *
 * USO EM DESENVOLVIMENTO (a partir de apps/worker, com o fonte à mão):
 *   pnpm run backfill:off-niche [-- --dry-run]
 */
import { prisma } from '@inno/db';
import { isOffNiche } from '@inno/core';

const PAGE_SIZE = 1000;

async function backfillOffNiche(options: { dryRun: boolean }): Promise<void> {
  let cursor: string | undefined;
  let scanned = 0;
  let changed = 0;

  while (true) {
    const rows = await prisma.lead.findMany({
      select: { id: true, category: true, offNiche: true, searchJob: { select: { niche: true } } },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      const shouldBeOffNiche = isOffNiche(row.searchJob.niche, row.category);
      if (shouldBeOffNiche === row.offNiche) continue;

      changed += 1;
      if (!options.dryRun) {
        await prisma.lead.update({ where: { id: row.id }, data: { offNiche: shouldBeOffNiche } });
      }
    }

    if (rows.length < PAGE_SIZE) break;
    cursor = rows[rows.length - 1]!.id;
  }

  const prefix = options.dryRun ? '[dry-run] ' : '';
  console.log(`\n${prefix}Leads avaliados: ${scanned}. offNiche alterado em: ${changed}.\n`);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await backfillOffNiche({ dryRun });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
