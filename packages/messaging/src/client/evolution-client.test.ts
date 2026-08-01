import { describe, expect, it, vi } from 'vitest';
import { MessagingError } from '../errors.js';
import { EvolutionClient, evolutionConfigFromEnv } from './evolution-client.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fakeFetch(responses: Response[]): { fetchImpl: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const response = responses[Math.min(i, responses.length - 1)];
    i++;
    if (!response) throw new Error('sem resposta mockada configurada');
    return response;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const config = { baseUrl: 'https://evolution.example.com', apiKey: 'test-key' };

describe('evolutionConfigFromEnv', () => {
  it('lê EVOLUTION_API_URL/EVOLUTION_API_KEY e remove barra final da URL', () => {
    const cfg = evolutionConfigFromEnv({ EVOLUTION_API_URL: 'https://evo.local/', EVOLUTION_API_KEY: 'abc' });
    expect(cfg).toEqual({ baseUrl: 'https://evo.local', apiKey: 'abc' });
  });

  it('lança VALIDATION_ERROR se faltar EVOLUTION_API_URL', () => {
    expect(() => evolutionConfigFromEnv({ EVOLUTION_API_KEY: 'abc' })).toThrow(MessagingError);
  });

  it('lança VALIDATION_ERROR se faltar EVOLUTION_API_KEY', () => {
    expect(() => evolutionConfigFromEnv({ EVOLUTION_API_URL: 'https://evo.local' })).toThrow(MessagingError);
  });
});

describe('EvolutionClient.createInstance', () => {
  it('cria a instância e devolve o QR já na criação', async () => {
    const { fetchImpl, calls } = fakeFetch([
      jsonResponse(201, {
        instance: { instanceName: 'vendas-01', instanceId: 'abc123', status: 'created' },
        qrcode: { base64: 'data:image/png;base64,AAA', code: '2@xyz' },
      }),
    ]);
    const client = new EvolutionClient({ ...config, fetchImpl });
    const result = await client.createInstance({ instanceName: 'vendas-01' });

    expect(result).toEqual({
      instanceName: 'vendas-01',
      instanceId: 'abc123',
      state: 'disconnected',
      qr: { base64: 'data:image/png;base64,AAA', pairingCode: '2@xyz' },
    });
    expect(calls[0]?.url).toBe('https://evolution.example.com/instance/create');
    expect(calls[0]?.init?.method).toBe('POST');
    expect((calls[0]?.init?.headers as Record<string, string>).apikey).toBe('test-key');
  });

  it('rejeita instanceName curto sem chamar a rede', async () => {
    const { fetchImpl, calls } = fakeFetch([jsonResponse(200, {})]);
    const client = new EvolutionClient({ ...config, fetchImpl });
    await expect(client.createInstance({ instanceName: 'a' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(calls.length).toBe(0);
  });
});

describe('EvolutionClient.sendText', () => {
  it('envia e devolve providerMessageId a partir de key.id', async () => {
    const { fetchImpl, calls } = fakeFetch([
      jsonResponse(201, { key: { id: 'MSG1', remoteJid: '5511987654321@s.whatsapp.net' }, status: 'PENDING' }),
    ]);
    const client = new EvolutionClient({ ...config, fetchImpl });
    const result = await client.sendText('vendas-01', { to: '+5511987654321', text: 'Olá!' });

    expect(result).toEqual({ providerMessageId: 'MSG1', remoteJid: '5511987654321@s.whatsapp.net', rawStatus: 'PENDING' });
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body).toMatchObject({ number: '5511987654321', text: 'Olá!' });
  });

  it('rejeita número fora de E.164 como INVALID_NUMBER, sem chamar a rede', async () => {
    const { fetchImpl, calls } = fakeFetch([jsonResponse(200, {})]);
    const client = new EvolutionClient({ ...config, fetchImpl });
    await expect(client.sendText('vendas-01', { to: '11987654321', text: 'Olá!' })).rejects.toMatchObject({
      code: 'INVALID_NUMBER',
    });
    expect(calls.length).toBe(0);
  });

  it('rejeita texto vazio sem chamar a rede', async () => {
    const { fetchImpl, calls } = fakeFetch([jsonResponse(200, {})]);
    const client = new EvolutionClient({ ...config, fetchImpl });
    await expect(client.sendText('vendas-01', { to: '+5511987654321', text: '   ' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(calls.length).toBe(0);
  });

  it('classifica 400 "instance is not connected" como INSTANCE_DISCONNECTED (não retryable)', async () => {
    const { fetchImpl, calls } = fakeFetch([jsonResponse(400, { message: 'The instance is not connected' })]);
    const client = new EvolutionClient({ ...config, fetchImpl });
    await expect(client.sendText('vendas-01', { to: '+5511987654321', text: 'Olá!' })).rejects.toMatchObject({
      code: 'INSTANCE_DISCONNECTED',
      retryable: false,
    });
    expect(calls.length).toBe(1);
  });

  it('classifica 400 "number does not exist on whatsapp" como INVALID_NUMBER', async () => {
    const { fetchImpl } = fakeFetch([jsonResponse(400, { message: 'This number does not exist on WhatsApp' })]);
    const client = new EvolutionClient({ ...config, fetchImpl });
    await expect(client.sendText('vendas-01', { to: '+5511987654321', text: 'Olá!' })).rejects.toMatchObject({
      code: 'INVALID_NUMBER',
      retryable: false,
    });
  });

  it('classifica 429 como RATE_LIMITED, sem retry automático de transporte', async () => {
    const { fetchImpl, calls } = fakeFetch([jsonResponse(429, { message: 'Too many requests' })]);
    const client = new EvolutionClient({ ...config, fetchImpl });
    await expect(client.sendText('vendas-01', { to: '+5511987654321', text: 'Olá!' })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    });
    expect(calls.length).toBe(1);
  });

  it('classifica 401 como AUTH_ERROR', async () => {
    const { fetchImpl } = fakeFetch([jsonResponse(401, { message: 'Invalid apikey' })]);
    const client = new EvolutionClient({ ...config, fetchImpl });
    await expect(client.sendText('vendas-01', { to: '+5511987654321', text: 'Olá!' })).rejects.toMatchObject({
      code: 'AUTH_ERROR',
      retryable: false,
    });
  });

  it('classifica 404 como INSTANCE_NOT_FOUND', async () => {
    const { fetchImpl } = fakeFetch([jsonResponse(404, { message: 'Instance not found' })]);
    const client = new EvolutionClient({ ...config, fetchImpl });
    await expect(client.sendText('vendas-01', { to: '+5511987654321', text: 'Olá!' })).rejects.toMatchObject({
      code: 'INSTANCE_NOT_FOUND',
    });
  });

  // Estes 3 testes exercitam o retry de transporte, que usa `sleep`/backoff
  // reais (1s+4s) — fake timers evitam um teste lento/flaky por timeout.
  it('faz retry de transporte em 500 e devolve sucesso na 2ª tentativa', async () => {
    vi.useFakeTimers();
    try {
      const { fetchImpl, calls } = fakeFetch([
        jsonResponse(500, { message: 'internal error' }),
        jsonResponse(201, { key: { id: 'MSG2', remoteJid: '5511987654321@s.whatsapp.net' } }),
      ]);
      const client = new EvolutionClient({ ...config, fetchImpl });
      const promise = client.sendText('vendas-01', { to: '+5511987654321', text: 'Olá!' });
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result.providerMessageId).toBe('MSG2');
      expect(calls.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('propaga TRANSIENT_ERROR depois de esgotar as tentativas de transporte', async () => {
    vi.useFakeTimers();
    try {
      const { fetchImpl, calls } = fakeFetch([
        jsonResponse(503, { message: 'unavailable' }),
        jsonResponse(503, { message: 'unavailable' }),
        jsonResponse(503, { message: 'unavailable' }),
      ]);
      const client = new EvolutionClient({ ...config, fetchImpl });
      const promise = client.sendText('vendas-01', { to: '+5511987654321', text: 'Olá!' });
      const assertion = expect(promise).rejects.toMatchObject({ code: 'TRANSIENT_ERROR' });
      await vi.runAllTimersAsync();
      await assertion;
      expect(calls.length).toBe(3); // 1 tentativa + 2 retries (MESSAGING_ERROR_POLICY.TRANSIENT_ERROR.maxAttempts)
    } finally {
      vi.useRealTimers();
    }
  });

  it('classifica erro de rede (fetch rejeita) como TRANSIENT_ERROR', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
      const client = new EvolutionClient({ ...config, fetchImpl: fetchImpl as unknown as typeof fetch });
      const promise = client.sendText('vendas-01', { to: '+5511987654321', text: 'Olá!' });
      const assertion = expect(promise).rejects.toMatchObject({ code: 'TRANSIENT_ERROR' });
      await vi.runAllTimersAsync();
      await assertion;
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('classifica timeout (AbortError) como TIMEOUT — TIMEOUT é retryable, então também exercita o retry de transporte', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const hangingFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        calls++;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      }) as typeof fetch;
      const client = new EvolutionClient({ ...config, fetchImpl: hangingFetch, timeoutMs: 20 });
      const promise = client.sendText('vendas-01', { to: '+5511987654321', text: 'Olá!' });
      const assertion = expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
      await vi.runAllTimersAsync();
      await assertion;
      expect(calls).toBe(3); // 1 tentativa + 2 retries (MESSAGING_ERROR_POLICY.TIMEOUT.maxAttempts)
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('EvolutionClient.getConnectionState / connect', () => {
  it('mapeia state=open para connected', async () => {
    const { fetchImpl } = fakeFetch([jsonResponse(200, { instance: { instanceName: 'vendas-01', state: 'open' } })]);
    const client = new EvolutionClient({ ...config, fetchImpl });
    await expect(client.getConnectionState('vendas-01')).resolves.toBe('connected');
  });

  it('mapeia state=connecting para connecting', async () => {
    const { fetchImpl } = fakeFetch([jsonResponse(200, { instance: { state: 'connecting' } })]);
    const client = new EvolutionClient({ ...config, fetchImpl });
    await expect(client.getConnectionState('vendas-01')).resolves.toBe('connecting');
  });

  it('connect() devolve QR quando ainda conectando', async () => {
    const { fetchImpl } = fakeFetch([jsonResponse(200, { base64: 'data:image/png;base64,BBB', code: '2@qr' })]);
    const client = new EvolutionClient({ ...config, fetchImpl });
    const result = await client.connect('vendas-01');
    expect(result).toEqual({ state: 'connecting', qr: { base64: 'data:image/png;base64,BBB', pairingCode: '2@qr' } });
  });
});

describe('EvolutionClient.setWebhook', () => {
  it('envia os 4 eventos default quando não especificado', async () => {
    const { fetchImpl, calls } = fakeFetch([jsonResponse(200, {})]);
    const client = new EvolutionClient({ ...config, fetchImpl });
    await client.setWebhook('vendas-01', { url: 'https://app.example.com/api/webhooks/evolution/secret-key' });
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.webhook.events).toEqual(['CONNECTION_UPDATE', 'QRCODE_UPDATED', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE']);
    expect(body.webhook.url).toBe('https://app.example.com/api/webhooks/evolution/secret-key');
  });

  it('rejeita URL não-http(s) sem chamar a rede', async () => {
    const { fetchImpl, calls } = fakeFetch([jsonResponse(200, {})]);
    const client = new EvolutionClient({ ...config, fetchImpl });
    await expect(client.setWebhook('vendas-01', { url: 'ftp://x' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(calls.length).toBe(0);
  });
});

describe('EvolutionClient.checkNumbers', () => {
  it('devolve [] sem chamar a rede quando numbers está vazio', async () => {
    const { fetchImpl, calls } = fakeFetch([jsonResponse(200, [])]);
    const client = new EvolutionClient({ ...config, fetchImpl });
    await expect(client.checkNumbers('vendas-01', [])).resolves.toEqual([]);
    expect(calls.length).toBe(0);
  });

  it('correlaciona por número quando a resposta traz `number`', async () => {
    const { fetchImpl } = fakeFetch([
      jsonResponse(200, [
        { number: '5521998887777', exists: false, jid: null },
        { number: '5511987654321', exists: true, jid: '5511987654321@s.whatsapp.net' },
      ]),
    ]);
    const client = new EvolutionClient({ ...config, fetchImpl });
    const result = await client.checkNumbers('vendas-01', ['+5511987654321', '+5521998887777']);
    expect(result).toEqual([
      { input: '+5511987654321', exists: true, jid: '5511987654321@s.whatsapp.net' },
      { input: '+5521998887777', exists: false, jid: null },
    ]);
  });
});
