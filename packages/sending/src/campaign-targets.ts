/**
 * campaign-targets.ts — transição de status de `CampaignTarget` (ARQUITETURA
 * §3.1, §4.5, §4.8) e o kill switch de instância desconectada (§6.6),
 * extraídos de `apps/web/src/lib/services/campaign-targets.ts` (ARQUITETURA
 * §6.8.0.4: "transição do alvo de campanha e contadores" NÃO pode ter uma
 * segunda implementação — dessincroniza `Campaign.sentCount|...` do dia 1).
 *
 * `apps/web/src/lib/services/campaign-targets.ts` continua existindo como
 * fina camada de compatibilidade: reexporta `advanceCampaignTargetStatus`/
 * `skipPendingCampaignTargetsForPhone` direto de `@inno/sending`, e envolve
 * `haltCampaignsSoleInstanceDisconnected` injetando `sendAlert` (`lib/alerts.ts`)
 * como `notify` — os outros 2 call sites que já existiam (webhook
 * `connection.update`, `POST /whatsapp/instances/:id/disconnect`) continuam
 * chamando com a MESMA assinatura de 3 argumentos, sem alteração.
 *
 * `notify` é PARÂMETRO explícito aqui (não importado de `@/lib/alerts`) —
 * mesma regra de portas de `ports.ts`: este pacote nunca importa o alerta de
 * nenhum dos dois apps.
 */
import type { CampaignTargetStatus, Prisma } from '@inno/db';
import type { SendingNotify } from './ports.js';

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
 * webhook pode reprocessar o mesmo evento (retry da Evolution) e o
 * `dispatch-tick.job` (Fase 4.F.4) pode reler um alvo já avançado por outro
 * processo.
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
 * `halted`. Compartilhado entre o webhook (`connection.update`), o endpoint
 * manual `POST /whatsapp/instances/:id/disconnect` (os dois via o wrapper em
 * `apps/web/src/lib/services/campaign-targets.ts`) e a falha de envio
 * (`send-one.ts`, direto). Só afeta campanhas em `running`/`scheduled` —
 * `draft`/`paused`/`completed`/`cancelled`/`halted` não mudam (nada a
 * proteger: já não estão enviando, ou já estão paradas).
 *
 * Dispara `notify({kind:'campaign_halted', ...})` sempre que
 * `affected.length > 0` — essa condição JÁ É a checagem de transição (nada
 * muda numa 2ª chamada com a mesma instância: as campanhas já estão
 * `halted`, saem do filtro `running`/`scheduled`), então não precisa de
 * dedupe aqui.
 */
export async function haltCampaignsSoleInstanceDisconnected(
  tx: Prisma.TransactionClient,
  instanceId: string,
  haltReason: string,
  notify: SendingNotify,
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

  const campaignIds = affected.map((c) => c.id);
  // Alerta com um texto PRÓPRIO e genérico, nunca `haltReason` cru — em um
  // dos call sites (falha de envio) `haltReason` incorpora a mensagem de
  // erro da Evolution, que pode ecoar dado da requisição (ver regra 4 em
  // `lib/alerts.ts`). O `haltReason` detalhado continua gravado normalmente
  // em `Campaign.haltReason` (Postgres, não um webhook externo).
  void notify({ kind: 'campaign_halted', campaignIds, instanceId });
  return campaignIds;
}
