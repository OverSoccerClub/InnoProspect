/**
 * alerts.test.ts — primeiro teste de `apps/worker` (ver comentário em
 * `apps/worker/vitest.config.ts` sobre `passWithNoTests`, era `true` porque
 * este diretório estava zerado). Cobre as regras não-negociáveis do módulo:
 * nunca lança, só alerta com `ALERT_WEBHOOK_URL` configurada, payload com
 * `text` legível + campos estruturados, e nunca chama `fetch` sem a env.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

const ORIGINAL_ENV = process.env.ALERT_WEBHOOK_URL;

describe('sendAlert', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    process.env.ALERT_WEBHOOK_URL = ORIGINAL_ENV;
    vi.unstubAllGlobals();
  });

  it('sem ALERT_WEBHOOK_URL, não chama fetch', async () => {
    delete process.env.ALERT_WEBHOOK_URL;
    const { sendAlert } = await import('./alerts.js');

    await sendAlert({
      kind: 'queue_paused',
      code: 'RATE_LIMITED',
      severity: 'high',
      message: 'teste',
      reason: 'scrape_error',
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it('com ALERT_WEBHOOK_URL, faz POST com text legível + campos estruturados', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/alert';
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200 });
    const { sendAlert } = await import('./alerts.js');

    await sendAlert({
      kind: 'sanity_incident_opened',
      code: 'ZERO_STREAK',
      severity: 'critical',
      message: 'scraper provavelmente quebrado',
      metric: 0,
      threshold: 5,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://hooks.example.com/alert');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.text).toContain('incidente de sanidade');
    expect(body.text).toContain('scraper provavelmente quebrado');
    expect(body).toMatchObject({
      type: 'sanity_incident_opened',
      severity: 'critical',
      code: 'ZERO_STREAK',
      metric: 0,
      threshold: 5,
    });
    expect(typeof body.occurredAt).toBe('string');
  });

  it('resposta não-2xx do webhook não lança — só loga e segue', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/alert';
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500 });
    const { sendAlert } = await import('./alerts.js');

    await expect(
      sendAlert({ kind: 'queue_resumed', code: 'RATE_LIMITED', message: 'retomou' }),
    ).resolves.toBeUndefined();
  });

  it('falha de rede (fetch rejeita) não lança — só loga e segue', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/alert';
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));
    const { sendAlert } = await import('./alerts.js');

    await expect(
      sendAlert({ kind: 'queue_resumed', code: null, message: 'retomou' }),
    ).resolves.toBeUndefined();
  });

  it('timeout do fetch (AbortError) não lança — só loga e segue', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/alert';
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        }),
    );
    const { sendAlert } = await import('./alerts.js');

    await expect(
      sendAlert({ kind: 'queue_paused', code: 'CAPTCHA_DETECTED', severity: 'high', message: 'captcha', reason: 'scrape_error' }),
    ).resolves.toBeUndefined();
  });
});
