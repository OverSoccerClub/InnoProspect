/**
 * lib/services/instance-connection.ts — a transição de conexão de UMA
 * `WhatsAppInstance` que precisa da TRANSAÇÃO COMPLETA: grava o novo
 * `status` (+ `statusCheckedAt`, sempre — ver comentário no schema) e,
 * quando é uma QUEDA (`disconnected`/`banned`), o kill switch
 * (`haltCampaignsSoleInstanceDisconnected`) NA MESMA transação, e dispara o
 * alerta `instance_disconnected` fora dela, só na TRANSIÇÃO real (não a cada
 * evento redundante).
 *
 * 🆕 Extraído do webhook `connection.update` (reconciliação de status,
 * 2026-09-24 — incidente do dono: "mesmo desconectado, o sistema ainda
 * mostra como conectado"). Antes desta rodada só `webhook.ts#
 * handleConnectionUpdate` fazia essa transação completa; o comentário de
 * `whatsapp-instances.ts#getWhatsAppInstanceStatus` já avisava que replicar
 * este efeito fora dali "arriscaria desincronizar banco e campanhas" — o
 * risco real nunca foi "ler de novo", foi ter uma SEGUNDA implementação
 * ligeiramente diferente da primeira. Esta função é o único corpo — chamada
 * por `webhook.ts` (o evento chegou) e por `whatsapp-instances.ts` (a
 * reconciliação foi nós que perguntamos).
 */
import { prisma, type WhatsAppInstance, type WhatsAppInstanceStatus } from '@inno/db';
import { haltCampaignsSoleInstanceDisconnected } from '@/lib/services/campaign-targets';
import { sendAlert } from '@/lib/alerts';

/** Só os 4 estados que uma transição de conexão de fato assume — `qr_pending` é gerenciado pelo fluxo de QR (`getWhatsAppInstanceQr`/`connectWhatsAppInstance`), nunca por esta função. */
export type InstanceConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'banned';

export type ApplyInstanceConnectionTransitionInput = {
  instanceId: string;
  instanceName: string | null;
  /** `status` da instância ANTES desta transição — decide se o alerta dispara (só na mudança real, nunca em evento repetido). */
  previousStatus: WhatsAppInstanceStatus;
  nextStatus: InstanceConnectionStatus;
  /**
   * Mensagem PRÓPRIA (nunca texto cru de upstream — regra 4 de
   * `lib/alerts.ts`) usada em `lastErrorMessage`/no `haltReason`/no alerta
   * quando `nextStatus` é uma queda. Ignorada quando não é. Default genérico
   * se omitida.
   */
  downMessage?: string;
};

export type ApplyInstanceConnectionTransitionResult = {
  instance: WhatsAppInstance;
  /** `true` só quando esta chamada É a transição real para uma queda (não repete a cada evento/reconciliação redundante) — é o mesmo gate que decide o alerta. */
  wasDownTransition: boolean;
  /** Ids das campanhas pausadas pelo kill switch nesta chamada — `[]` quando não houve queda ou nenhuma campanha dependia só desta instância. */
  pausedCampaigns: string[];
};

const DEFAULT_DOWN_MESSAGE = 'Conexão encerrada.';

export async function applyInstanceConnectionTransition(
  input: ApplyInstanceConnectionTransitionInput,
): Promise<ApplyInstanceConnectionTransitionResult> {
  const { instanceId, instanceName, previousStatus, nextStatus, downMessage } = input;
  const wasAlreadyDown = previousStatus === 'disconnected' || previousStatus === 'banned';
  const isGoingDown = nextStatus === 'disconnected' || nextStatus === 'banned';
  const message = downMessage ?? DEFAULT_DOWN_MESSAGE;
  const now = new Date();

  const { updated, pausedCampaigns } = await prisma.$transaction(async (tx) => {
    const updated = await tx.whatsAppInstance.update({
      where: { id: instanceId },
      data: {
        status: nextStatus,
        // Toda chamada aqui É uma confirmação contra a Evolution (webhook: o
        // evento chegou; reconciliação: nós perguntamos e ela respondeu) —
        // ver o comentário completo em `schema.prisma#statusCheckedAt`.
        statusCheckedAt: now,
        ...(nextStatus === 'connected' ? { lastConnectionAt: now, isDegraded: false, consecutiveFailures: 0 } : {}),
        ...(isGoingDown ? { lastErrorAt: now, lastErrorMessage: message } : {}),
      },
    });

    if (!isGoingDown) return { updated, pausedCampaigns: [] as string[] };
    const pausedCampaigns = await haltCampaignsSoleInstanceDisconnected(tx, instanceId, message);
    return { updated, pausedCampaigns };
  });

  const wasDownTransition = isGoingDown && !wasAlreadyDown;
  if (wasDownTransition) {
    void sendAlert({
      kind: 'instance_disconnected',
      instanceId,
      instanceName: instanceName ?? null,
      reason: nextStatus === 'banned' ? 'banned' : 'disconnected',
      message,
    });
  }

  return { instance: updated, wasDownTransition, pausedCampaigns };
}
