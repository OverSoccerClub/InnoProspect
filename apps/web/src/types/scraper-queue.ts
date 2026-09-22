// TODO: trocar por import de @inno/contracts quando o Vega/Nova formalizarem
// este contrato em ARQUITETURA.md §4 — ver o comentário em
// `app/api/v1/scraper/queue/route.ts`: o endpoint foi criado (Onda 1, item
// 1.2/1.3) sem contrato prévio, então o formato abaixo é lido direto de
// `lib/services/scraper-health.ts` (`QueueStatusView`/`ScraperQueueStatusResponse`)
// e precisa continuar batendo com ele campo a campo.

export type ScraperHealthEventSeverity = 'high' | 'critical';

export type ScraperHealthIncident = {
  id: string;
  type: string;
  severity: ScraperHealthEventSeverity;
  window: string;
  metric: string;
  value: number;
  threshold: number;
  message: string;
  createdAt: string;
};

export type ScraperQueueStatus = 'running' | 'paused' | 'unknown';

export type ScraperQueueStatusResponse = {
  status: ScraperQueueStatus;
  reason: string | null;
  code: string | null;
  severity: ScraperHealthEventSeverity | null;
  source: 'scrape_error' | 'sanity' | null;
  pausedAt: string | null;
  resumeAt: string | null;
  openIncidents: ScraperHealthIncident[];
};

export type ResumeScraperQueueResponse = { ok: true; status: 'running'; resolvedIncidents: number };
