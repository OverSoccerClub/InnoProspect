/**
 * retention.job.test.ts — ARQUITETURA §7.5/§6.9 (Fase 5.3). O job mais
 * destrutivo do sistema: os testes aqui existem para provar que ele NÃO
 * apaga o que não deveria, muito mais do que para provar que ele apaga o
 * que deveria. Ver o cabeçalho de `retention.job.ts` para as 3 camadas de
 * segurança que cada teste abaixo exercita.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RetentionConfig } from '../lib/retention-config.js';
import {
  fakePrismaClient,
  getFakeRetentionDbState,
  resetFakeRetentionDb,
  type FakeLead,
  type FakeMessage,
} from '../test/fake-retention-db.js';

const { runRetention } = await import('./retention.job.js');

// 2026-09-26 — mesma data "hoje" da rodada em que este job foi escrito.
const NOW = new Date('2026-09-26T03:00:00.000Z');

function baseConfig(overrides: Partial<RetentionConfig> = {}): RetentionConfig {
  return {
    dryRun: true,
    leadRetentionMonths: 24,
    messageBodyRetentionMonths: 12,
    maxLeadDeletesPerRun: 500,
    maxMessageRedactionsPerRun: 5000,
    ...overrides,
  };
}

function makeDeps(config: RetentionConfig, notify = vi.fn()) {
  return {
    prisma: fakePrismaClient as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    notify,
    now: () => NOW,
    config,
  };
}

function lead(overrides: Partial<FakeLead> & Pick<FakeLead, 'id' | 'collectedAt'>): FakeLead {
  return { ...overrides };
}

function message(overrides: Partial<FakeMessage> & Pick<FakeMessage, 'id' | 'leadId' | 'createdAt'>): FakeMessage {
  return {
    body: 'Olá, tudo bem?',
    direction: 'outbound',
    status: 'sent',
    instanceId: 'inst-1',
    contentRedactedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  resetFakeRetentionDb();
});

describe('retention.job — exclusão de Lead (24 meses)', () => {
  it('lead DENTRO do prazo (coletado há poucos meses, sem interação) NÃO é apagado — pega predicado invertido', async () => {
    resetFakeRetentionDb({ leads: [lead({ id: 'lead-recente', collectedAt: new Date('2026-06-01T00:00:00.000Z') })] });

    await runRetention(makeDeps(baseConfig({ dryRun: false })));

    expect(getFakeRetentionDbState().leads).toHaveLength(1);
  });

  it('lead com INTERAÇÃO RECENTE e coleta ANTIGA não é apagado — a regra que mais se erra (contar só collectedAt)', async () => {
    resetFakeRetentionDb({
      leads: [lead({ id: 'lead-antigo-mas-ativo', collectedAt: new Date('2020-01-01T00:00:00.000Z') })],
      messages: [message({ id: 'msg-1', leadId: 'lead-antigo-mas-ativo', createdAt: new Date('2026-08-01T00:00:00.000Z') })],
    });

    const result = await runRetention(makeDeps(baseConfig({ dryRun: false })));

    expect(getFakeRetentionDbState().leads).toHaveLength(1);
    expect(result.lead.applied).toBe(0);
  });

  it('lead SEM NENHUMA interação (zero Message) e coletado há mais de 24 meses é apagado', async () => {
    resetFakeRetentionDb({ leads: [lead({ id: 'lead-expirado', collectedAt: new Date('2023-01-01T00:00:00.000Z') })] });

    const result = await runRetention(makeDeps(baseConfig({ dryRun: false })));

    expect(getFakeRetentionDbState().leads).toHaveLength(0);
    expect(result.lead.applied).toBe(1);
    expect(result.lead.noInteractionCount).toBe(1);
    expect(result.lead.withInteractionCount).toBe(0);
  });

  it('lead com INTERAÇÃO, mas a última interação também já passou de 24 meses, É apagado (a regra positiva da 2ª linha da tabela) — e o cascade leva a Message junto', async () => {
    resetFakeRetentionDb({
      leads: [lead({ id: 'lead-conversa-antiga', collectedAt: new Date('2023-01-01T00:00:00.000Z') })],
      messages: [message({ id: 'msg-1', leadId: 'lead-conversa-antiga', createdAt: new Date('2023-06-01T00:00:00.000Z') })],
    });

    const result = await runRetention(makeDeps(baseConfig({ dryRun: false })));

    expect(getFakeRetentionDbState().leads).toHaveLength(0);
    expect(getFakeRetentionDbState().messages).toHaveLength(0); // cascade — Message.leadId onDelete: Cascade
    expect(result.lead.withInteractionCount).toBe(1);
    expect(result.lead.noInteractionCount).toBe(0);
  });
});

describe('retention.job — OptOut nunca é tocado', () => {
  it('OptOut sobrevive a uma rodada que de fato apaga leads — a lista fica EXATAMENTE igual', async () => {
    resetFakeRetentionDb({
      leads: [lead({ id: 'lead-expirado', collectedAt: new Date('2023-01-01T00:00:00.000Z') })],
      optOuts: [{ id: 'opt-1', phoneE164: '+5511987654321', leadId: 'lead-expirado' }],
    });

    await runRetention(makeDeps(baseConfig({ dryRun: false })));

    // Nem o Lead apagado leva o OptOut — o fake nem declara `optOut.delete`;
    // se o job algum dia chamasse isso, o teste já teria explodido antes
    // desta asserção (ver comentário no cabeçalho de `fake-retention-db.ts`).
    expect(getFakeRetentionDbState().optOuts).toEqual([{ id: 'opt-1', phoneE164: '+5511987654321', leadId: 'lead-expirado' }]);
  });
});

describe('retention.job — redação de conteúdo de Message (12 meses)', () => {
  it('mensagem com mais de 12 meses perde o body e GANHA contentRedactedAt, mas mantém os metadados', async () => {
    resetFakeRetentionDb({
      leads: [lead({ id: 'lead-1', collectedAt: new Date('2026-01-01T00:00:00.000Z') })],
      messages: [
        message({
          id: 'msg-velha',
          leadId: 'lead-1',
          body: 'Proposta comercial completa aqui.',
          direction: 'outbound',
          status: 'delivered',
          instanceId: 'inst-42',
          createdAt: new Date('2025-01-01T00:00:00.000Z'),
        }),
      ],
    });

    const result = await runRetention(makeDeps(baseConfig({ dryRun: false })));

    const msg = getFakeRetentionDbState().messages.find((m) => m.id === 'msg-velha')!;
    expect(msg.body).toBe('');
    expect(msg.contentRedactedAt).toEqual(NOW);
    // Metadados agregados intactos — é literalmente o que "mantém metadados" significa.
    expect(msg.direction).toBe('outbound');
    expect(msg.status).toBe('delivered');
    expect(msg.instanceId).toBe('inst-42');
    expect(result.message.applied).toBe(1);
  });

  it('mensagem já redigida (contentRedactedAt preenchido) NUNCA é reprocessada — idempotência', async () => {
    resetFakeRetentionDb({
      messages: [
        message({
          id: 'msg-ja-redigida',
          leadId: 'lead-1',
          body: '',
          createdAt: new Date('2025-01-01T00:00:00.000Z'),
          contentRedactedAt: new Date('2025-06-01T00:00:00.000Z'),
        }),
      ],
    });

    const result = await runRetention(makeDeps(baseConfig({ dryRun: false })));

    expect(result.message.candidateCount).toBe(0);
    expect(result.message.applied).toBe(0);
  });

  it('mensagem dentro dos 12 meses não é tocada', async () => {
    resetFakeRetentionDb({
      messages: [message({ id: 'msg-recente', leadId: 'lead-1', createdAt: new Date('2026-08-01T00:00:00.000Z') })],
    });

    await runRetention(makeDeps(baseConfig({ dryRun: false })));

    const msg = getFakeRetentionDbState().messages[0]!;
    expect(msg.body).toBe('Olá, tudo bem?');
    expect(msg.contentRedactedAt).toBeNull();
  });
});

describe('retention.job — modo de simulação (dryRun) não escreve NADA', () => {
  it('com candidatos reais dos DOIS lados, dryRun=true não altera o banco em nenhum campo', async () => {
    resetFakeRetentionDb({
      leads: [lead({ id: 'lead-expirado', collectedAt: new Date('2023-01-01T00:00:00.000Z') })],
      // `leadId` PROPOSITALMENTE de outro lead (não seedado) — decoupled do
      // candidato de exclusão acima. Se a mensagem apontasse para
      // `lead-expirado`, a data desta mensagem passaria a ser a "última
      // interação" DELE (mais recente que `collectedAt`), e ele deixaria de
      // ser candidato à exclusão — o que provaria as duas regras
      // independentemente é exatamente o ponto deste teste.
      messages: [message({ id: 'msg-velha', leadId: 'lead-outro', createdAt: new Date('2025-01-01T00:00:00.000Z') })],
    });
    const notify = vi.fn();

    const result = await runRetention(makeDeps(baseConfig({ dryRun: true }), notify));

    // A prova é olhar o BANCO (o requisito explícito do escopo), não só a flag:
    expect(getFakeRetentionDbState().leads).toEqual([{ id: 'lead-expirado', collectedAt: new Date('2023-01-01T00:00:00.000Z') }]);
    const msg = getFakeRetentionDbState().messages[0]!;
    expect(msg.body).toBe('Olá, tudo bem?');
    expect(msg.contentRedactedAt).toBeNull();
    // A CONTAGEM roda de verdade mesmo em simulação — é o que sustenta "diz o que faria antes de fazer".
    expect(result.lead.candidateCount).toBe(1);
    expect(result.message.candidateCount).toBe(1);
    expect(result.lead.applied).toBe(0);
    expect(result.message.applied).toBe(0);
    // Simulação nunca alerta "rodada aplicada" (só logs) — não é o tipo de evento que paga alguém.
    expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'retention_run_completed' }));
  });
});

describe('retention.job — teto de segurança', () => {
  it('candidatos de exclusão de Lead ACIMA do teto interrompem a rodada — zero leads apagados, alerta crítico', async () => {
    resetFakeRetentionDb({
      leads: [
        lead({ id: 'lead-1', collectedAt: new Date('2023-01-01T00:00:00.000Z') }),
        lead({ id: 'lead-2', collectedAt: new Date('2023-01-01T00:00:00.000Z') }),
      ],
    });
    const notify = vi.fn();

    const result = await runRetention(makeDeps(baseConfig({ dryRun: false, maxLeadDeletesPerRun: 1 }), notify));

    expect(getFakeRetentionDbState().leads).toHaveLength(2); // NENHUM foi apagado, nem o que estaria "dentro" do teto
    expect(result.lead.applied).toBe(0);
    expect(result.lead.cappedOut).toBe(true);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'retention_safety_cap_exceeded', target: 'lead_deletion', cap: 1 }),
    );
  });

  it('candidatos de redação de Message ACIMA do teto interrompem a rodada — zero mensagens redigidas, alerta crítico', async () => {
    resetFakeRetentionDb({
      messages: [
        message({ id: 'msg-1', leadId: 'lead-1', createdAt: new Date('2025-01-01T00:00:00.000Z') }),
        message({ id: 'msg-2', leadId: 'lead-1', createdAt: new Date('2025-01-01T00:00:00.000Z') }),
      ],
    });
    const notify = vi.fn();

    const result = await runRetention(makeDeps(baseConfig({ dryRun: false, maxMessageRedactionsPerRun: 1 }), notify));

    expect(getFakeRetentionDbState().messages.every((m) => m.body !== '')).toBe(true);
    expect(result.message.applied).toBe(0);
    expect(result.message.cappedOut).toBe(true);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'retention_safety_cap_exceeded', target: 'message_body_redaction', cap: 1 }),
    );
  });

  it('o teto ultrapassado alerta MESMO em modo de simulação — é ali que um predicado quebrado precisa ser pego', async () => {
    resetFakeRetentionDb({
      leads: [
        lead({ id: 'lead-1', collectedAt: new Date('2023-01-01T00:00:00.000Z') }),
        lead({ id: 'lead-2', collectedAt: new Date('2023-01-01T00:00:00.000Z') }),
      ],
    });
    const notify = vi.fn();

    await runRetention(makeDeps(baseConfig({ dryRun: true, maxLeadDeletesPerRun: 1 }), notify));

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'retention_safety_cap_exceeded', target: 'lead_deletion' }));
  });
});

describe('retention.job — alerta de rodada aplicada', () => {
  it('dispara retention_run_completed só quando algo de fato foi apagado/redigido em modo aplicado', async () => {
    resetFakeRetentionDb({
      leads: [lead({ id: 'lead-expirado', collectedAt: new Date('2023-01-01T00:00:00.000Z') })],
    });
    const notify = vi.fn();

    await runRetention(makeDeps(baseConfig({ dryRun: false }), notify));

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'retention_run_completed', leadsDeleted: 1, messagesRedacted: 0 }),
    );
  });

  it('rodada aplicada sem NENHUM candidato não dispara alerta nenhum', async () => {
    resetFakeRetentionDb();
    const notify = vi.fn();

    await runRetention(makeDeps(baseConfig({ dryRun: false }), notify));

    expect(notify).not.toHaveBeenCalled();
  });
});
