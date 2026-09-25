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
 *
 * 🆕 Fase 4.F.5 (ARQUITETURA §6.2/§6.9) — o MESMO corpo agora também liga o
 * recuo de 30% do warmup (`regressWarmupDay`, `@inno/core`, código escrito
 * sem chamador desde a Fase 3): quando `previousStatus` era `disconnected`/
 * `banned` e `nextStatus` é `connected` — ou seja, uma QUEDA de verdade que
 * volta, nunca numa reconfirmação `connected → connected`. Essa distinção é
 * o ponto que o briefing avisa escapar: a reconciliação AUTOMÁTICA da
 * listagem (`whatsapp-instances.ts#listWhatsAppInstances`) só reconcilia
 * instância que JÁ estava `connected` no banco — ela nunca chama esta função
 * com `previousStatus` de queda, então nunca aciona o recuo mesmo rodando a
 * cada minuto. Só o webhook (evento real da Evolution) e a reconciliação
 * FORÇADA (`POST /whatsapp/instances/reconcile`, cobre qualquer status)
 * passam por uma transição de queda→conectada de verdade — uma instância
 * que oscilar entre elas várias vezes RECUA a cada vez, o que é correto
 * (cada queda real é um evento novo), não um bug de "perder 30% a cada tela
 * aberta".
 */
import { prisma, type WhatsAppInstance, type WhatsAppInstanceStatus } from '@inno/db';
import { regressWarmupDay } from '@inno/core';
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
  /** 🆕 Fase 4.F.5 — `{fromDay, toDay}` só quando esta chamada de fato regrediu o warmup (queda→conectada real); `null` em qualquer outro caso. Exposto para o chamador logar (ver `webhook.ts`) — nenhuma tela lê este retorno hoje, quem lê é `warmupDay` na próxima leitura da instância. */
  warmupRegression: { fromDay: number; toDay: number } | null;
};

const DEFAULT_DOWN_MESSAGE = 'Conexão encerrada.';

export async function applyInstanceConnectionTransition(
  input: ApplyInstanceConnectionTransitionInput,
): Promise<ApplyInstanceConnectionTransitionResult> {
  const { instanceId, instanceName, previousStatus, nextStatus, downMessage } = input;
  const wasAlreadyDown = previousStatus === 'disconnected' || previousStatus === 'banned';
  const isGoingDown = nextStatus === 'disconnected' || nextStatus === 'banned';
  // ARQUITETURA §6.2 — "se a instância ficar disconnected/banned e voltar, o
  // warmupDay recua 30%". `wasAlreadyDown` já é exatamente "estava
  // disconnected/banned antes" — só falta a metade "e voltou" (`connected`
  // agora). Ver cabeçalho do arquivo para por que isto NUNCA dispara na
  // reconciliação automática da listagem.
  const wasUpTransition = wasAlreadyDown && nextStatus === 'connected';
  const message = downMessage ?? DEFAULT_DOWN_MESSAGE;
  const now = new Date();

  const { updated, pausedCampaigns, warmupRegression } = await prisma.$transaction(async (tx) => {
    let warmupRegression: { fromDay: number; toDay: number } | null = null;

    if (wasUpTransition) {
      // `FOR UPDATE` — trava a linha ANTES de ler `warmupDay`, para o
      // `warmup-roll.job` (mesma coluna, `{increment: 1}` 1x/dia) não poder
      // completar um UPDATE concorrente entre esta leitura e a escrita
      // abaixo. É a MESMA lição de `[[bug-pace-lock-blind-set-regression]]`
      // (ler-decidir-escrever em JS sem lock perde escrita concorrente) —
      // aqui resolvida por lock pessimista (mesmo padrão de
      // `lib/services/users.ts#lockActiveAdminsAndCount`) em vez de UPDATE
      // condicional, porque a fórmula (`regressWarmupDay`, `@inno/core`) não
      // é uma comparação simples de "só avança" expressável só na cláusula
      // WHERE.
      const [row] = await tx.$queryRaw<{ warmupDay: number }[]>`
        SELECT "warmupDay" FROM "whatsapp_instances" WHERE "id" = ${instanceId} FOR UPDATE
      `;
      if (row) warmupRegression = { fromDay: row.warmupDay, toDay: regressWarmupDay(row.warmupDay) };
    }

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
        ...(warmupRegression ? { warmupDay: warmupRegression.toDay } : {}),
      },
    });

    if (!isGoingDown) return { updated, pausedCampaigns: [] as string[], warmupRegression };
    const pausedCampaigns = await haltCampaignsSoleInstanceDisconnected(tx, instanceId, message);
    return { updated, pausedCampaigns, warmupRegression };
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

  return { instance: updated, wasDownTransition, pausedCampaigns, warmupRegression };
}
