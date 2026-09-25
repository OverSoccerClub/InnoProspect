/**
 * lib/services/whatsapp-instances.ts — `WhatsAppInstance` (ARQUITETURA
 * §4.6). Combina o estado em Postgres (fonte da verdade) com chamadas ao
 * `EvolutionClient` (`@inno/messaging`) — nunca o contrário: se a Evolution
 * cair, a API ainda responde com o último estado conhecido do banco (só as
 * ações que precisam mesmo de rede, como `connect`/QR, propagam `502
 * UPSTREAM_ERROR`).
 */
import { MessagingError, type ConnectionState, type ConnectResult } from '@inno/messaging';
import { Prisma, prisma, type WhatsAppInstance } from '@inno/db';
import { deriveInstanceHealth, effectiveDailyLimit, isWarmupDayWarm, localDateKey } from '@inno/core';
import type {
  ConnectInstanceResponse,
  CreateWhatsAppInstanceBody,
  CreateWhatsAppInstanceResponse,
  DisconnectInstanceResponse,
  GetInstanceStatusResponse,
  GetQrCodeResponse,
  ListWhatsAppInstancesResponse,
  ReconcileWhatsAppInstancesResponse,
  WhatsAppInstanceDetail,
  WhatsAppInstanceItem,
} from '@inno/contracts';
import { conflict, notFound, upstreamError } from '@/lib/api-handler';
import {
  buildWebhookUrl,
  generateEvolutionInstanceName,
  generateInstanceKey,
  getEvolutionClientForInstance,
  getEvolutionClientForServer,
  requireActiveEvolutionServer,
} from '@/lib/evolution';
import { encryptEvolutionApiKey, toPrismaBytes } from '@inno/sending';
import { haltCampaignsSoleInstanceDisconnected } from '@/lib/services/campaign-targets';
import { applyInstanceConnectionTransition, type InstanceConnectionStatus } from '@/lib/services/instance-connection';
import { sendAlert } from '@/lib/alerts';
import { logger } from '@/lib/logger';

/**
 * Chave do dia corrente (00:00 UTC do dia civil em `APP_TIMEZONE`) — mesma
 * granularidade de `InstanceDailyStat.date` (`@db.Date`). 🆕 Fase 4.F.2:
 * religado para `localDateKey` de `@inno/core` — era uma cópia manual do
 * mesmo cálculo, duplicada também em `campaigns.ts` e `messages.ts`.
 * Comportamento idêntico ao de antes.
 */
function todayDateKey(): Date {
  const tz = process.env.APP_TIMEZONE || 'America/Sao_Paulo';
  return localDateKey(new Date(), tz);
}

async function countActiveCampaigns(instanceId: string): Promise<number> {
  return prisma.campaignInstance.count({
    where: { instanceId, campaign: { status: { in: ['scheduled', 'running', 'paused', 'halted'] } } },
  });
}

async function toInstanceItem(
  instance: WhatsAppInstance,
  todayStat: { sentCount: number; failedCount: number; respondedCount: number } | null,
  activeCampaigns: number,
): Promise<WhatsAppInstanceItem> {
  const dailyLimit = effectiveDailyLimit(instance.warmupDay, instance.dailyLimitOverride);
  const sent = todayStat?.sentCount ?? 0;

  return {
    id: instance.id,
    name: instance.name,
    phoneNumber: instance.phoneNumber,
    status: instance.status,
    health: deriveInstanceHealth({ status: instance.status, isDegraded: instance.isDegraded, warmupDay: instance.warmupDay }),
    warmup: { day: instance.warmupDay, dailyLimit, isWarm: isWarmupDayWarm(instance.warmupDay) },
    today: {
      sent,
      failed: todayStat?.failedCount ?? 0,
      responded: todayStat?.respondedCount ?? 0,
      remaining: Math.max(0, dailyLimit - sent),
    },
    lastConnectionAt: instance.lastConnectionAt?.toISOString() ?? null,
    lastErrorAt: instance.lastErrorAt?.toISOString() ?? null,
    lastError: instance.lastErrorMessage,
    activeCampaigns,
    statusCheckedAt: instance.statusCheckedAt?.toISOString() ?? null,
  };
}

async function buildInstanceListResponse(instances: WhatsAppInstance[]): Promise<ListWhatsAppInstancesResponse> {
  if (instances.length === 0) return { data: [] };

  const today = todayDateKey();
  const [todayStats, campaignCounts] = await Promise.all([
    prisma.instanceDailyStat.findMany({ where: { instanceId: { in: instances.map((i) => i.id) }, date: today } }),
    Promise.all(instances.map((i) => countActiveCampaigns(i.id))),
  ]);
  const statsByInstance = new Map(todayStats.map((s) => [s.instanceId, s]));

  const data = await Promise.all(
    instances.map((instance, i) => toInstanceItem(instance, statsByInstance.get(instance.id) ?? null, campaignCounts[i] ?? 0)),
  );
  return { data };
}

export async function listWhatsAppInstances(): Promise<ListWhatsAppInstancesResponse> {
  const instances = await prisma.whatsAppInstance.findMany({ orderBy: { createdAt: 'asc' } });
  // A contagem de não-confirmadas é DESCARTADA aqui de propósito: o `GET` da
  // lista não pediu confirmação a ninguém, ele só aproveitou a passagem. Quem
  // precisa saber que não deu para confirmar é a tela, e ela descobre pelo
  // `statusCheckedAt` de cada instância (que não avançou). Na reconciliação
  // FORÇADA é diferente — ali o operador pediu, e a resposta precisa dizer.
  await reconcileInstancesInPlace(instances, isStaleConnectedInstance);
  return buildInstanceListResponse(instances);
}

/**
 * `POST /whatsapp/instances/reconcile` — reconciliação FORÇADA (sob pedido
 * explícito do operador): ignora o limite de frescor E cobre TODA
 * instância, não só `connected` (diferente de `listWhatsAppInstances`
 * acima). Mesmo shape de resposta — a tela só substitui os dados que já
 * tem.
 */
export async function reconcileAllWhatsAppInstances(): Promise<ReconcileWhatsAppInstancesResponse> {
  const instances = await prisma.whatsAppInstance.findMany({ orderBy: { createdAt: 'asc' } });
  const unconfirmed = await reconcileInstancesInPlace(instances, () => true);
  if (unconfirmed > 0) {
    logger.warn('whatsapp_instance.reconciliacao_forcada_incompleta', { unconfirmed, total: instances.length });
  }
  return { ...(await buildInstanceListResponse(instances)), unconfirmed };
}

/**
 * Traduz `MessagingError` (`@inno/messaging`) para o envelope de erro da API
 * — a Evolution é um upstream, nunca `500` nosso. Também dispara o alerta
 * `evolution_api_error` (fire-and-forget, `sendAlert` nunca lança) — antes
 * desta rodada essas falhas só apareciam no log, silenciosas fora dele. Só
 * `code`/`action` vão pro alerta, nunca `err.message`/`err.cause` (podem
 * ecoar dado da requisição — ver regra 4 em `lib/alerts.ts`); a
 * deduplicação por `code` (dentro de `sendAlert`) evita 1 alerta por
 * requisição enquanto a Evolution estiver fora do ar.
 */
function rethrowAsUpstream(err: unknown, action: string): never {
  if (err instanceof MessagingError) {
    logger.error(`falha ao ${action} na Evolution API`, { code: err.code, status: err.status });
    void sendAlert({ kind: 'evolution_api_error', action, code: err.code });
    upstreamError(`Não foi possível ${action} agora (Evolution API indisponível ou com erro). Tente novamente em instantes.`);
  }
  throw err;
}

// ─────────────────────────────────────────────────────────────────────────
// Reconciliação de status (2026-09-24) — incidente do dono: "mesmo o número
// estando desconectado o sistema ainda fica mostrando como se ele estivesse
// conectado". Causa raiz: o ÚNICO caminho que tirava uma instância de
// `connected` era o webhook `connection.update` — um evento perdido
// (restart nosso, blip de rede, Evolution reiniciando) deixava o banco
// mentindo PARA SEMPRE, porque nenhuma LEITURA jamais voltava a perguntar.
//
// Por que isto vive AQUI (na leitura, em `apps/web`) e não num job do
// `apps/worker` — decisão deliberada, não descuido: reconciliar STATUS lendo
// `GET /whatsapp/instances` é uma pergunta HTTP, e o motor (`dispatch-tick.job`,
// Fase 4.F.4) nunca faz essa pergunta — ele confere a instância direto do
// Postgres antes de enviar (`status`/`isDegraded`/cota/gate, ARQUITETURA
// §6.8.3 passo 2.2), sem precisar perguntar à Evolution "você está viva?".
// 🆕 Fase 4.F.4: a RESOLUÇÃO do `EvolutionClient` por instância (achar o
// servidor, decifrar, montar o cliente) virou `@inno/sending` (`evolution-
// resolver.ts`) exatamente porque o tick também precisa dela para ENVIAR —
// mas a reconciliação de status em si (este arquivo) continua só aqui.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Limite de frescor: uma instância `connected` só é reconciliada de novo se
 * `statusCheckedAt` for `null` ou mais velho que isto. Evita perguntar à
 * Evolution a CADA `GET /whatsapp/instances` (a tela pode pollar) — 60s é
 * curto o suficiente para o operador nunca ficar muito tempo olhando um
 * "conectado" mentiroso, e longo o suficiente para não multiplicar
 * requisições à Evolution por poll.
 */
const STATUS_FRESHNESS_MS = 60_000;

/**
 * Timeout DURO da consulta de reconciliação — independente do timeout
 * interno do `EvolutionClient` (`packages/messaging/src/client/http.ts`,
 * 15s por tentativa) E da sua política de retry de transporte
 * (`getConnectionState` é retryable por padrão: até 2 tentativas extras em
 * `TRANSIENT_ERROR`/`TIMEOUT`, cada uma com backoff — sem este teto PRÓPRIO,
 * UMA instância lenta/fora do ar poderia levar quase 1 minuto, e mesmo em
 * paralelo (`Promise.allSettled`) isso deixaria a página inteira pendurada
 * esperando a mais lenta). Não cancela a chamada de rede de verdade (o
 * cliente não aceita um `signal` externo hoje) — só para de ESPERAR por ela;
 * como `getConnectionState` é uma leitura pura, uma resposta tardia e sem
 * dono depois do timeout é inofensiva (é só descartada).
 */
const RECONCILE_TIMEOUT_MS = 5_000;

function withHardTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`reconciliação: sem resposta da Evolution em ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function isStaleConnectedInstance(instance: WhatsAppInstance): boolean {
  if (instance.status !== 'connected') return false;
  if (!instance.statusCheckedAt) return true;
  return Date.now() - instance.statusCheckedAt.getTime() >= STATUS_FRESHNESS_MS;
}

/**
 * Mensagem PRÓPRIA (nunca texto cru de upstream — regra 4 de
 * `lib/alerts.ts`) usada quando a RECONCILIAÇÃO (não o webhook) é quem
 * descobre a queda — deixa claro na auditoria (`lastErrorMessage`,
 * `Campaign.haltReason`, alerta) de onde veio, já que não existe
 * `statusReason` aqui (não é um evento da Evolution, é uma pergunta nossa).
 */
const RECONCILE_DOWN_MESSAGE =
  'Reconciliação automática: a Evolution API confirmou a instância desconectada, mas o banco ainda registrava como conectada (provável evento connection.update perdido).';

/**
 * Reconcilia UMA instância contra a Evolution (`getConnectionState`) e
 * decide o que é SEGURO corrigir — o estado bruto da Evolution só distingue
 * 3 valores (`connected`/`connecting`/`disconnected`), enquanto o nosso
 * `status` tem mais nuance (`qr_pending`/`banned`). Regra, deliberada:
 *
 *   1. Evolution diz `connected` → SEMPRE seguro subir para `connected`,
 *      venha o banco de onde vier (`qr_pending`, `disconnected`, etc.) — é a
 *      MESMA direção segura que `getWhatsAppInstanceQr`/
 *      `getWhatsAppInstanceStatus` já usam.
 *   2. Banco achava `connected` e Evolution diz OUTRA coisa → só essa
 *      combinação é a MENTIRA perigosa que este incidente é sobre. Dentro
 *      dela:
 *      - Evolution diz `disconnected` (explícito) → QUEDA confirmada: status
 *        `disconnected` + kill switch + alerta (a correção do incidente).
 *      - Evolution diz `connecting` → **decisão deliberada, NÃO tratar como
 *        queda**: `connecting` é a Evolution tentando reconectar SOZINHA (ex.:
 *        blip de rede que ela mesma recupera); dar kill switch em campanhas
 *        por isso seria falso positivo. Ainda assim, deixar o banco em
 *        `connected` seria continuar mentindo — a saída é mostrar o estado
 *        intermediário de verdade (`status: 'connecting'`), SEM kill switch
 *        e SEM alerta (`applyInstanceConnectionTransition` só aciona os dois
 *        para `disconnected`/`banned`). Um restart nesse meio-tempo pode
 *        piscar connected→connecting→connected na tela — isso é FIEL ao que
 *        está acontecendo de verdade, não um bug.
 *   3. Banco JÁ NÃO achava `connected` (qualquer nuance — `qr_pending`,
 *      `connecting`, `banned`, `disconnected`) e Evolution confirma "não
 *      conectada" — não há mentira de "conectado" para corrigir aqui, e
 *      sobrescrever o `status` arriscaria efeitos colaterais que não são
 *      desta função (ex.: `qr_pending` tem um modal de QR aberto contando
 *      com aquele status — ver o bug de 2026-09-23 em `getWhatsAppInstanceQr`).
 *      Só confirma `statusCheckedAt` — a Evolution FOI perguntada, só não
 *      havia nada seguro a corrigir.
 *
 * Nunca lança — falha de rede/timeout é logada e devolve a instância
 * INTOCADA (nem `statusCheckedAt` avança: é isso que faz a tela poder dizer
 * "não consigo confirmar desde X" quando a Evolution está fora do ar, em vez
 * de fingir que confirmou).
 *
 * `confirmed` distingue as duas coisas que "não lançar" junta: `true` = a
 * Evolution foi perguntada E a confirmação foi persistida (`statusCheckedAt`
 * avançou, tenha havido correção de status ou não); `false` = não deu para
 * confirmar. Quem chama o `GET` da lista ignora essa diferença (a lista
 * responde de qualquer forma), mas a reconciliação FORÇADA precisa dela: ali
 * "não deu erro" e "eu confirmei" não podem ser a mesma resposta, senão o
 * operador clica em "Verificar agora" com a Evolution fora do ar e a tela
 * dá um `200` silencioso.
 */
type ReconcileOneResult = { instance: WhatsAppInstance; confirmed: boolean };

async function reconcileOneInstance(instance: WhatsAppInstance): Promise<ReconcileOneResult> {
  let raw: ConnectionState;
  try {
    const client = await getEvolutionClientForInstance(instance);
    raw = await withHardTimeout(client.getConnectionState(instance.evolutionInstanceName), RECONCILE_TIMEOUT_MS);
  } catch (err) {
    logger.warn('whatsapp_instance.reconciliacao_falhou — mantendo o último estado conhecido do banco', {
      instanceId: instance.id,
      err: err instanceof Error ? err : new Error(String(err)),
    });
    return { instance, confirmed: false };
  }

  try {
    const wasConnectedInDb = instance.status === 'connected';
    const isConnectedNow = raw === 'connected';

    if (!isConnectedNow && !wasConnectedInDb) {
      // Regra 3 acima — nada de seguro a corrigir, só confirma o timestamp.
      const touched = await prisma.whatsAppInstance.update({ where: { id: instance.id }, data: { statusCheckedAt: new Date() } });
      return { instance: touched, confirmed: true };
    }

    const nextStatus: InstanceConnectionStatus = isConnectedNow ? 'connected' : raw === 'connecting' ? 'connecting' : 'disconnected';
    const { instance: updated, pausedCampaigns } = await applyInstanceConnectionTransition({
      instanceId: instance.id,
      instanceName: instance.name,
      previousStatus: instance.status,
      nextStatus,
      downMessage: nextStatus === 'disconnected' ? RECONCILE_DOWN_MESSAGE : undefined,
    });

    if (pausedCampaigns.length > 0) {
      logger.warn('whatsapp_instance.reconciliacao_haltou_campanhas', { instanceId: instance.id, pausedCampaigns });
    }
    return { instance: updated, confirmed: true };
  } catch (err) {
    // Erro de INFRAESTRUTURA (Postgres) escrevendo a reconciliação — diferente
    // do catch acima (falha ao CONSULTAR a Evolution). Mesma postura: nunca
    // lança, a listagem responde com o que já tinha antes desta tentativa.
    logger.error('whatsapp_instance.reconciliacao_falhou_ao_gravar', {
      instanceId: instance.id,
      err: err instanceof Error ? err : new Error(String(err)),
    });
    // A Evolution respondeu, mas a confirmação não foi persistida — logo
    // `statusCheckedAt` continua onde estava, e dizer `confirmed: true` aqui
    // faria a tela afirmar um frescor que o banco não tem.
    return { instance, confirmed: false };
  }
}

/**
 * Reconcilia, EM PARALELO (`Promise.allSettled` — nunca em série), toda
 * instância de `instances` que `shouldReconcile` selecionar, e substitui no
 * próprio array (mutação in-place, por índice) o resultado de cada uma —
 * quem chamou continua com a MESMA referência, agora com dados frescos onde
 * a reconciliação teve algo a dizer. `reconcileOneInstance` nunca lança (ver
 * comentário lá), então `Promise.allSettled` só existe como defesa de 2ª
 * linha; um `rejected` aqui manteria a instância original intocada.
 *
 * Devolve quantas das CANDIDATAS não puderam ser confirmadas (Evolution fora
 * do ar/timeout, ou falha ao gravar). Instância que nem era candidata não
 * conta: ninguém tentou confirmá-la, então não há nada que tenha falhado.
 */
async function reconcileInstancesInPlace(
  instances: WhatsAppInstance[],
  shouldReconcile: (instance: WhatsAppInstance) => boolean,
): Promise<number> {
  const candidates = instances.map((instance, index) => ({ instance, index })).filter(({ instance }) => shouldReconcile(instance));
  if (candidates.length === 0) return 0;

  const results = await Promise.allSettled(candidates.map(({ instance }) => reconcileOneInstance(instance)));
  let unconfirmed = 0;
  results.forEach((result, i) => {
    if (result.status !== 'fulfilled') {
      // Defesa de 2ª linha (ver acima): `reconcileOneInstance` não deveria
      // rejeitar. Se rejeitou, nada foi confirmado sobre esta instância.
      unconfirmed += 1;
      return;
    }
    instances[candidates[i]!.index] = result.value.instance;
    if (!result.value.confirmed) unconfirmed += 1;
  });
  return unconfirmed;
}

/**
 * 🆕 Correção do incidente 2026-09-23 — captura a credencial de webhook
 * PRÓPRIA da instância (achado do dono: a Evolution v2 dá uma `apikey` por
 * instância, distinta da global do servidor) a partir da resposta de
 * `POST /instance/create` (`CreateInstanceResult.apiKey`, parsing defensivo
 * em `@inno/messaging`) e cifra ANTES de qualquer chamada Prisma — mesma
 * regra de `evolution-servers.ts` (nunca persistir/logar texto puro).
 * `apiKey: null` (a Evolution não devolveu nenhum campo reconhecido) NÃO é
 * erro — devolve `{}` (nenhuma coluna preenchida) e a instância nasce
 * normalmente, aceitando o webhook só pela chave do servidor/env (mesmo
 * comportamento de antes desta correção).
 */
function encryptedInstanceApiKeyColumns(apiKey: string | null): Partial<Prisma.WhatsAppInstanceUncheckedCreateInput> {
  if (!apiKey) return {};
  const encrypted = encryptEvolutionApiKey(apiKey, process.env);
  return {
    instanceApiKeyCiphertext: toPrismaBytes(encrypted.ciphertext),
    instanceApiKeyIv: toPrismaBytes(encrypted.iv),
    instanceApiKeyAuthTag: toPrismaBytes(encrypted.authTag),
    instanceApiKeyKeyVersion: encrypted.keyVersion,
  };
}

export async function createWhatsAppInstance(
  body: CreateWhatsAppInstanceBody,
  createdById: string,
): Promise<CreateWhatsAppInstanceResponse> {
  // 🆕 Fase 4.B — `evolutionServerId` é OBRIGATÓRIO na camada de aplicação
  // para toda instância NOVA (mesmo com a coluna ainda nullable no banco,
  // durante a janela de bootstrap — ver comentário completo em
  // `packages/db/prisma/schema.prisma#WhatsAppInstance.evolutionServerId`).
  // `requireActiveEvolutionServer` devolve 404/409 (erro do OPERADOR: id
  // inexistente ou servidor desativado), nunca deixa criar contra um
  // servidor que não existe/está fora de uso.
  const server = await requireActiveEvolutionServer(body.evolutionServerId);
  const evolutionInstanceName = generateEvolutionInstanceName(body.name);
  const instanceKey = generateInstanceKey();
  const client = getEvolutionClientForServer(server);

  let created: WhatsAppInstance;
  let capturedApiKey: string | null = null;
  try {
    const createResult = await client.createInstance({ instanceName: evolutionInstanceName });
    capturedApiKey = createResult.apiKey;
    await client.setWebhook(evolutionInstanceName, { url: buildWebhookUrl(instanceKey) });
  } catch (err) {
    rethrowAsUpstream(err, 'criar a instância');
  }

  if (!capturedApiKey) {
    // Não é erro (a instância já foi criada do lado da Evolution nesta
    // chamada) — só um sinal de que esta instância vai depender da chave do
    // SERVIDOR/env para o webhook (fallback pré-existente, ver
    // `lib/services/webhook.ts#resolveExpectedWebhookApiKeys`). Registrado
    // para não ficar invisível se a Evolution mudar o shape da resposta.
    logger.warn('whatsapp_instance.sem_apikey_propria_na_criacao', { evolutionInstanceName });
  }

  try {
    created = await prisma.whatsAppInstance.create({
      data: {
        name: body.name,
        evolutionInstanceName,
        instanceKey,
        evolutionServerId: server.id,
        status: 'qr_pending',
        warmupStartedAt: body.startWarmup ? new Date() : null,
        createdById,
        ...encryptedInstanceApiKeyColumns(capturedApiKey),
      },
    });
  } catch (err) {
    // Instância já foi criada do lado da Evolution mas o INSERT no nosso
    // banco falhou (ex.: corrida rara em `evolutionInstanceName`/`instanceKey`,
    // ambos gerados aleatoriamente — praticamente impossível, mas
    // best-effort de limpeza para não deixar lixo órfão na Evolution).
    try {
      await client.deleteInstance(evolutionInstanceName);
    } catch (cleanupErr) {
      logger.error('falha ao limpar instância órfã na Evolution após erro de banco', {
        evolutionInstanceName,
        err: cleanupErr instanceof Error ? cleanupErr : new Error(String(cleanupErr)),
      });
    }
    throw err;
  }

  return {
    id: created.id,
    name: created.name,
    status: 'qr_pending',
    evolutionInstanceName: created.evolutionInstanceName,
  };
}

async function findInstanceOrNotFound(id: string): Promise<WhatsAppInstance> {
  const instance = await prisma.whatsAppInstance.findUnique({ where: { id } });
  if (!instance) notFound('Instância de WhatsApp não encontrada.');
  return instance;
}

export async function getWhatsAppInstanceDetail(id: string): Promise<WhatsAppInstanceDetail> {
  const instance = await findInstanceOrNotFound(id);
  const [todayStat, activeCampaigns, history] = await Promise.all([
    prisma.instanceDailyStat.findUnique({ where: { instanceId_date: { instanceId: id, date: todayDateKey() } } }),
    countActiveCampaigns(id),
    prisma.instanceDailyStat.findMany({ where: { instanceId: id }, orderBy: { date: 'desc' }, take: 30 }),
  ]);

  const item = await toInstanceItem(instance, todayStat, activeCampaigns);
  return {
    ...item,
    history: history.map((h) => ({
      date: h.date.toISOString().slice(0, 10),
      sentCount: h.sentCount,
      failedCount: h.failedCount,
      respondedCount: h.respondedCount,
      blockedCount: h.blockedCount,
    })),
  };
}

/**
 * `GET /whatsapp/instances/:id/qr` — chama `EvolutionClient.connect` AO VIVO
 * a cada requisição (`GET /instance/connect/:name`), que **(re)inicia o
 * pareamento e emite um QR novo a cada chamada**. Isto é intencional só na
 * cadência certa: buscar UMA vez ao abrir o modal, e de novo quando o QR
 * atual vence (`expiresInSeconds`) ou sob pedido explícito do operador.
 *
 * ⚠️ BUG REAL DE PRODUÇÃO (2026-09-23), causa raiz: a decisão anterior deste
 * comentário era "buscar direto em vez de cachear o QR do webhook — é
 * funcionalmente equivalente". NÃO é: a tela fazia poll de 2 em 2 SEGUNDOS
 * neste endpoint (pensando em atualizar o estado de conexão), e cada poll
 * invalidava o QR anterior antes que alguém conseguisse abrir o WhatsApp e
 * escanear. Ninguém conseguia conectar. A correção separou as duas
 * responsabilidades: `getWhatsAppInstanceStatus` (abaixo) é a rota de
 * leitura pura para sondar com frequência; ESTA rota só é chamada pelo
 * controlador de QR do modal (`apps/web/src/lib/whatsapp/
 * qr-connection-controller.ts`) na cadência acima. Não adicionar um poll de
 * intervalo curto e fixo contra este endpoint de novo — é exatamente como o
 * bug nasceu.
 */
export async function getWhatsAppInstanceQr(id: string): Promise<GetQrCodeResponse> {
  const instance = await findInstanceOrNotFound(id);

  let result: ConnectResult;
  try {
    const client = await getEvolutionClientForInstance(instance);
    result = await client.connect(instance.evolutionInstanceName);
  } catch (err) {
    rethrowAsUpstream(err, 'obter o QR code');
  }

  if (result.state === 'connected') {
    await prisma.whatsAppInstance.update({
      where: { id },
      data: { status: 'connected', lastConnectionAt: new Date() },
    });
    return { status: 'connected', qrCodeBase64: null };
  }

  if (!result.qr) {
    upstreamError('Evolution API não devolveu QR code nem confirmou conexão. Tente novamente em instantes.');
  }

  await prisma.whatsAppInstance.update({ where: { id }, data: { status: 'qr_pending' } });
  return {
    status: 'qr_pending',
    qrCodeBase64: result.qr.base64,
    expiresInSeconds: 60,
    ...(result.qr.pairingCode ? { pairingCode: result.qr.pairingCode } : {}),
  };
}

/**
 * `GET /whatsapp/instances/:id/status` — leitura PURA do estado de conexão
 * na Evolution (`EvolutionClient.getConnectionState`, `GET
 * /instance/connectionState/:name`): nunca reinicia o pareamento nem emite
 * QR novo, por isso É SEGURO sondar com frequência (o modal de QR sonda de
 * 2 em 2s enquanto está aberto, só para saber a hora de fechar). Ver a nota
 * de bug em `getWhatsAppInstanceQr` acima para o porquê desta rota existir
 * separada daquela.
 *
 * Só grava no banco na transição PARA `connected` (mesmo gatilho que
 * `getWhatsAppInstanceQr` já tinha) — qualquer outra leitura (`connecting`/
 * `disconnected`) devolve o `status` que já estava no banco, sem
 * sobrescrever. Motivo: o estado bruto da Evolution só distingue 3 valores
 * (`connected`/`connecting`/`disconnected`), enquanto o nosso `status` tem
 * mais nuance (`qr_pending` vs `connecting` vs `banned`); e o `disconnected`
 * observado aqui não deve dar kill switch nas campanhas por conta própria —
 * isso é responsabilidade exclusiva do webhook `connection.update`
 * (`lib/services/webhook.ts#handleConnectionUpdate`), que faz a transação
 * completa junto com `haltCampaignsSoleInstanceDisconnected`. Replicar esse
 * efeito aqui, fora dessa transação, arriscaria desincronizar banco e
 * campanhas.
 */
export async function getWhatsAppInstanceStatus(id: string): Promise<GetInstanceStatusResponse> {
  const instance = await findInstanceOrNotFound(id);

  let state: ConnectionState;
  try {
    const client = await getEvolutionClientForInstance(instance);
    state = await client.getConnectionState(instance.evolutionInstanceName);
  } catch (err) {
    rethrowAsUpstream(err, 'consultar o estado da conexão');
  }

  if (state === 'connected') {
    if (instance.status !== 'connected') {
      await prisma.whatsAppInstance.update({
        where: { id },
        data: { status: 'connected', lastConnectionAt: new Date() },
      });
    }
    return { status: 'connected' };
  }

  return { status: instance.status };
}

/** `POST /whatsapp/instances/:id/connect` — resposta é sempre `status:'qr_pending'` por CONTRATO (`connectInstanceResponseSchema`, `@inno/contracts`): é um "iniciei o pareamento", o estado real é confirmado via `GET .../qr` ou `GET .../:id` (polling). */
export async function connectWhatsAppInstance(id: string): Promise<ConnectInstanceResponse> {
  const instance = await findInstanceOrNotFound(id);

  try {
    const client = await getEvolutionClientForInstance(instance);
    await client.connect(instance.evolutionInstanceName);
  } catch (err) {
    rethrowAsUpstream(err, 'conectar a instância');
  }

  await prisma.whatsAppInstance.update({ where: { id }, data: { status: 'qr_pending' } });
  return { ok: true, status: 'qr_pending' };
}

/** `POST /whatsapp/instances/:id/disconnect` — logout (mantém a instância), kill switch nas campanhas que dependiam SÓ dela (ARQUITETURA §6.6). */
export async function disconnectWhatsAppInstance(id: string): Promise<DisconnectInstanceResponse> {
  const instance = await findInstanceOrNotFound(id);

  try {
    const client = await getEvolutionClientForInstance(instance);
    await client.disconnect(instance.evolutionInstanceName);
  } catch (err) {
    rethrowAsUpstream(err, 'desconectar a instância');
  }

  const pausedCampaigns = await prisma.$transaction(async (tx) => {
    await tx.whatsAppInstance.update({
      where: { id },
      data: { status: 'disconnected', lastErrorAt: new Date(), lastErrorMessage: 'Desconectado manualmente pelo operador.' },
    });
    return haltCampaignsSoleInstanceDisconnected(tx, id, 'Instância de WhatsApp desconectada manualmente.');
  });

  return { ok: true, status: 'disconnected', pausedCampaigns };
}

/** `DELETE /whatsapp/instances/:id` — `409 INSTANCE_IN_USE` se qualquer campanha (ativa ou não) referenciar a instância (schema reforça com `onDelete: Restrict`, mesmo padrão de `deleteTemplate`). */
export async function deleteWhatsAppInstance(id: string): Promise<void> {
  const instance = await findInstanceOrNotFound(id);

  const inUse = await prisma.campaignInstance.findFirst({ where: { instanceId: id }, select: { id: true } });
  if (inUse) {
    conflict('Esta instância está associada a uma campanha e não pode ser apagada. Desconecte-a ou remova-a da campanha primeiro.');
  }

  try {
    const client = await getEvolutionClientForInstance(instance);
    await client.deleteInstance(instance.evolutionInstanceName);
  } catch (err) {
    // Best-effort: se a Evolution já não tiver a instância (ou estiver fora
    // do ar), ainda assim removemos nosso registro — Postgres é a fonte da
    // verdade (mesmo princípio de R10, ARQUITETURA §9.1: "Redis é volátil por
    // design; a verdade está no Postgres", aqui aplicado à Evolution).
    logger.error('falha ao apagar instância na Evolution API (prosseguindo com a remoção local)', {
      instanceId: id,
      err: err instanceof Error ? err : new Error(String(err)),
    });
    if (err instanceof MessagingError) {
      void sendAlert({ kind: 'evolution_api_error', action: 'apagar a instância', code: err.code });
    }
  }

  try {
    await prisma.whatsAppInstance.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2003' || err.code === 'P2014')) {
      conflict('Esta instância está associada a uma campanha e não pode ser apagada. Desconecte-a ou remova-a da campanha primeiro.');
    }
    throw err;
  }
}
