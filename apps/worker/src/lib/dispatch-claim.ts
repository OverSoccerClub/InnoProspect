/**
 * lib/dispatch-claim.ts — o claim atômico do §6.8.2: `SELECT ... FOR UPDATE
 * SKIP LOCKED` + lease, numa ÚNICA instrução SQL (`UPDATE ... WHERE id =
 * (subquery)`), para não precisar de uma transação explícita só para isto —
 * o `UPDATE` já é atômico por natureza no Postgres.
 *
 * 🔒 Duas armadilhas documentadas na ARQUITETURA §6.8.2, ambas evitadas por
 * desenho aqui:
 *   1. `ORDER BY "scheduledFor"` SEM `NULLS FIRST` — com `NULLS FIRST` o
 *      planner abandona o índice `(campaignId, status, scheduledFor)` e
 *      varre a tabela a cada tick. `scheduledFor` nunca é `NULL` a partir do
 *      `start` (§4.5.9 passo 8) — não há "sem agendamento" para priorizar.
 *   2. Não existe status `sending` — o alvo continua `pending`, só o
 *      `scheduledFor` avança para o fim do lease e `attempt` incrementa.
 *
 * A garantia dura contra envio duplicado NÃO é este claim — é
 * `Message.campaignTargetId @unique` (write-ahead, dentro de
 * `executeSendAttempt`). Este módulo só entrega performance/exclusão mútua
 * entre dois processos worker no ar ao mesmo tempo (deploy).
 */
import { type PrismaClient } from '@inno/db';

export type ClaimedCampaignTarget = {
  id: string;
  leadId: string;
  phoneE164: string;
  attempt: number;
};

export async function claimNextCampaignTarget(
  prisma: Pick<PrismaClient, '$queryRaw'>,
  campaignId: string,
  leaseUntil: Date,
): Promise<ClaimedCampaignTarget | null> {
  const rows = await prisma.$queryRaw<ClaimedCampaignTarget[]>`
    UPDATE campaign_targets
    SET "scheduledFor" = ${leaseUntil}, attempt = attempt + 1, "updatedAt" = now()
    WHERE id = (
      SELECT id FROM campaign_targets
      WHERE "campaignId" = ${campaignId} AND status = 'pending' AND "scheduledFor" <= now()
      ORDER BY "scheduledFor"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, "leadId", "phoneE164", attempt;
  `;
  return rows[0] ?? null;
}
