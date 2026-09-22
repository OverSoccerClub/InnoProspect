/**
 * observability/alerts.ts — avisa um humano FORA do painel quando a fila
 * `scrape:search` muda de estado. Onda 2: hoje o sistema já SABE que algo
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
        text: `⏸️ InnoProspect — fila scrape:search PAUSADA (${event.severity}, ${event.code}): ${event.message}`,
        type: 'queue_paused',
        severity: event.severity,
        code: event.code,
        reason: event.reason,
        message: event.message,
        occurredAt,
      };
    case 'queue_resumed':
      return {
        text: `▶️ InnoProspect — fila scrape:search RETOMADA${event.code ? ` (motivo original: ${event.code})` : ''}: ${event.message}`,
        type: 'queue_resumed',
        code: event.code,
        message: event.message,
        occurredAt,
      };
  }
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
