/**
 * lib/services/webhook.ts — processamento dos eventos do webhook Evolution
 * já normalizados por `@inno/messaging#parseEvolutionWebhookEvent`
 * (ARQUITETURA §4.8). A rota (`app/api/webhooks/evolution/[instanceKey]`) só
 * autentica (`instanceKey` + `apikey`, via `resolveExpectedWebhookApiKey`
 * abaixo) e chama `processEvolutionWebhookEvent` dentro de um `try/catch` que
 * NUNCA deixa o erro virar resposta não-200 — ver comentário na rota.
 */
import { prisma, type Prisma, type WhatsAppInstance } from '@inno/db';
import {
  constantTimeEqual,
  parseEvolutionWebhookEvent,
  type ConnectionUpdateEvent,
  type InboundMessageEvent,
  type MessageStatusEvent,
} from '@inno/messaging';
import { checkStatusTransition, toE164 } from '@inno/core';
import {
  advanceCampaignTargetStatus,
  haltCampaignsSoleInstanceDisconnected,
  skipPendingCampaignTargetsForPhone,
} from '@/lib/services/campaign-targets';
import { sendAlert } from '@/lib/alerts';
import { decryptEvolutionApiKey } from '@/lib/evolution-server-crypto';
import { logger } from '@/lib/logger';

type WebhookAuthInstance = Pick<
  WhatsAppInstance,
  'id' | 'evolutionServerId' | 'instanceApiKeyCiphertext' | 'instanceApiKeyIv' | 'instanceApiKeyAuthTag' | 'instanceApiKeyKeyVersion'
>;

/**
 * 🆕 Correção do incidente 2026-09-23 (webhook mudo em produção — nenhum
 * retorno da Evolution era aceito: status de entrega, resposta do lead,
 * opt-out por "SAIR"). Achado do dono no painel da Evolution: na v2 CADA
 * instância tem a sua PRÓPRIA `apikey`, distinta da chave GLOBAL do
 * `EvolutionServer` que `resolveExpectedWebhookApiKey` (Fase 4.B) validava
 * — SEM CERTEZA de qual das duas a v2.3.7 usa para assinar o webhook (não
 * confirmável sem um servidor real disponível, mesma ressalva de sempre em
 * `packages/messaging`), esta função devolve as DUAS como candidatas
 * ACEITAS em vez de escolher uma:
 *   1. A credencial PRÓPRIA da instância (`WhatsAppInstance.
 *      instanceApiKey*`, cifrada — capturada em `POST /instance/create` ou
 *      preenchida pelo comando operacional `apps/web/scripts/
 *      sync-instance-api-keys.ts` para instância já pareada). Ausente
 *      (`null`) em instância legada ou cuja captura falhou — OMITIDA da
 *      lista, nunca tratada como bloqueio.
 *   2. A chave do `EvolutionServer` (ou `EVOLUTION_API_KEY`/env, fallback
 *      enquanto `evolutionServerId` for `null` — mesma regra de
 *      `lib/evolution.ts#getEvolutionClientForInstance`, intocada).
 * Cada fonte que falhar (decifra, servidor inexistente/inativo) é OMITIDA
 * da lista SEM derrubar a outra — nunca lança. Pode devolver `[]` (nenhuma
 * fonte resolvível, erro de CONFIGURAÇÃO): `isWebhookApiKeyAccepted` trata
 * lista vazia exatamente como "nenhuma bateu" (fail-closed) — um erro de
 * configuração nunca pode relaxar a validação para "deixa passar mesmo
 * assim".
 */
export async function resolveExpectedWebhookApiKeys(instance: WebhookAuthInstance): Promise<string[]> {
  const keys: string[] = [];

  if (instance.instanceApiKeyCiphertext && instance.instanceApiKeyIv && instance.instanceApiKeyAuthTag && instance.instanceApiKeyKeyVersion != null) {
    try {
      keys.push(
        decryptEvolutionApiKey({
          apiKeyCiphertext: instance.instanceApiKeyCiphertext,
          apiKeyIv: instance.instanceApiKeyIv,
          apiKeyAuthTag: instance.instanceApiKeyAuthTag,
          apiKeyKeyVersion: instance.instanceApiKeyKeyVersion,
        }),
      );
    } catch (err) {
      logger.error('webhook evolution: falha ao decifrar a credencial PRÓPRIA da instância — omitida (a chave do servidor ainda pode aceitar)', {
        instanceId: instance.id,
        err: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  if (!instance.evolutionServerId) {
    const envKey = process.env.EVOLUTION_API_KEY ?? '';
    if (envKey.length > 0) keys.push(envKey);
    return keys;
  }

  const server = await prisma.evolutionServer.findUnique({ where: { id: instance.evolutionServerId } });
  if (server && server.isActive) {
    try {
      keys.push(decryptEvolutionApiKey(server));
    } catch (err) {
      logger.error('webhook evolution: falha ao decifrar a credencial do servidor — omitida (a credencial própria da instância ainda pode aceitar)', {
        instanceId: instance.id,
        evolutionServerId: instance.evolutionServerId,
        err: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  return keys;
}

/**
 * Decide se `receivedApiKey` (header `apikey` do webhook) bate com QUALQUER
 * uma das chaves aceitáveis desta instância (`resolveExpectedWebhookApiKeys`
 * acima) — chamada única da rota (`app/api/webhooks/evolution/
 * [instanceKey]/route.ts`), mantém a rota fina (convenção #2 de
 * `convention-api-routes-fase1`).
 *
 * Comparação em TEMPO CONSTANTE contra CADA candidata, SEM short-circuit
 * que revele qual bateu: `Array.prototype.map` sempre avalia a comparação
 * para TODAS as chaves antes do `.some` decidir — não há `||`/`return`
 * antecipado no meio do array que pare na primeira igual e vaze timing de
 * "qual fonte é a certa" para quem está medindo o servidor.
 */
export async function isWebhookApiKeyAccepted(instance: WebhookAuthInstance, receivedApiKey: string): Promise<boolean> {
  const expectedApiKeys = await resolveExpectedWebhookApiKeys(instance);
  const matches = expectedApiKeys.map((key) => constantTimeEqual(receivedApiKey, key));
  return matches.some(Boolean);
}

/** `remoteJid` da Evolution vem como `"5511987654321@s.whatsapp.net"` — a parte antes do `@` já é o telefone em dígitos (com DDI), então a MESMA normalização BR usada no scraping (`@inno/core/leads/phone.ts`) resolve para E.164 sem precisar de um parser de JID dedicado. */
function jidToE164(jid: string): string | null {
  return toE164(jid.split('@')[0]);
}

/**
 * Cria o `OptOut` de forma idempotente a partir de uma resposta automática
 * (ARQUITETURA §6.7 item 3 "Automática por resposta") — mesmo efeito
 * retroativo do opt-out manual (§6.7 item 4): pending targets viram skipped
 * NA MESMA transação.
 */
async function registerOptOutFromInbound(
  tx: Prisma.TransactionClient,
  phoneE164: string | null,
  leadId: string | null,
  trigger: string | null,
): Promise<void> {
  if (!phoneE164) {
    logger.warn('webhook evolution: opt-out detectado mas telefone não normalizável — não registrado');
    return;
  }

  const existing = await tx.optOut.findUnique({ where: { phoneE164 } });
  if (existing) return; // já opt-out — idempotente, nada a fazer.

  try {
    await tx.optOut.create({
      data: { phoneE164, source: 'reply', leadId, reason: trigger ? `Gatilho automático: "${trigger}"` : null },
    });
  } catch (err) {
    const isUniqueViolation =
      typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'P2002';
    if (!isUniqueViolation) throw err; // corrida com outro evento concorrente criando o mesmo OptOut — idempotente, ignora.
    return;
  }

  await skipPendingCampaignTargetsForPhone(tx, phoneE164, 'opted_out');
  if (leadId) {
    await tx.leadActivity.create({
      data: { leadId, type: 'opt_out', payload: { source: 'reply', trigger }, actor: 'lead' },
    });
  }
}

async function handleInboundMessage(instance: WhatsAppInstance, event: InboundMessageEvent): Promise<void> {
  const phoneE164 = jidToE164(event.fromJid);

  await prisma.$transaction(async (tx) => {
    const lead = phoneE164
      ? await tx.lead.findFirst({ where: { phoneE164 }, orderBy: { lastSeenAt: 'desc' } })
      : null;

    if (!lead) {
      // `Message.leadId` é obrigatório no schema (não há "inbound órfão") —
      // sem Lead correspondente não há onde persistir. Esperado só fora do
      // fluxo normal (Fase 3: toda mensagem outbound parte de um Lead já
      // existente, então uma resposta sempre deveria casar).
      logger.warn('webhook evolution: mensagem inbound sem Lead correspondente — não persistida', {
        instanceId: instance.id,
      });
    } else {
      // Idempotência por `providerMessageId` (ARQUITETURA §4.8) — upsert, não
      // `findFirst` + `create` separado (corrida entre reenvios concorrentes).
      await tx.message.upsert({
        where: { providerMessageId: event.providerMessageId },
        update: {},
        create: {
          leadId: lead.id,
          instanceId: instance.id,
          direction: 'inbound',
          body: event.text,
          providerMessageId: event.providerMessageId,
          status: 'delivered',
          createdAt: new Date(event.timestamp),
        },
      });

      if (lead.status === 'contacted' && checkStatusTransition(lead.status, 'responded', 'system').allowed) {
        await tx.lead.update({ where: { id: lead.id }, data: { status: 'responded' } });
      }

      // Alvo de campanha "em voo" mais recente deste lead — se existir, a
      // resposta fecha o funil dele em `responded` (ARQUITETURA §4.8 evento 3).
      // Fase 4 (campanhas) ainda não dispara nada nesta rodada, mas a ligação
      // já fica pronta para quando o dispatch worker existir.
      const activeTarget = await tx.campaignTarget.findFirst({
        where: { leadId: lead.id, status: { in: ['sent', 'delivered', 'read'] } },
        orderBy: { updatedAt: 'desc' },
      });
      if (activeTarget) {
        await advanceCampaignTargetStatus(tx, activeTarget.id, 'responded');
      }
    }

    if (event.isOptOutRequest) {
      await registerOptOutFromInbound(tx, phoneE164, lead?.id ?? null, event.optOutTrigger);
    }
  });
}

async function handleMessageStatus(instance: WhatsAppInstance, event: MessageStatusEvent): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const message = await tx.message.findUnique({ where: { providerMessageId: event.providerMessageId } });
    if (!message) {
      logger.warn('webhook evolution: messages.update para mensagem desconhecida — ignorado', { instanceId: instance.id });
      return;
    }
    // Reaplicar o mesmo status (retry da Evolution) é inofensivo — só
    // reescreve os mesmos campos, sem regressão (não há checagem de ordem
    // aqui porque `MessageStatus` de fato pode "regredir" na prática, ex.:
    // `sent` → `failed` depois de uma tentativa; `advanceCampaignTargetStatus`
    // é quem protege o FUNIL do `CampaignTarget` contra regressão).
    const now = new Date();
    await tx.message.update({
      where: { id: message.id },
      data: {
        status: event.status,
        ...(event.status === 'delivered' ? { deliveredAt: now } : {}),
        ...(event.status === 'read' ? { readAt: now } : {}),
        ...(event.status === 'failed' ? { errorCode: 'EVOLUTION_DELIVERY_FAILED' } : {}),
      },
    });

    if (message.campaignTargetId && (event.status === 'delivered' || event.status === 'read' || event.status === 'failed')) {
      await advanceCampaignTargetStatus(tx, message.campaignTargetId, event.status);
    }
  });
}

async function handleConnectionUpdate(instance: WhatsAppInstance, event: ConnectionUpdateEvent): Promise<void> {
  const nextStatus = event.banned ? 'banned' : event.state === 'connected' ? 'connected' : event.state === 'connecting' ? 'connecting' : 'disconnected';

  // Transição real (não repete a cada evento redundante que a Evolution
  // mande com o mesmo estado, ex.: tentativas de reconexão que falham
  // repetidamente) — `instance` é o estado carregado ANTES deste webhook
  // (`app/api/webhooks/evolution/[instanceKey]/route.ts`), então
  // `instance.status` aqui é o status PRÉVIO, nunca o que este evento acabou
  // de escrever.
  const wasAlreadyDown = instance.status === 'disconnected' || instance.status === 'banned';
  const isGoingDown = nextStatus === 'disconnected' || nextStatus === 'banned';

  await prisma.$transaction(async (tx) => {
    await tx.whatsAppInstance.update({
      where: { id: instance.id },
      data: {
        status: nextStatus,
        ...(nextStatus === 'connected' ? { lastConnectionAt: new Date(), isDegraded: false, consecutiveFailures: 0 } : {}),
        ...(nextStatus === 'banned' || nextStatus === 'disconnected'
          ? {
              lastErrorAt: new Date(),
              lastErrorMessage: event.banned
                ? 'Instância banida — conexão encerrada pelo provedor (statusReason 401).'
                : `Conexão encerrada (statusReason ${event.statusReason ?? 'desconhecido'}).`,
            }
          : {}),
      },
    });

    // Kill switch (ARQUITETURA §6.6): TODAS as campanhas que usam SÓ esta
    // instância viram `halted` quando ela banir/desconectar.
    if (nextStatus === 'banned' || nextStatus === 'disconnected') {
      const haltReason = event.banned
        ? 'Instância de WhatsApp banida (statusReason 401).'
        : 'Instância de WhatsApp desconectada.';
      await haltCampaignsSoleInstanceDisconnected(tx, instance.id, haltReason);
    }
  });

  // Alerta só na TRANSIÇÃO (`!wasAlreadyDown`) — sem isto, a Evolution
  // reenviando o mesmo `connection.update` (tentativas de reconexão que
  // continuam falhando) geraria um alerta por evento. `event.statusReason` é
  // sempre numérico ou `null` (nunca texto livre da Evolution, ver
  // `packages/messaging/src/webhook/types.ts`) — seguro de embutir na
  // mensagem própria abaixo.
  if (isGoingDown && !wasAlreadyDown) {
    void sendAlert({
      kind: 'instance_disconnected',
      instanceId: instance.id,
      instanceName: instance.name ?? null,
      reason: nextStatus === 'banned' ? 'banned' : 'disconnected',
      message: event.banned
        ? 'Instância banida — conexão encerrada pelo provedor (statusReason 401).'
        : `Conexão encerrada (statusReason ${event.statusReason ?? 'desconhecido'}).`,
    });
  }

  logger.info('webhook evolution: connection.update processado', { instanceId: instance.id, nextStatus, banned: event.banned });
}

/**
 * Ponto de entrada único chamado pela rota. `rawBody` é o corpo JSON cru —
 * `parseEvolutionWebhookEvent` NUNCA lança (payload ruim vira `{type:
 * 'ignored'}`), então esta função também não lança por payload malformado;
 * só pode lançar por falha real de infraestrutura (Postgres fora do ar,
 * etc.), que a rota converte em log + `200` mesmo assim.
 */
export async function processEvolutionWebhookEvent(instance: WhatsAppInstance, rawBody: unknown): Promise<void> {
  const event = parseEvolutionWebhookEvent(rawBody);

  switch (event.type) {
    case 'message_received':
      await handleInboundMessage(instance, event);
      return;
    case 'message_status':
      await handleMessageStatus(instance, event);
      return;
    case 'connection_update':
      await handleConnectionUpdate(instance, event);
      return;
    case 'qr_updated':
      // Decisão do Vega: não cacheamos o QR recebido aqui (a ARQUITETURA
      // sugere Redis com TTL 90s) — `GET /whatsapp/instances/:id/qr` busca
      // direto na Evolution quando o modal precisa de um QR novo, sem
      // precisar de um cliente Redis de cache genérico em `apps/web`. Ver a
      // nota de bug em `lib/services/whatsapp-instances.ts#getWhatsAppInstanceQr`
      // (2026-09-23) — a cadência de quando buscar é o que importa, não
      // onde o QR mora.
      return;
    case 'ignored':
      logger.info('webhook evolution: evento ignorado', { instanceId: instance.id, reason: event.reason });
      return;
    default: {
      // Exaustividade: `MessagingWebhookEvent` é união fechada — se o TS
      // reclamar aqui, um tipo de evento novo foi adicionado ao parser sem
      // atualizar este switch.
      const exhaustiveCheck: never = event;
      void exhaustiveCheck;
    }
  }
}
