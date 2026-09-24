/**
 * lib/services/campaign-targets.ts — 🆕 Fase 4.F.1: a implementação de fato
 * mudou de casa para `@inno/sending` (ARQUITETURA §6.8.0.4 — "transição do
 * alvo de campanha e contadores" não pode ter uma segunda implementação; o
 * futuro `dispatch-tick.job`, Fase 4.F.4, precisa da MESMA função). Este
 * arquivo continua existindo como fina camada de compatibilidade — os outros
 * 2 call sites que já existiam antes desta rodada (webhook `connection.
 * update`, `POST /whatsapp/instances/:id/disconnect`) continuam chamando com
 * a MESMA assinatura, sem nenhuma alteração.
 *
 * `advanceCampaignTargetStatus`/`skipPendingCampaignTargetsForPhone` são
 * reexportados sem embrulho (comportamento idêntico). `haltCampaignsSole
 * InstanceDisconnected` ganha um embrulho fino que injeta `sendAlert`
 * (`lib/alerts.ts`) como `notify` — a versão de `@inno/sending` recebe
 * `notify` como PARÂMETRO explícito (nunca importa `lib/alerts` direto, ver
 * `packages/sending/src/ports.ts`) para não acoplar o pacote compartilhado a
 * nenhum dos dois apps.
 */
import type { Prisma } from '@inno/db';
import { advanceCampaignTargetStatus, haltCampaignsSoleInstanceDisconnected as haltCampaignsSoleInstanceDisconnectedCore, skipPendingCampaignTargetsForPhone } from '@inno/sending';
import { sendAlert } from '@/lib/alerts';

export { advanceCampaignTargetStatus, skipPendingCampaignTargetsForPhone };
export type { AdvanceCampaignTargetStatusOptions } from '@inno/sending';

export async function haltCampaignsSoleInstanceDisconnected(tx: Prisma.TransactionClient, instanceId: string, haltReason: string): Promise<string[]> {
  return haltCampaignsSoleInstanceDisconnectedCore(tx, instanceId, haltReason, sendAlert);
}
