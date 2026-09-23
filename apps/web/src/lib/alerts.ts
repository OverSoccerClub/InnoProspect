/**
 * lib/alerts.ts — avisa um humano FORA do painel quando algo que custa o
 * número do dono acontece do lado de `apps/web`: uma instância de WhatsApp
 * cai, a Evolution API responde com erro, uma instância degrada por falhas
 * consecutivas de envio, ou uma campanha para sozinha (kill switch).
 *
 * Onda 3 (2026-09-23): até aqui só `apps/worker` avisava alguém (ver
 * [[convention-worker-alerts]] na memória do Vega) — os quatro eventos acima,
 * que acontecem inteiramente em `apps/web`, eram silenciosos. `apps/web` não
 * pode importar `apps/worker` (regra de dependência do monorepo), então este
 * módulo é um DUPLICADO de propósito de `apps/worker/src/observability/
 * alerts.ts` — mesmo contrato de payload (`text` pronto pra Slack/Google
 * Chat + campos estruturados), mesma env (`ALERT_WEBHOOK_URL`, compartilhada
 * entre os dois processos), mesmas regras não-negociáveis:
 *
 *  1. NUNCA lança. Falha de rede/DNS/timeout/resposta não-2xx é logada e
 *     engolida — um alerta quebrado não pode derrubar nem atrasar a rota que
 *     ele deveria observar. Todo `sendAlert(...)` é seguro de chamar
 *     "fire-and-forget" (sem `await`) por causa disto.
 *  2. Timeout curto (`ALERT_TIMEOUT_MS`) via `AbortController`.
 *  3. Sem `ALERT_WEBHOOK_URL`, é um no-op silencioso (custa só uma leitura
 *     de env) — loga uma vez, na primeira chamada, que está desligado.
 *  4. Nunca incluir segredo (chave de API, token) nem o corpo de erro CRU
 *     devolvido pela Evolution — algumas respostas de erro dela ecoam de
 *     volta o payload da requisição (ex.: `INVALID_NUMBER` inclui o telefone
 *     no `message`, ver `packages/messaging/src/client/evolution-client.ts`).
 *     Por isso este módulo NUNCA repassa `MessagingError.message`/`cause` —
 *     só o `code` (vocabulário fechado, `MessagingErrorCode`) e mensagens
 *     fixas escritas por nós. O mesmo vale para `haltReason` de campanha:
 *     o alerta usa um texto genérico próprio, nunca o texto livre gravado no
 *     banco (que pode ter herdado a mesma mensagem crua da Evolution).
 *
 * Deduplicação — ESCOLHA DELIBERADA, diferente do worker: lá, cada chamador
 * já tem um jeito de saber "isto é novo ou já estava assim?" antes de chamar
 * `sendAlert` (um registro em `ScraperHealthEvent`/`pause-meta` no Redis).
 * Aqui, três dos quatro tipos de evento têm a MESMA propriedade (o chamador
 * só entra no `if` de alerta numa transição real de estado — ver comentário
 * em cada call site), então também não precisam de dedupe aqui.
 *
 * O QUARTO tipo (`evolution_api_error`) é diferente: uma Evolution fora do
 * ar gera um erro POR REQUISIÇÃO (toda tentativa de enviar mensagem/conectar
 * instância falha), sem nenhum estado prévio no banco que sirva de "incidente
 * já aberto" pra checar antes de alertar — é exatamente o "não pode gerar um
 * alerta por requisição" citado no pedido. Por isso, SÓ este tipo tem uma
 * janela de deduplicação própria, dentro deste módulo (`EVOLUTION_ERROR_
 * DEDUPE_WINDOW_MS`), chaveada por `code` (não por instância/ação — se a API
 * inteira caiu, N instâncias falhando ao mesmo tempo é UM incidente, não N).
 * Em memória do processo, mesmo padrão e mesma limitação documentada de
 * `lib/rate-limit.ts` (não sobrevive a restart, não é compartilhado entre
 * réplicas — aceitável hoje porque o EasyPanel roda 1 réplica de `web`,
 * ver `DEPLOY.md`).
 */
import { logger } from './logger';

export type AlertEvent =
  | {
      kind: 'instance_disconnected';
      instanceId: string;
      instanceName: string | null;
      reason: 'banned' | 'disconnected';
      /** Mensagem PRÓPRIA (nunca texto cru da Evolution) — ver regra 4 no cabeçalho. */
      message: string;
    }
  | {
      kind: 'instance_degraded';
      instanceId: string;
      instanceName: string | null;
      consecutiveFailures: number;
      threshold: number;
    }
  | {
      kind: 'campaign_halted';
      campaignIds: string[];
      instanceId: string;
    }
  | {
      /** `action` e `code` são vocabulário nosso/fechado (`MessagingErrorCode`) — nunca o `message`/`cause` cru da Evolution, ver regra 4 no cabeçalho. */
      kind: 'evolution_api_error';
      action: string;
      code: string;
    };

/** Timeout de rede para o POST do alerta — mesmo valor do worker (ver regra 2 no cabeçalho). */
const ALERT_TIMEOUT_MS = 5_000;

/**
 * Janela de dedupe só para `evolution_api_error` (ver comentário do cabeçalho
 * sobre por que só este tipo precisa). 15 minutos: tempo suficiente para não
 * floodar durante um pico de requisições contra uma Evolution fora do ar
 * (uma queda real tende a durar minutos, não segundos), mas curto o
 * bastante para reabrir o alerta rápido se a API cair de novo depois de uma
 * recuperação passageira. Ajustável com experiência real de produção.
 */
const EVOLUTION_ERROR_DEDUPE_WINDOW_MS = 15 * 60 * 1000;

let statusLoggedOnce = false;
/** `code -> timestamp (ms) do último alerta enviado` — só usado por `evolution_api_error`. */
const lastEvolutionErrorAlertAt = new Map<string, number>();

function webhookUrl(): string | null {
  const url = process.env.ALERT_WEBHOOK_URL?.trim();
  return url ? url : null;
}

/**
 * Loga uma única vez (por processo) se o alerta está ativo ou desligado.
 * Diferente do worker (que tem um `index.ts` de boot único para chamar isto
 * explicitamente), `apps/web` não tem um ponto de entrada único garantido
 * antes da primeira requisição — por isso a checagem roda dentro do próprio
 * `sendAlert`, idempotente via `statusLoggedOnce`, e aparece no log assim
 * que o primeiro evento realmente acontecer (não no boot do processo).
 */
function logAlertingStatusOnce(): void {
  if (statusLoggedOnce) return;
  statusLoggedOnce = true;

  if (webhookUrl()) {
    logger.info('alertas de instância/campanha/Evolution API (web): ATIVOS (ALERT_WEBHOOK_URL configurada)');
  } else {
    logger.warn('ALERT_WEBHOOK_URL não configurada — alertas de instância/campanha/Evolution API (web) DESLIGADOS');
  }
}

function buildPayload(event: AlertEvent, occurredAt: string): Record<string, unknown> {
  switch (event.kind) {
    case 'instance_disconnected': {
      const label = event.instanceName ?? event.instanceId;
      const verb = event.reason === 'banned' ? 'foi BANIDA' : 'DESCONECTOU';
      return {
        text: `🔌 InnoProspect — instância de WhatsApp "${label}" ${verb}: ${event.message}`,
        type: 'instance_disconnected',
        instanceId: event.instanceId,
        instanceName: event.instanceName,
        reason: event.reason,
        message: event.message,
        occurredAt,
      };
    }
    case 'instance_degraded': {
      const label = event.instanceName ?? event.instanceId;
      return {
        text: `⚠️ InnoProspect — instância de WhatsApp "${label}" foi DEGRADADA após ${event.consecutiveFailures} falhas consecutivas de envio (limite: ${event.threshold}).`,
        type: 'instance_degraded',
        instanceId: event.instanceId,
        instanceName: event.instanceName,
        consecutiveFailures: event.consecutiveFailures,
        threshold: event.threshold,
        occurredAt,
      };
    }
    case 'campaign_halted': {
      const n = event.campaignIds.length;
      return {
        text: `⏹️ InnoProspect — ${n} campanha${n === 1 ? '' : 's'} PARADA${n === 1 ? '' : 'S'} (kill switch): a instância de WhatsApp associada desconectou/foi banida.`,
        type: 'campaign_halted',
        campaignIds: event.campaignIds,
        instanceId: event.instanceId,
        occurredAt,
      };
    }
    case 'evolution_api_error': {
      return {
        text: `🚨 InnoProspect — a Evolution API retornou erro ao ${event.action} (código: ${event.code}). Verifique se ela está no ar e se as credenciais estão corretas.`,
        type: 'evolution_api_error',
        action: event.action,
        code: event.code,
        occurredAt,
      };
    }
  }
}

/** `true` se este evento deve ser SUPRIMIDO (dedupe de `evolution_api_error` — ver comentário do cabeçalho). Efeito colateral: registra o timestamp quando devolve `false` (vai mesmo alertar). */
function shouldSuppress(event: AlertEvent): boolean {
  if (event.kind !== 'evolution_api_error') return false;

  const key = event.code;
  const now = Date.now();
  const last = lastEvolutionErrorAlertAt.get(key);
  if (last !== undefined && now - last < EVOLUTION_ERROR_DEDUPE_WINDOW_MS) {
    return true;
  }
  lastEvolutionErrorAlertAt.set(key, now);
  return false;
}

/**
 * Envia o alerta. Nunca lança (regra 1 do cabeçalho) — qualquer falha
 * (webhook fora do ar, timeout, DNS, resposta não-2xx) é só logada. Sem
 * `ALERT_WEBHOOK_URL`, é um no-op silencioso. Chamar sem `await` (fire-and-
 * forget) é seguro em qualquer call site — nunca gera unhandled rejection.
 */
export async function sendAlert(event: AlertEvent): Promise<void> {
  logAlertingStatusOnce();

  const url = webhookUrl();
  if (!url) return;

  if (shouldSuppress(event)) {
    logger.info('alerta suprimido por deduplicação (mesmo código recente)', { type: event.kind });
    return;
  }

  const payload = buildPayload(event, new Date().toISOString());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ALERT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.error('alerta webhook respondeu com status de erro — requisição segue normalmente', {
        type: event.kind,
        status: response.status,
      });
    }
  } catch (err) {
    logger.error('falha ao enviar alerta webhook — requisição segue normalmente', {
      type: event.kind,
      err: err instanceof Error ? err.message : String(err),
    });
  } finally {
    clearTimeout(timer);
  }
}
