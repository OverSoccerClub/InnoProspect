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
 * USO (dentro do container, a partir de apps/worker):
 *   pnpm run backfill:off-niche
 *   node ../../node_modules/.bin/tsx src/scripts/backfill-off-niche.ts [--dry-run]
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
