/**
 * observability/alerts.ts — avisa um humano FORA do painel quando a fila
 * `scrape-search` muda de estado. Onda 2: hoje o sistema já SABE que algo
 * parou (incidente de sanidade A1-A4, pausa por `SCRAPE_ERROR_POLICY`,
 * `ScraperHealthEvent`, `pause-meta` no Redis — ver [[convention-worker-
 * redis-state]] na memória), mas ninguém é avisado sem abrir o painel ou o
 * `/health`. Isso já deixou uma busca real parada por 2 dias.
 *
 * POST de um JSON simples para `ALERT_WEBHOOK_URL` (env, ver `.env.example`).
 * O payload tem um campo `text` pronto para um webhook de entrada do Slack
 * ou do Google Chat (ambos aceitam `{ "text": "..." }` cru) — quem quiser os
 * campos estruturados (type/severity/code/...) usa o resto do objeto.
 *
 * Regras não-negociáveis deste módulo:
 *  1. NUNCA lança. Falha de rede/DNS/timeout/resposta não-2xx é logada e
 *     engolida — um alerta quebrado não pode derrubar nem atrasar o
 *     processamento de uma `SearchTask`. Todo `await sendAlert(...)` nos
 *     chamadores é seguro de deixar sem `try/catch` por causa disto.
 *  2. Timeout curto (`ALERT_TIMEOUT_MS`) via `AbortController` — não
 *     travar o worker esperando um endpoint de alerta lento/pendurado.
 *  3. Só dispara na TRANSIÇÃO de estado — cada chamador (sanity.ts,
 *     jobs/scrape-search.job.ts, scheduler.ts) já faz a checagem de "isto é
 *     novo ou já estava assim?" ANTES de chamar `sendAlert`; este módulo não
 *     tem estado próprio de dedupe. Ver o comentário em cada chamador.
 *  4. Sem `ALERT_WEBHOOK_URL`, `sendAlert` é um no-op (custa uma leitura de
 *     env) — e loga UMA VEZ, no boot, que o alerta está desligado
 *     (`logAlertingStatusOnce`, chamado em `index.ts`).
 *
 * ⚠️ SSRF: `ALERT_WEBHOOK_URL` só pode vir de variável de ambiente (definida
 * no deploy, EasyPanel) — NUNCA de payload de requisição, corpo de webhook
 * recebido (Evolution API) ou qualquer outro dado que atravesse a fronteira
 * do cliente. Se um dia alguém for parametrizar isto por chamada/por conta,
 * a URL de destino precisa de allowlist explícita — não aceitar URL livre
 * vinda de fora. Hoje isto é trivialmente seguro porque é fixo no processo,
 * igual qualquer outra credencial de integração (`EVOLUTION_API_URL` etc.).
 */
import { logger } from './logger.js';

export type AlertEvent =
  | {
      kind: 'sanity_incident_opened';
      code: string;
      severity: 'high' | 'critical';
      message: string;
      metric: number;
      threshold: number;
    }
  | {
      kind: 'queue_paused';
      code: string;
      severity: 'high' | 'critical';
      message: string;
      /** Onda 2 só cobre pausa por `SCRAPE_ERROR_POLICY` aqui — pausa por sanidade já foi avisada via `sanity_incident_opened`. */
      reason: 'scrape_error';
    }
  | {
      kind: 'queue_resumed';
      /** Código da pausa que acabou de terminar (pode ser `null` se a metadata já tinha sido limpa por outro caminho). */
      code: string | null;
      message: string;
    }
  // 🆕 Fase 4.F.4 — os 4 kinds abaixo são ESTRUTURALMENTE IDÊNTICOS a
  // `SendNotifyEvent` (`@inno/sending`), o mesmo truque de
  // `apps/web/src/lib/alerts.ts` (Onda 3): permite `notify: sendAlert` na
  // chamada de `executeSendAttempt` SEM CAST (TypeScript aceita por
  // variância estrutural de parâmetro de função — `AlertEvent` é superset
  // de `SendNotifyEvent`). `dispatch-tick.job.ts` é quem dispara — falha de
  // envio DENTRO do `executeSendAttempt` (instância desconecta, degrada,
  // kill switch por instância sole, erro genérico da Evolution).
  | { kind: 'instance_disconnected'; instanceId: string; instanceName: string | null; reason: 'banned' | 'disconnected'; message: string }
  | { kind: 'instance_degraded'; instanceId: string; instanceName: string | null; consecutiveFailures: number; threshold: number }
  | { kind: 'campaign_halted'; campaignIds: string[]; instanceId: string }
  | { kind: 'evolution_api_error'; action: string; code: string }
  // 🆕 Fase 4.F.4 (ARQUITETURA §6.8.6/§6.8.8) — dois kinds NOVOS, próprios do
  // tick (não fazem parte de `SendNotifyEvent`, porque só o dispatch-tick
  // conhece "rotação" e "ciclo"; o envio unitário não tem esse conceito):
  | {
      kind: 'dispatch_instance_uncertain_degraded';
      instanceId: string;
      instanceName: string | null;
      consecutiveUncertain: number;
      threshold: number;
    }
  | {
      kind: 'dispatch_campaign_halted_no_connected_instance';
      campaignId: string;
    };

/** Timeout de rede para o POST do alerta — curto de propósito, ver regra 2 no cabeçalho. */
const ALERT_TIMEOUT_MS = 5_000;

let statusLoggedOnce = false;

function webhookUrl(): string | null {
  const url = process.env.ALERT_WEBHOOK_URL?.trim();
  return url ? url : null;
}

/**
 * Loga uma única vez (por processo) se o alerta está ativo ou desligado.
 * Chamado explicitamente no boot (`index.ts`) para aparecer sempre no log de
 * start — e de novo, defensivamente, dentro de `sendAlert` (idempotente por
 * causa do `statusLoggedOnce`), para o caso de o primeiro evento acontecer
 * antes de qualquer boot log ter sido observado.
 */
export function logAlertingStatusOnce(): void {
  if (statusLoggedOnce) return;
  statusLoggedOnce = true;

  if (webhookUrl()) {
    logger.info('alertas de incidente/pausa/retomada da fila: ATIVOS (ALERT_WEBHOOK_URL configurada)');
  } else {
    logger.warn(
      'ALERT_WEBHOOK_URL não configurada — alertas de incidente/pausa/retomada da fila DESLIGADOS (só painel/GET /api/v1/health)',
    );
  }
}

function buildPayload(event: AlertEvent, occurredAt: string): Record<string, unknown> {
  switch (event.kind) {
    case 'sanity_incident_opened':
      return {
        text: `🚨 InnoProspect — incidente de sanidade do scraper (${event.severity}): ${event.message}`,
        type: 'sanity_incident_opened',
        severity: event.severity,
        code: event.code,
        message: event.message,
        metric: event.metric,
        threshold: event.threshold,
        occurredAt,
      };
    case 'queue_paused':
      return {
        text: `⏸️ InnoProspect — fila scrape-search PAUSADA (${event.severity}, ${event.code}): ${event.message}`,
        type: 'queue_paused',
        severity: event.severity,
        code: event.code,
        reason: event.reason,
        message: event.message,
        occurredAt,
      };
    case 'queue_resumed':
      return {
        text: `▶️ InnoProspect — fila scrape-search RETOMADA${event.code ? ` (motivo original: ${event.code})` : ''}: ${event.message}`,
        type: 'queue_resumed',
        code: event.code,
        message: event.message,
        occurredAt,
      };
    case 'instance_disconnected': {
      const label = event.instanceName ?? event.instanceId;
      const verb = event.reason === 'banned' ? 'foi BANIDA' : 'DESCONECTOU';
      return {
        text: `🔌 InnoProspect — instância de WhatsApp "${label}" ${verb} durante o disparo: ${event.message}`,
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
        text: `⏹️ InnoProspect — ${n} campanha${n === 1 ? '' : 's'} PARADA${n === 1 ? '' : 'S'} pelo motor de disparo (kill switch).`,
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
    case 'dispatch_instance_uncertain_degraded': {
      const label = event.instanceName ?? event.instanceId;
      return {
        text: `⚠️ InnoProspect — instância de WhatsApp "${label}" saiu da rotação de disparo neste ciclo: ${event.consecutiveUncertain} resultados INCERTOS seguidos (limite: ${event.threshold}).`,
        type: 'dispatch_instance_uncertain_degraded',
        instanceId: event.instanceId,
        instanceName: event.instanceName,
        consecutiveUncertain: event.consecutiveUncertain,
        threshold: event.threshold,
        occurredAt,
      };
    }
    case 'dispatch_campaign_halted_no_connected_instance': {
      return {
        text: `⏹️ InnoProspect — campanha PARADA (kill switch): nenhuma instância de WhatsApp conectada disponível para ela.`,
        type: 'dispatch_campaign_halted_no_connected_instance',
        campaignId: event.campaignId,
        occurredAt,
      };
    }
  }
}

/**
 * Janela de dedupe só para `evolution_api_error` — MESMO motivo/valor de
 * `apps/web/src/lib/alerts.ts`: uma Evolution fora do ar gera um erro POR
 * ENVIO (o `dispatch-tick` roda a cada `DISPATCH_TICK_INTERVAL_S`, e pode
 * tentar várias instâncias/alvos por ciclo), sem nenhum estado prévio no
 * banco que sirva de "incidente já aberto" pra checar antes de alertar.
 */
const EVOLUTION_ERROR_DEDUPE_WINDOW_MS = 15 * 60 * 1000;
/** `code -> timestamp (ms) do último alerta enviado` — só usado por `evolution_api_error`. */
const lastEvolutionErrorAlertAt = new Map<string, number>();

/** `true` se este evento deve ser SUPRIMIDO (dedupe de `evolution_api_error`). Efeito colateral: registra o timestamp quando devolve `false`. */
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
 * `ALERT_WEBHOOK_URL`, é um no-op silencioso (o aviso de "desligado" já
 * saiu uma vez no boot).
 */
export async function sendAlert(event: AlertEvent): Promise<void> {
  logAlertingStatusOnce();

  const url = webhookUrl();
  if (!url) return;

  if (shouldSuppress(event)) {
    logger.info({ type: event.kind }, 'alerta suprimido por deduplicação (mesmo código recente)');
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
      logger.error(
        { type: event.kind, status: response.status },
        'alerta webhook respondeu com status de erro — worker segue normalmente',
      );
    }
  } catch (err) {
    logger.error(
      { type: event.kind, err: err instanceof Error ? err.message : String(err) },
      'falha ao enviar alerta webhook — worker segue normalmente (não afeta o processamento de tasks)',
    );
  } finally {
    clearTimeout(timer);
  }
}
