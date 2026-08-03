/**
 * webhook.test.ts — REVISAO-QA.md §4 prioridade #2: idempotência do webhook
 * é o tipo de bug que só aparece em produção sob reenvio real da Evolution
 * API — impossível de pegar manualmente. Usa o parser REAL de
 * `@inno/messaging` (payloads reais do contrato) e a lógica REAL de
 * `campaign-targets.ts` (composição, não isolamento) contra o fake db — é
 * exatamente a "cadeia de duas idempotências distintas que ninguém testou
 * juntas" citada em §2.2.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WhatsAppInstance } from '@inno/db';
import { getFakeDbState, resetFakeDb, type FakeCampaign, type FakeCampaignTarget, type FakeLead } from '@/test/fake-db';

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

// Import dinâmico DEPOIS dos `vi.mock` acima — deixa explícito que
// `webhook.ts` só é avaliado depois dos mocks de `@inno/db`/`lib/logger`
// estarem registrados (o `vi.mock` já é hoisted para o topo do arquivo pelo
// Vitest, mas isso deixa a ordem de dependência óbvia na leitura).
const { processEvolutionWebhookEvent } = await import('./webhook');

const instance = { id: 'inst-1' } as WhatsAppInstance;

function lead(overrides: Partial<FakeLead> & Pick<FakeLead, 'id' | 'phoneE164' | 'status'>): FakeLead {
  return { lastSeenAt: new Date(), ...overrides };
}
function target(overrides: Partial<FakeCampaignTarget> & Pick<FakeCampaignTarget, 'id' | 'campaignId' | 'leadId' | 'phoneE164' | 'status'>): FakeCampaignTarget {
  return { skipReason: null, sentAt: null, updatedAt: new Date(), ...overrides };
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

beforeEach(() => {
  resetFakeDb();
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
});
