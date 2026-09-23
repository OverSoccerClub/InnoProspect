/**
 * alerts.test.ts — cobre as regras não-negociáveis do módulo (nunca lança,
 * no-op sem `ALERT_WEBHOOK_URL`, payload com `text` legível + campos
 * estruturados) e a única regra NOVA em relação ao gêmeo do worker
 * (`apps/worker/src/observability/alerts.test.ts`): a deduplicação por
 * `code`, só para `evolution_api_error`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
    vi.useRealTimers();
  });

  it('sem ALERT_WEBHOOK_URL, não chama fetch', async () => {
    delete process.env.ALERT_WEBHOOK_URL;
    const { sendAlert } = await import('./alerts');

    await sendAlert({ kind: 'instance_disconnected', instanceId: 'inst-1', instanceName: 'Vendas', reason: 'disconnected', message: 'teste' });

    expect(fetch).not.toHaveBeenCalled();
  });

  it('com ALERT_WEBHOOK_URL, faz POST com text legível + campos estruturados (instance_disconnected)', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/alert';
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200 });
    const { sendAlert } = await import('./alerts');

    await sendAlert({
      kind: 'instance_disconnected',
      instanceId: 'inst-1',
      instanceName: 'Vendas SP',
      reason: 'banned',
      message: 'Instância banida — conexão encerrada pelo provedor (statusReason 401).',
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://hooks.example.com/alert');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.text).toContain('Vendas SP');
    expect(body.text).toContain('BANIDA');
    expect(body).toMatchObject({ type: 'instance_disconnected', instanceId: 'inst-1', reason: 'banned' });
    expect(typeof body.occurredAt).toBe('string');
  });

  it('instance_degraded: payload com contagem de falhas e limite', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/alert';
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200 });
    const { sendAlert } = await import('./alerts');

    await sendAlert({ kind: 'instance_degraded', instanceId: 'inst-1', instanceName: 'Vendas SP', consecutiveFailures: 5, threshold: 5 });

    const body = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body as string);
    expect(body.type).toBe('instance_degraded');
    expect(body.text).toContain('5 falhas consecutivas');
  });

  it('campaign_halted: payload com a lista de campanhas afetadas, sem o haltReason cru', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/alert';
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200 });
    const { sendAlert } = await import('./alerts');

    await sendAlert({ kind: 'campaign_halted', campaignIds: ['camp-1', 'camp-2'], instanceId: 'inst-1' });

    const body = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body as string);
    expect(body.type).toBe('campaign_halted');
    expect(body.campaignIds).toEqual(['camp-1', 'camp-2']);
    expect(body.text).toContain('2 campanhas PARADAS');
  });

  it('evolution_api_error: payload nunca inclui a mensagem crua do erro (só action/code)', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/alert';
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200 });
    const { sendAlert } = await import('./alerts');

    await sendAlert({ kind: 'evolution_api_error', action: 'enviar mensagem', code: 'TIMEOUT' });

    const body = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body as string);
    expect(body.type).toBe('evolution_api_error');
    expect(body.code).toBe('TIMEOUT');
    expect(JSON.stringify(body)).not.toContain('cause');
  });

  it('evolution_api_error: 2ª chamada com o MESMO código dentro da janela de dedupe é suprimida (não floda por requisição)', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/alert';
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200 });
    vi.useFakeTimers();
    const { sendAlert } = await import('./alerts');

    await sendAlert({ kind: 'evolution_api_error', action: 'enviar mensagem', code: 'TIMEOUT' });
    await sendAlert({ kind: 'evolution_api_error', action: 'enviar mensagem', code: 'TIMEOUT' });
    await sendAlert({ kind: 'evolution_api_error', action: 'enviar mensagem', code: 'TIMEOUT' });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('evolution_api_error: código DIFERENTE não é suprimido pela janela do outro código', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/alert';
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200 });
    const { sendAlert } = await import('./alerts');

    await sendAlert({ kind: 'evolution_api_error', action: 'enviar mensagem', code: 'TIMEOUT' });
    await sendAlert({ kind: 'evolution_api_error', action: 'conectar a instância', code: 'AUTH_ERROR' });

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('evolution_api_error: depois da janela de dedupe passar, alerta de novo', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/alert';
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200 });
    vi.useFakeTimers();
    const { sendAlert } = await import('./alerts');

    await sendAlert({ kind: 'evolution_api_error', action: 'enviar mensagem', code: 'TIMEOUT' });
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    await sendAlert({ kind: 'evolution_api_error', action: 'enviar mensagem', code: 'TIMEOUT' });

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('instance_disconnected NÃO usa a janela de dedupe — cada transição chamada alerta (dedupe é responsabilidade do chamador)', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/alert';
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200 });
    const { sendAlert } = await import('./alerts');

    await sendAlert({ kind: 'instance_disconnected', instanceId: 'inst-1', instanceName: 'Vendas', reason: 'disconnected', message: 'x' });
    await sendAlert({ kind: 'instance_disconnected', instanceId: 'inst-1', instanceName: 'Vendas', reason: 'disconnected', message: 'x' });

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('resposta não-2xx do webhook não lança — só loga e segue', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/alert';
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500 });
    const { sendAlert } = await import('./alerts');

    await expect(
      sendAlert({ kind: 'evolution_api_error', action: 'enviar mensagem', code: 'UNKNOWN' }),
    ).resolves.toBeUndefined();
  });

  it('falha de rede (fetch rejeita) não lança — só loga e segue', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/alert';
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));
    const { sendAlert } = await import('./alerts');

    await expect(
      sendAlert({ kind: 'evolution_api_error', action: 'enviar mensagem', code: 'UNKNOWN' }),
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
    const { sendAlert } = await import('./alerts');

    await expect(
      sendAlert({ kind: 'campaign_halted', campaignIds: ['camp-1'], instanceId: 'inst-1' }),
    ).resolves.toBeUndefined();
  });
});
