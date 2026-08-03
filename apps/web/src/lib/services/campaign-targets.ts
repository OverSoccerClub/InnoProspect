/**
 * lib/services/campaign-targets.ts — transição de status de `CampaignTarget`
 * (ARQUITETURA §3.1, §4.5, §4.8). Centraliza a regra que o Cronos pediu no
 * handoff do schema: "a transição de status do CampaignTarget precisa
 * incrementar o contador do Campaign NA MESMA transação — senão dessincroniza
 * desde o dia 1". Nenhum outro lugar do código deve fazer
 * `tx.campaignTarget.update({ data: { status } })` direto — sempre por aqui,
 * para o contador de `Campaign` nunca ficar sem o incremento correspondente.
 *
 * ⚠️ Fase 4 (dispatch worker, `apps/worker/src/jobs/dispatch-tick.job.ts`)
 * ainda não existe — esta rodada (Fase 3) só CHAMA isto do webhook
 * (`messages.upsert` → `responded`, `messages.update` → `delivered`/`read`/
 * `failed`) e do opt-out (`→ skipped`). A função já nasce pronta para o
 * worker de disparo usar (`→ sent`, `→ failed` em erro de envio) sem precisar
 * de nenhuma mudança aqui.
 */
import type { CampaignTargetStatus, Prisma } from '@inno/db';

/**
 * Ordem real do funil "feliz" (ARQUITETURA §3, comentário de
 * `Campaign.sentCount` no schema): um alvo que chega a `responded` passou por
 * `sent → delivered → read → responded`. `pending` é o estado inicial (sem
 * contador próprio — é lido ao vivo via `COUNT(*)`, não incrementado aqui).
 * `failed`/`skipped` são estados ABSORVENTES fora deste funil — tratados à
 * parte, sempre a partir de `pending` (ou de qualquer estado não-terminal).
 */
const FUNNEL_ORDER: readonly CampaignTargetStatus[] = ['pending', 'sent', 'delivered', 'read', 'responded'];

const FUNNEL_COUNTER_FIELD: Partial<Record<CampaignTargetStatus, string>> = {
  sent: 'sentCount',
  delivered: 'deliveredCount',
  read: 'readCount',
  responded: 'respondedCount',
};

const TERMINAL_STATUSES: ReadonlySet<CampaignTargetStatus> = new Set(['failed', 'skipped']);

export type AdvanceCampaignTargetStatusOptions = {
  /** Só usado quando `nextStatus` é `failed`/`skipped` — motivo legível (`CampaignTarget.skipReason`). */
  skipReason?: string;
  /** Só usado quando `nextStatus` é `sent` — timestamp real do envio (default: não altera `sentAt`). */
  sentAt?: Date;
};

/**
 * Avança `CampaignTarget.status` e incrementa o(s) contador(es) agregados de
 * `Campaign` correspondentes, ATOMICAMENTE (mesma `tx`). Idempotente e sem
 * regressão: reaplicar o mesmo status (ou um status "anterior" no funil) não
 * incrementa contador de novo nem sobrescreve o estado — importante porque o
 * webhook pode reprocessar o mesmo evento (retry da Evolution) e o `dispatch
 * worker` pode reler um alvo já avançado por outro processo.
 *
 * Retorna `null` se o `targetId` não existir (chamador decide se isso é erro
 * ou só um evento órfão a ignorar — o webhook, por ex., ignora).
 */
export async function advanceCampaignTargetStatus(
  tx: Prisma.TransactionClient,
  targetId: string,
  nextStatus: CampaignTargetStatus,
  opts: AdvanceCampaignTargetStatusOptions = {},
) {
  const target = await tx.campaignTarget.findUnique({ where: { id: targetId } });
  if (!target) return null;

  // Alvo já em estado terminal (failed/skipped) não é reaberto por nenhum
  // evento posterior — é definitivo por desenho (ARQUITETURA §4.5).
  if (TERMINAL_STATUSES.has(target.status)) return target;

  if (TERMINAL_STATUSES.has(nextStatus)) {
    const counterField = nextStatus === 'failed' ? 'failedCount' : 'skippedCount';
    // `tx` já É uma transação (o chamador está dentro de `prisma.$transaction`)
    // — `Prisma.TransactionClient` não expõe `$transaction` (nested transaction
    // não é suportado pelo Prisma), então as duas escritas seguem em sequência
    // na MESMA `tx`, o que já garante atomicidade com o resto do chamador.
    const updated = await tx.campaignTarget.update({
      where: { id: targetId },
      data: { status: nextStatus, skipReason: opts.skipReason ?? target.skipReason },
    });
    await tx.campaign.update({ where: { id: target.campaignId }, data: { [counterField]: { increment: 1 } } });
    return updated;
  }

  const currentIndex = FUNNEL_ORDER.indexOf(target.status);
  const nextIndex = FUNNEL_ORDER.indexOf(nextStatus);
  // `currentIndex === -1` não deveria acontecer (só failed/skipped ficam fora
  // da lista, e já foram tratados acima) — guarda defensiva mesmo assim.
  // `nextIndex <= currentIndex` é a proteção contra regressão/reprocessamento.
  if (currentIndex === -1 || nextIndex === -1 || nextIndex <= currentIndex) return target;

  // Incrementa TODOS os estágios entre o atual (exclusive) e o novo
  // (inclusive) — é o que sustenta `sentCount >= deliveredCount >= readCount
  // >= respondedCount` mesmo quando um evento intermediário nunca chega (ex.:
  // WhatsApp não manda confirmação de leitura, mas o lead responde mesmo
  // assim — aqui isso ainda incrementa delivered/read "retroativamente").
  const stagesToCount = FUNNEL_ORDER.slice(currentIndex + 1, nextIndex + 1);
  const campaignIncrements: Record<string, { increment: number }> = {};
  for (const stage of stagesToCount) {
    const field = FUNNEL_COUNTER_FIELD[stage];
    if (field) campaignIncrements[field] = { increment: 1 };
  }

  const updated = await tx.campaignTarget.update({
    where: { id: targetId },
    data: {
      status: nextStatus,
      ...(nextStatus === 'sent' && opts.sentAt ? { sentAt: opts.sentAt } : {}),
    },
  });
  if (Object.keys(campaignIncrements).length > 0) {
    await tx.campaign.update({ where: { id: target.campaignId }, data: campaignIncrements });
  }
  return updated;
}

/**
 * Efeito retroativo do opt-out (ARQUITETURA §6.7 item 4: "ao criar um OptOut,
 * TODOS os CampaignTarget pending com aquele telefone viram skipped/opted_out
 * NA MESMA transação"). Volume esperado por telefone é pequeno (poucas
 * campanhas simultâneas no máximo) — laço simples é suficiente, sem precisar
 * de `updateMany` (que não daria pra incrementar o contador certo de CADA
 * campanha de uma vez só).
 */
export async function skipPendingCampaignTargetsForPhone(
  tx: Prisma.TransactionClient,
  phoneE164: string,
  skipReason: string,
): Promise<number> {
  const pendingTargets = await tx.campaignTarget.findMany({
    where: { phoneE164, status: 'pending' },
    select: { id: true },
  });

  for (const target of pendingTargets) {
    await advanceCampaignTargetStatus(tx, target.id, 'skipped', { skipReason });
  }

  return pendingTargets.length;
}

/**
 * Kill switch (ARQUITETURA §6.6): quando uma instância desconecta/é banida,
 * TODAS as campanhas que usam SÓ ELA (nenhuma outra instância ativa) viram
 * `halted`. Compartilhado entre o webhook (`connection.update`) e o endpoint
 * manual `POST /whatsapp/instances/:id/disconnect`. Só afeta campanhas em
 * `running`/`scheduled` — `draft`/`paused`/`completed`/`cancelled`/`halted`
 * não mudam (nada a proteger: já não estão enviando, ou já estão paradas).
 */
export async function haltCampaignsSoleInstanceDisconnected(
  tx: Prisma.TransactionClient,
  instanceId: string,
  haltReason: string,
): Promise<string[]> {
  const affected = await tx.campaign.findMany({
    where: {
      status: { in: ['running', 'scheduled'] },
      instances: { every: { instanceId }, some: {} },
    },
    select: { id: true },
  });
  if (affected.length === 0) return [];

  await tx.campaign.updateMany({
    where: { id: { in: affected.map((c) => c.id) } },
    data: { status: 'halted', haltReason },
  });
  return affected.map((c) => c.id);
}
