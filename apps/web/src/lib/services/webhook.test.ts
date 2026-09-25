/**
 * webhook.test.ts — REVISAO-QA.md §4 prioridade #2: idempotência do webhook
 * é o tipo de bug que só aparece em produção sob reenvio real da Evolution
 * API — impossível de pegar manualmente. Usa o parser REAL de
 * `@inno/messaging` (payloads reais do contrato) e a lógica REAL de
 * `campaign-targets.ts` (composição, não isolamento) contra o fake db — é
 * exatamente a "cadeia de duas idempotências distintas que ninguém testou
 * juntas" citada em §2.2.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { WhatsAppInstance } from '@inno/db';
import { getFakeDbState, resetFakeDb, type FakeCampaign, type FakeCampaignTarget, type FakeEvolutionServer, type FakeLead } from '@/test/fake-db';

// Factory ASSÍNCRONA com `import()` dinâmico DENTRO dela — de propósito, não
// estilo. `vi.mock` é hoisted para o topo do arquivo pelo Vitest, ANTES dos
// `import` estáticos serem resolvidos; referenciar um binding importado
// estaticamente (`fakePrismaClient`, `loggerMockFactory`) direto na factory
// quebra com "Cannot access '...' before initialization". `import()` dentro
// da factory adia a resolução para quando a factory É CHAMADA (depois de
// tudo inicializado), e o ESM cacheia o módulo — é a MESMA instância que o
// resto do arquivo usa via `getFakeDbState()`/`resetFakeDb()`.
vi.mock('@inno/db', async () => {
  const { fakePrismaClient } = await import('@/test/fake-db');
  return { prisma: fakePrismaClient };
});
vi.mock('@/lib/logger', async () => {
  const { loggerMockFactory } = await import('@/test/logger-mock');
  return loggerMockFactory();
});
const sendAlertMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/alerts', () => ({ sendAlert: sendAlertMock }));

// Import dinâmico DEPOIS dos `vi.mock` acima — deixa explícito que
// `webhook.ts` só é avaliado depois dos mocks de `@inno/db`/`lib/logger`
// estarem registrados (o `vi.mock` já é hoisted para o topo do arquivo pelo
// Vitest, mas isso deixa a ordem de dependência óbvia na leitura).
const { processEvolutionWebhookEvent, resolveExpectedWebhookApiKeys, isWebhookApiKeyAccepted, extractApiKeyFromBody } = await import('./webhook');
const { encryptEvolutionApiKey } = await import('@inno/sending');

const instance = { id: 'inst-1' } as WhatsAppInstance;

/** Igual a `instance` acima, mas com `status` — as duas checagens NOVAS de `handleConnectionUpdate` (transição/dedupe de alerta) leem `instance.status`. */
function instanceWithStatus(status: string, overrides: Partial<WhatsAppInstance> = {}): WhatsAppInstance {
  return { id: 'inst-1', name: 'Vendas SP', status, ...overrides } as WhatsAppInstance;
}

function lead(overrides: Partial<FakeLead> & Pick<FakeLead, 'id' | 'phoneE164' | 'status'>): FakeLead {
  return { lastSeenAt: new Date(), ...overrides };
}
function target(overrides: Partial<FakeCampaignTarget> & Pick<FakeCampaignTarget, 'id' | 'campaignId' | 'leadId' | 'phoneE164' | 'status'>): FakeCampaignTarget {
  return { skipReason: null, sentAt: null, updatedAt: new Date(), ...overrides };
}
function evolutionServer(overrides: Partial<FakeEvolutionServer> & Pick<FakeEvolutionServer, 'id'>): FakeEvolutionServer {
  const now = new Date();
  return {
    name: 'Servidor 1',
    baseUrl: 'https://evolution1.example.com',
    isActive: true,
    apiKeyCiphertext: Buffer.from(''),
    apiKeyIv: Buffer.from(''),
    apiKeyAuthTag: Buffer.from(''),
    apiKeyKeyVersion: 1,
    createdById: 'user-1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function campaign(overrides: Partial<FakeCampaign> & Pick<FakeCampaign, 'id'>): FakeCampaign {
  return {
    status: 'running',
    sentCount: 0,
    deliveredCount: 0,
    readCount: 0,
    respondedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    haltReason: null,
    instanceIds: [],
    ...overrides,
  };
}

function messagesUpsertPayload(opts: { id: string; remoteJid: string; text: string }) {
  return {
    event: 'messages.upsert',
    instance: 'vendas-01',
    data: {
      key: { id: opts.id, remoteJid: opts.remoteJid, fromMe: false },
      message: { conversation: opts.text },
      pushName: 'Lead de teste',
      messageTimestamp: 1735689600,
    },
  };
}
function messagesUpdatePayload(keyId: string, status: 'PENDING' | 'SERVER_ACK' | 'DELIVERY_ACK' | 'READ' | 'ERROR') {
  return { event: 'messages.update', instance: 'vendas-01', data: { keyId, status } };
}
function connectionUpdateBannedPayload() {
  return { event: 'connection.update', instance: 'vendas-01', data: { state: 'close', statusReason: 401 } };
}
function connectionUpdateGenericClosePayload() {
  return { event: 'connection.update', instance: 'vendas-01', data: { state: 'close', statusReason: 428 } };
}

beforeEach(() => {
  resetFakeDb();
  sendAlertMock.mockClear();
});

describe('processEvolutionWebhookEvent — message_received', () => {
  it('grava a mensagem, avança o lead contacted→responded e fecha o CampaignTarget em voo', async () => {
    resetFakeDb({
      leads: [lead({ id: 'lead-1', phoneE164: '+5511987654321', status: 'contacted' })],
      campaignTargets: [target({ id: 'ct-1', campaignId: 'camp-1', leadId: 'lead-1', phoneE164: '+5511987654321', status: 'sent' })],
      campaigns: [campaign({ id: 'camp-1', sentCount: 1 })],
    });

    await processEvolutionWebhookEvent(
      instance,
      messagesUpsertPayload({ id: 'MSG-1', remoteJid: '5511987654321@s.whatsapp.net', text: 'Oi, tenho interesse' }),
    );

    const state = getFakeDbState();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]!.providerMessageId).toBe('MSG-1');
    expect(state.leads[0]!.status).toBe('responded');
    // sent→responded pula delivered/read — os 3 contadores intermediários avançam retroativamente.
    expect(state.campaigns[0]!.deliveredCount).toBe(1);
    expect(state.campaigns[0]!.readCount).toBe(1);
    expect(state.campaigns[0]!.respondedCount).toBe(1);
    expect(state.campaignTargets[0]!.status).toBe('responded');
  });

  it('idempotência: reenviar o MESMO evento (mesmo providerMessageId) não duplica a Message nem reprocessa a mudança de status/contadores', async () => {
    resetFakeDb({
      leads: [lead({ id: 'lead-1', phoneE164: '+5511987654321', status: 'contacted' })],
      campaignTargets: [target({ id: 'ct-1', campaignId: 'camp-1', leadId: 'lead-1', phoneE164: '+5511987654321', status: 'sent' })],
      campaigns: [campaign({ id: 'camp-1', sentCount: 1 })],
    });
    const payload = messagesUpsertPayload({ id: 'MSG-1', remoteJid: '5511987654321@s.whatsapp.net', text: 'Oi, tenho interesse' });

    await processEvolutionWebhookEvent(instance, payload);
    await processEvolutionWebhookEvent(instance, payload); // reenvio (retry real da Evolution)

    const state = getFakeDbState();
    expect(state.messages).toHaveLength(1); // não duplicou
    expect(state.leads[0]!.status).toBe('responded'); // não regrediu nem reprocessou
    expect(state.campaigns[0]!.deliveredCount).toBe(1); // não contou de novo
    expect(state.campaigns[0]!.readCount).toBe(1);
    expect(state.campaigns[0]!.respondedCount).toBe(1);
  });

  it('mensagem inbound sem Lead correspondente não lança — só é ignorada', async () => {
    resetFakeDb(); // nenhum lead cadastrado

    await expect(
      processEvolutionWebhookEvent(instance, messagesUpsertPayload({ id: 'MSG-1', remoteJid: '5599999999999@s.whatsapp.net', text: 'oi' })),
    ).resolves.not.toThrow();

    expect(getFakeDbState().messages).toHaveLength(0);
  });

  it('opt-out detectado no texto cria OptOut e reflete no CampaignTarget pending do mesmo telefone, NA MESMA transação', async () => {
    resetFakeDb({
      leads: [lead({ id: 'lead-2', phoneE164: '+5521998887777', status: 'contacted' })],
      campaignTargets: [target({ id: 'ct-2', campaignId: 'camp-2', leadId: 'lead-2', phoneE164: '+5521998887777', status: 'pending' })],
      campaigns: [campaign({ id: 'camp-2' })],
    });

    await processEvolutionWebhookEvent(
      instance,
      messagesUpsertPayload({ id: 'MSG-OPTOUT-1', remoteJid: '5521998887777@s.whatsapp.net', text: 'Quero sair da lista, obrigado' }),
    );

    const state = getFakeDbState();
    expect(state.optOuts).toHaveLength(1);
    expect(state.optOuts[0]!.phoneE164).toBe('+5521998887777');
    expect(state.optOuts[0]!.source).toBe('reply');
    expect(state.campaignTargets[0]!.status).toBe('skipped');
    expect(state.campaigns[0]!.skippedCount).toBe(1);
    expect(state.leadActivities.some((a) => a.type === 'opt_out')).toBe(true);
  });

  it('opt-out automático é idempotente: reprocessar o mesmo evento não cria um segundo OptOut nem repete o efeito retroativo (cadeia das 2 idempotências, REVISAO-QA §2.2)', async () => {
    resetFakeDb({
      leads: [lead({ id: 'lead-2', phoneE164: '+5521998887777', status: 'contacted' })],
      campaignTargets: [target({ id: 'ct-2', campaignId: 'camp-2', leadId: 'lead-2', phoneE164: '+5521998887777', status: 'pending' })],
      campaigns: [campaign({ id: 'camp-2' })],
    });
    const payload = messagesUpsertPayload({ id: 'MSG-OPTOUT-1', remoteJid: '5521998887777@s.whatsapp.net', text: 'Quero sair da lista, obrigado' });

    await processEvolutionWebhookEvent(instance, payload);
    await processEvolutionWebhookEvent(instance, payload); // reenvio

    const state = getFakeDbState();
    expect(state.optOuts).toHaveLength(1); // não duplicou o OptOut
    expect(state.campaigns[0]!.skippedCount).toBe(1); // não incrementou de novo
    expect(state.leadActivities.filter((a) => a.type === 'opt_out')).toHaveLength(1); // não duplicou a auditoria
  });

  it('mensagem de grupo (@g.us) é ignorada, mesmo contendo palavra-gatilho de opt-out', async () => {
    resetFakeDb({ leads: [lead({ id: 'lead-3', phoneE164: '+5511900000000', status: 'contacted' })] });

    await processEvolutionWebhookEvent(instance, {
      event: 'messages.upsert',
      instance: 'vendas-01',
      data: {
        key: { id: 'MSG-GROUP-1', remoteJid: '123456-group@g.us', fromMe: false },
        message: { conversation: 'quero sair do grupo' },
        pushName: 'Alguém',
        messageTimestamp: 1735689600,
      },
    });

    expect(getFakeDbState().messages).toHaveLength(0);
    expect(getFakeDbState().optOuts).toHaveLength(0);
  });
});

describe('processEvolutionWebhookEvent — message_status', () => {
  it('atualiza o status da Message e avança o CampaignTarget correspondente', async () => {
    resetFakeDb({
      messages: [
        {
          id: 'msg-1',
          leadId: 'lead-1',
          instanceId: 'inst-1',
          direction: 'outbound',
          body: 'oi',
          providerMessageId: 'PMID-1',
          status: 'sent',
          campaignTargetId: 'ct-1',
          createdAt: new Date(),
          deliveredAt: null,
          readAt: null,
          errorCode: null,
        },
      ],
      campaignTargets: [target({ id: 'ct-1', campaignId: 'camp-1', leadId: 'lead-1', phoneE164: '+5511987654321', status: 'sent' })],
      campaigns: [campaign({ id: 'camp-1', sentCount: 1 })],
    });

    await processEvolutionWebhookEvent(instance, messagesUpdatePayload('PMID-1', 'DELIVERY_ACK'));

    const state = getFakeDbState();
    expect(state.messages[0]!.status).toBe('delivered');
    expect(state.messages[0]!.deliveredAt).not.toBeNull();
    expect(state.campaignTargets[0]!.status).toBe('delivered');
    expect(state.campaigns[0]!.deliveredCount).toBe(1);
    expect(state.campaigns[0]!.sentCount).toBe(1); // não contou sent de novo
  });

  it('evento messages.update para providerMessageId DESCONHECIDO não lança — é descartado (documenta o comportamento atual, REVISAO-QA §2.2/§5.4)', async () => {
    resetFakeDb();

    await expect(processEvolutionWebhookEvent(instance, messagesUpdatePayload('ID-NUNCA-VISTO', 'READ'))).resolves.not.toThrow();

    expect(getFakeDbState().messages).toHaveLength(0);
  });
});

describe('processEvolutionWebhookEvent — connection_update (kill switch)', () => {
  it('conexão banida marca a instância como banned e halta só as campanhas que usam SÓ ela', async () => {
    resetFakeDb({
      whatsAppInstances: [
        { id: 'inst-1', status: 'connected', isDegraded: false, consecutiveFailures: 0, lastConnectionAt: new Date(), lastErrorAt: null, lastErrorMessage: null },
      ],
      campaigns: [
        campaign({ id: 'camp-sole', status: 'running', instanceIds: ['inst-1'] }),
        campaign({ id: 'camp-shared', status: 'running', instanceIds: ['inst-1', 'inst-2'] }),
      ],
    });

    await processEvolutionWebhookEvent(instance, connectionUpdateBannedPayload());

    const state = getFakeDbState();
    expect(state.whatsAppInstances[0]!.status).toBe('banned');
    expect(state.campaigns.find((c) => c.id === 'camp-sole')?.status).toBe('halted');
    expect(state.campaigns.find((c) => c.id === 'camp-shared')?.status).toBe('running');
  });

  it('alerta instance_disconnected na transição connected → banned (achado do dono, 2026-09-23: instância cair era silencioso)', async () => {
    resetFakeDb({
      whatsAppInstances: [
        { id: 'inst-1', status: 'connected', isDegraded: false, consecutiveFailures: 0, lastConnectionAt: new Date(), lastErrorAt: null, lastErrorMessage: null },
      ],
    });

    await processEvolutionWebhookEvent(instanceWithStatus('connected'), connectionUpdateBannedPayload());

    expect(sendAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'instance_disconnected', instanceId: 'inst-1', reason: 'banned' }),
    );
  });

  it('alerta instance_disconnected na transição connected → disconnected (fechamento genérico)', async () => {
    resetFakeDb({
      whatsAppInstances: [
        { id: 'inst-1', status: 'connected', isDegraded: false, consecutiveFailures: 0, lastConnectionAt: new Date(), lastErrorAt: null, lastErrorMessage: null },
      ],
    });

    await processEvolutionWebhookEvent(instanceWithStatus('connected'), connectionUpdateGenericClosePayload());

    expect(sendAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'instance_disconnected', instanceId: 'inst-1', reason: 'disconnected' }),
    );
  });

  it('NÃO realerta quando a Evolution reenvia connection.update com o MESMO estado (instância já estava banned) — evita 1 alerta por evento redundante', async () => {
    resetFakeDb({
      whatsAppInstances: [
        { id: 'inst-1', status: 'banned', isDegraded: false, consecutiveFailures: 0, lastConnectionAt: null, lastErrorAt: new Date(), lastErrorMessage: 'já banida' },
      ],
    });

    await processEvolutionWebhookEvent(instanceWithStatus('banned'), connectionUpdateBannedPayload());

    expect(sendAlertMock).not.toHaveBeenCalled();
  });

  it('NÃO alerta quando a conexão fica "connecting" (não é uma queda)', async () => {
    resetFakeDb({
      whatsAppInstances: [
        { id: 'inst-1', status: 'qr_pending', isDegraded: false, consecutiveFailures: 0, lastConnectionAt: null, lastErrorAt: null, lastErrorMessage: null },
      ],
    });

    await processEvolutionWebhookEvent(
      instanceWithStatus('qr_pending'),
      { event: 'connection.update', instance: 'vendas-01', data: { state: 'connecting', statusReason: null } },
    );

    expect(sendAlertMock).not.toHaveBeenCalled();
  });
});

/** Instância com credencial PRÓPRIA já cifrada — helper para não repetir os 4 campos em cada teste do bloco de correção do webhook mudo. */
function instanceWithOwnApiKey(overrides: { id: string; evolutionServerId?: string | null }, apiKey: string): WhatsAppInstance {
  const encrypted = encryptEvolutionApiKey(apiKey, process.env);
  return {
    evolutionServerId: null,
    ...overrides,
    instanceApiKeyCiphertext: encrypted.ciphertext,
    instanceApiKeyIv: encrypted.iv,
    instanceApiKeyAuthTag: encrypted.authTag,
    instanceApiKeyKeyVersion: encrypted.keyVersion,
  } as unknown as WhatsAppInstance;
}

/** Mesma instância, mas SEM credencial própria (legado/captura falhou) — os 4 campos nascem `null` no Postgres real. */
function instanceWithoutOwnApiKey(overrides: { id: string; evolutionServerId?: string | null }): WhatsAppInstance {
  return {
    evolutionServerId: null,
    ...overrides,
    instanceApiKeyCiphertext: null,
    instanceApiKeyIv: null,
    instanceApiKeyAuthTag: null,
    instanceApiKeyKeyVersion: null,
  } as unknown as WhatsAppInstance;
}

describe('resolveExpectedWebhookApiKeys — 🆕 correção do webhook mudo (2026-09-23): aceita a chave PRÓPRIA da instância E a do servidor', () => {
  const MASTER_KEY = randomBytes(32).toString('base64');

  beforeEach(() => {
    resetFakeDb();
    process.env.EVOLUTION_MASTER_KEY = MASTER_KEY;
    delete process.env.EVOLUTION_MASTER_KEY_VERSION;
  });

  afterEach(() => {
    delete process.env.EVOLUTION_MASTER_KEY;
    delete process.env.EVOLUTION_API_KEY;
  });

  it('instância COM credencial própria E servidor — devolve as DUAS chaves como candidatas (nunca escolhe uma só)', async () => {
    const encryptedServer = encryptEvolutionApiKey('chave-secreta-do-servidor-1', process.env);
    resetFakeDb({
      evolutionServers: [
        evolutionServer({
          id: 'srv-1',
          apiKeyCiphertext: encryptedServer.ciphertext,
          apiKeyIv: encryptedServer.iv,
          apiKeyAuthTag: encryptedServer.authTag,
          apiKeyKeyVersion: encryptedServer.keyVersion,
        }),
      ],
    });

    const result = await resolveExpectedWebhookApiKeys(instanceWithOwnApiKey({ id: 'inst-1', evolutionServerId: 'srv-1' }, 'chave-propria-da-instancia'));

    expect(result).toEqual(expect.arrayContaining(['chave-propria-da-instancia', 'chave-secreta-do-servidor-1']));
    expect(result).toHaveLength(2);
  });

  it('instância SEM evolutionServerId (legada) — cai no fallback EVOLUTION_API_KEY (env), mesmo comportamento pré-Fase-4.B', async () => {
    process.env.EVOLUTION_API_KEY = 'chave-global-legada';

    const result = await resolveExpectedWebhookApiKeys(instanceWithoutOwnApiKey({ id: 'inst-1', evolutionServerId: null }));

    expect(result).toEqual(['chave-global-legada']);
  });

  it('instância SEM evolutionServerId e SEM EVOLUTION_API_KEY configurada — devolve [] (fail-closed, nunca deixa passar por falta de configuração)', async () => {
    delete process.env.EVOLUTION_API_KEY;

    const result = await resolveExpectedWebhookApiKeys(instanceWithoutOwnApiKey({ id: 'inst-1', evolutionServerId: null }));

    expect(result).toEqual([]);
  });

  it('servidor referenciado está DESATIVADO e instância SEM credencial própria — devolve [] (mesmo com a credencial do servidor existindo e sendo decifrável)', async () => {
    const encrypted = encryptEvolutionApiKey('chave-servidor-desativado', process.env);
    resetFakeDb({
      evolutionServers: [
        evolutionServer({
          id: 'srv-1',
          isActive: false,
          apiKeyCiphertext: encrypted.ciphertext,
          apiKeyIv: encrypted.iv,
          apiKeyAuthTag: encrypted.authTag,
          apiKeyKeyVersion: encrypted.keyVersion,
        }),
      ],
    });

    const result = await resolveExpectedWebhookApiKeys(instanceWithoutOwnApiKey({ id: 'inst-1', evolutionServerId: 'srv-1' }));

    expect(result).toEqual([]);
  });

  it('servidor DESATIVADO mas instância TEM credencial própria — a própria ainda é aceita (uma fonte falhar nunca derruba a outra)', async () => {
    resetFakeDb({ evolutionServers: [evolutionServer({ id: 'srv-1', isActive: false })] });

    const result = await resolveExpectedWebhookApiKeys(instanceWithOwnApiKey({ id: 'inst-1', evolutionServerId: 'srv-1' }, 'chave-propria-sobrevive'));

    expect(result).toEqual(['chave-propria-sobrevive']);
  });

  it('evolutionServerId aponta para um servidor que não existe (inconsistência de dados) — devolve [], não lança', async () => {
    resetFakeDb({ evolutionServers: [] });

    const result = await resolveExpectedWebhookApiKeys(instanceWithoutOwnApiKey({ id: 'inst-1', evolutionServerId: 'srv-inexistente' }));

    expect(result).toEqual([]);
  });

  it('chave-mestre ERRADA (rotação mal feita) na credencial da instância — decifra falha, OMITIDA da lista (não lança, não derruba a chave do servidor)', async () => {
    const encryptedInstance = encryptEvolutionApiKey('chave-instancia-qualquer', process.env);
    const badInstance = {
      id: 'inst-1',
      evolutionServerId: null,
      instanceApiKeyCiphertext: encryptedInstance.ciphertext,
      instanceApiKeyIv: encryptedInstance.iv,
      instanceApiKeyAuthTag: encryptedInstance.authTag,
      instanceApiKeyKeyVersion: encryptedInstance.keyVersion,
    } as unknown as WhatsAppInstance;
    // Troca a chave-mestre DEPOIS de cifrar — simula "EVOLUTION_MASTER_KEY errada no ambiente".
    process.env.EVOLUTION_MASTER_KEY = randomBytes(32).toString('base64');
    process.env.EVOLUTION_API_KEY = 'chave-global-ainda-valida';

    const result = await resolveExpectedWebhookApiKeys(badInstance);

    expect(result).toEqual(['chave-global-ainda-valida']);
  });

  it('dois servidores DIFERENTES têm chaves DIFERENTES — a chave de um nunca resolve para outro (webhook de um servidor não pode ser aceito com a chave de outro)', async () => {
    const encrypted1 = encryptEvolutionApiKey('chave-servidor-1', process.env);
    const encrypted2 = encryptEvolutionApiKey('chave-servidor-2', process.env);
    resetFakeDb({
      evolutionServers: [
        evolutionServer({ id: 'srv-1', apiKeyCiphertext: encrypted1.ciphertext, apiKeyIv: encrypted1.iv, apiKeyAuthTag: encrypted1.authTag, apiKeyKeyVersion: encrypted1.keyVersion }),
        evolutionServer({ id: 'srv-2', baseUrl: 'https://evolution2.example.com', apiKeyCiphertext: encrypted2.ciphertext, apiKeyIv: encrypted2.iv, apiKeyAuthTag: encrypted2.authTag, apiKeyKeyVersion: encrypted2.keyVersion }),
      ],
    });

    const key1 = await resolveExpectedWebhookApiKeys(instanceWithoutOwnApiKey({ id: 'inst-1', evolutionServerId: 'srv-1' }));
    const key2 = await resolveExpectedWebhookApiKeys(instanceWithoutOwnApiKey({ id: 'inst-2', evolutionServerId: 'srv-2' }));

    expect(key1).toEqual(['chave-servidor-1']);
    expect(key2).toEqual(['chave-servidor-2']);
  });
});

describe('isWebhookApiKeyAccepted — decisão real que a rota usa (@inno/messaging#constantTimeEqual contra cada candidata)', () => {
  const MASTER_KEY = randomBytes(32).toString('base64');

  beforeEach(() => {
    resetFakeDb();
    process.env.EVOLUTION_MASTER_KEY = MASTER_KEY;
  });

  afterEach(() => {
    delete process.env.EVOLUTION_MASTER_KEY;
    delete process.env.EVOLUTION_API_KEY;
  });

  it('webhook ACEITO com a chave da INSTÂNCIA (servidor tem uma credencial DIFERENTE) — cenário central do incidente', async () => {
    const encryptedServer = encryptEvolutionApiKey('chave-do-servidor', process.env);
    resetFakeDb({
      evolutionServers: [
        evolutionServer({ id: 'srv-1', apiKeyCiphertext: encryptedServer.ciphertext, apiKeyIv: encryptedServer.iv, apiKeyAuthTag: encryptedServer.authTag, apiKeyKeyVersion: encryptedServer.keyVersion }),
      ],
    });
    const instance = instanceWithOwnApiKey({ id: 'inst-1', evolutionServerId: 'srv-1' }, 'chave-da-instancia');

    await expect(isWebhookApiKeyAccepted(instance, ['chave-da-instancia'])).resolves.toBe(true);
  });

  it('webhook ACEITO com a chave GLOBAL do servidor (instância sem credencial própria — legada)', async () => {
    const encryptedServer = encryptEvolutionApiKey('chave-do-servidor', process.env);
    resetFakeDb({
      evolutionServers: [
        evolutionServer({ id: 'srv-1', apiKeyCiphertext: encryptedServer.ciphertext, apiKeyIv: encryptedServer.iv, apiKeyAuthTag: encryptedServer.authTag, apiKeyKeyVersion: encryptedServer.keyVersion }),
      ],
    });
    const instance = instanceWithoutOwnApiKey({ id: 'inst-1', evolutionServerId: 'srv-1' });

    await expect(isWebhookApiKeyAccepted(instance, ['chave-do-servidor'])).resolves.toBe(true);
  });

  it('webhook RECUSADO com chave ERRADA (não bate com a própria nem com a do servidor)', async () => {
    const encryptedServer = encryptEvolutionApiKey('chave-do-servidor', process.env);
    resetFakeDb({
      evolutionServers: [
        evolutionServer({ id: 'srv-1', apiKeyCiphertext: encryptedServer.ciphertext, apiKeyIv: encryptedServer.iv, apiKeyAuthTag: encryptedServer.authTag, apiKeyKeyVersion: encryptedServer.keyVersion }),
      ],
    });
    const instance = instanceWithOwnApiKey({ id: 'inst-1', evolutionServerId: 'srv-1' }, 'chave-da-instancia');

    await expect(isWebhookApiKeyAccepted(instance, ['chave-completamente-errada'])).resolves.toBe(false);
  });

  it('instância LEGADA sem chave própria guardada continua funcionando pela chave global (env, evolutionServerId null)', async () => {
    process.env.EVOLUTION_API_KEY = 'chave-global-legada-env';
    const instance = instanceWithoutOwnApiKey({ id: 'inst-1', evolutionServerId: null });

    await expect(isWebhookApiKeyAccepted(instance, ['chave-global-legada-env'])).resolves.toBe(true);
  });

  it('nenhuma candidata recebida (nem cabeçalho nem corpo) — RECUSADO, fail-closed, sem lançar', async () => {
    process.env.EVOLUTION_API_KEY = 'chave-global-legada-env';
    const instance = instanceWithoutOwnApiKey({ id: 'inst-1', evolutionServerId: null });

    await expect(isWebhookApiKeyAccepted(instance, [])).resolves.toBe(false);
  });

  it('🆕 incidente #2 (2026-09-23): ACEITO quando a chave vem só no CORPO (cabeçalho ausente/errado) — a Evolution v2.3.7 pode assinar assim', async () => {
    process.env.EVOLUTION_API_KEY = 'chave-global-legada-env';
    const instance = instanceWithoutOwnApiKey({ id: 'inst-1', evolutionServerId: null });

    // simula a rota: header não bateu (vazio/errado), só a candidata do corpo é passada.
    await expect(isWebhookApiKeyAccepted(instance, ['chave-global-legada-env'])).resolves.toBe(true);
  });

  it('ACEITO quando a chave vem só no CABEÇALHO e a do CORPO está errada — as duas fontes são candidatas independentes', async () => {
    process.env.EVOLUTION_API_KEY = 'chave-global-legada-env';
    const instance = instanceWithoutOwnApiKey({ id: 'inst-1', evolutionServerId: null });

    await expect(isWebhookApiKeyAccepted(instance, ['chave-global-legada-env', 'chave-do-corpo-errada'])).resolves.toBe(true);
  });

  it('RECUSADO quando NENHUMA das duas candidatas (cabeçalho e corpo) bate', async () => {
    process.env.EVOLUTION_API_KEY = 'chave-global-legada-env';
    const instance = instanceWithoutOwnApiKey({ id: 'inst-1', evolutionServerId: null });

    await expect(isWebhookApiKeyAccepted(instance, ['chave-errada-do-header', 'chave-errada-do-corpo'])).resolves.toBe(false);
  });
});

describe('extractApiKeyFromBody — leitura defensiva da apikey no CORPO do webhook (🆕 incidente #2, 2026-09-23)', () => {
  it('extrai a apikey quando presente no corpo, junto dos outros campos do evento', () => {
    expect(extractApiKeyFromBody({ apikey: 'chave-do-corpo', event: 'messages.upsert', instance: 'vendas-01', data: {} })).toBe('chave-do-corpo');
  });

  it('devolve null quando o campo apikey não existe no corpo', () => {
    expect(extractApiKeyFromBody({ event: 'messages.upsert', instance: 'vendas-01', data: {} })).toBeNull();
  });

  it('devolve null quando apikey não é string (payload malformado) — nunca lança', () => {
    expect(extractApiKeyFromBody({ apikey: 12345 })).toBeNull();
    expect(extractApiKeyFromBody({ apikey: null })).toBeNull();
    expect(extractApiKeyFromBody({ apikey: '' })).toBeNull();
  });

  it('devolve null para corpo não-objeto (string, número, null, array) — nunca lança', () => {
    expect(extractApiKeyFromBody('string qualquer')).toBeNull();
    expect(extractApiKeyFromBody(123)).toBeNull();
    expect(extractApiKeyFromBody(null)).toBeNull();
    expect(extractApiKeyFromBody(undefined)).toBeNull();
  });
});
