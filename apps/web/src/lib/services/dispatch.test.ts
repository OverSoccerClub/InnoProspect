/**
 * dispatch.test.ts — o freio global do motor (ARQUITETURA §6.8.9).
 *
 * Por que este arquivo existe: a Íris, auditando o aceite da Fase 4
 * (`ACEITE-FASE-4.md`), registrou que `lib/dispatch-state.ts` e
 * `lib/services/dispatch.ts` não tinham teste NENHUM — nem com fake. O freio
 * de um motor que dispara sozinho estava inteiramente não exercitado, e a
 * semântica dele é invertida em relação à do scraper, que é exatamente o tipo
 * de assimetria que um refactor futuro "corrige" sem querer.
 *
 * O que este arquivo cobre é a camada de DECISÃO (`services/dispatch.ts`), com
 * `lib/dispatch-state` mockado. O que ele continua NÃO cobrindo — e é honesto
 * dizer — é o Redis de verdade: se `client.set`/`client.del` fazem o que
 * achamos, e se a chave some num restart, só um Redis real prova.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readDispatchEnabledMeta = vi.hoisted(() => vi.fn());
const writeDispatchEnabledMeta = vi.hoisted(() => vi.fn());
const clearDispatchEnabledMeta = vi.hoisted(() => vi.fn());
const readDispatchPausedMeta = vi.hoisted(() => vi.fn());
const writeDispatchPausedMeta = vi.hoisted(() => vi.fn());
const clearDispatchPausedMeta = vi.hoisted(() => vi.fn());
const readDispatchTickHeartbeat = vi.hoisted(() => vi.fn());

// `services/dispatch.ts` importa `api-handler` (para `conflict`), que puxa
// `next-auth` — o mesmo mock compartilhado que os outros testes de serviço
// usam (`whatsapp-instances.test.ts` etc.) evita carregar isso no ambiente
// de teste.
vi.mock('@/lib/api-handler', async () => {
  const { apiHandlerMockFactory } = await import('@/test/api-handler-mock');
  return apiHandlerMockFactory();
});

vi.mock('@/lib/dispatch-state', () => ({
  readDispatchEnabledMeta,
  writeDispatchEnabledMeta,
  clearDispatchEnabledMeta,
  readDispatchPausedMeta,
  writeDispatchPausedMeta,
  clearDispatchPausedMeta,
  readDispatchTickHeartbeat,
}));

const { getDispatchQueueStatus, pauseDispatchQueue, resumeDispatchQueue } = await import('./dispatch');

const ATOR = { id: 'user-1', email: 'dono@innoprospect.local' };

beforeEach(() => {
  vi.clearAllMocks();
  readDispatchEnabledMeta.mockResolvedValue(null);
  readDispatchPausedMeta.mockResolvedValue(null);
  readDispatchTickHeartbeat.mockResolvedValue(null);
  writeDispatchEnabledMeta.mockResolvedValue(undefined);
  clearDispatchEnabledMeta.mockResolvedValue(undefined);
  writeDispatchPausedMeta.mockResolvedValue(undefined);
  clearDispatchPausedMeta.mockResolvedValue(undefined);
});

describe('getDispatchQueueStatus — ausência de chave é PAUSADO (semântica invertida, §6.8.9)', () => {
  it('sem meta de "ligado" → pausado (o motor nasce assim num Redis limpo)', async () => {
    const status = await getDispatchQueueStatus();
    expect(status.status).toBe('paused');
  });

  it('com meta de "ligado" → rodando, com a autoria de quem ligou', async () => {
    readDispatchEnabledMeta.mockResolvedValue({ enabledAt: '2026-09-25T10:00:00.000Z', enabledBy: 'dono@x' });
    const status = await getDispatchQueueStatus();
    expect(status.status).toBe('running');
    expect(status.enabledBy).toBe('dono@x');
  });

  it('heartbeat é devolvido cru — a rota não decide "worker morto", a tela decide', async () => {
    readDispatchTickHeartbeat.mockResolvedValue({ lastTickAt: '2026-09-25T10:00:00.000Z', ageSeconds: 12.7 });
    const status = await getDispatchQueueStatus();
    expect(status.lastTickAt).toBe('2026-09-25T10:00:00.000Z');
    expect(status.tickAgeSeconds).toBe(13);
  });

  it('🔒 heartbeat é exposto MESMO pausado — "parado de propósito" e "quebrado" não podem ser a mesma tela', async () => {
    readDispatchTickHeartbeat.mockResolvedValue({ lastTickAt: '2026-09-25T10:00:00.000Z', ageSeconds: 5 });
    const status = await getDispatchQueueStatus();
    expect(status.status).toBe('paused');
    expect(status.lastTickAt).not.toBeNull();
  });
});

describe('autoria da pausa — só faz sentido enquanto parado', () => {
  it('pausado com autoria registrada → devolve quem pausou, quando e por quê', async () => {
    readDispatchPausedMeta.mockResolvedValue({
      pausedAt: '2026-09-25T02:00:00.000Z',
      pausedBy: 'dono@x',
      reason: 'taxa de resposta despencou',
    });
    const status = await getDispatchQueueStatus();
    expect(status.pausedBy).toBe('dono@x');
    expect(status.pausedAt).toBe('2026-09-25T02:00:00.000Z');
    expect(status.pausedReason).toBe('taxa de resposta despencou');
  });

  it('pausado SEM autoria (motor nasceu pausado / Redis limpo) → campos nulos, e isso é normal', async () => {
    const status = await getDispatchQueueStatus();
    expect(status.status).toBe('paused');
    expect(status.pausedBy).toBeNull();
    expect(status.pausedReason).toBeNull();
  });

  it('🔒 RODANDO não expõe a pausa anterior — história exibida como estado atual é o defeito que a reconciliação de instância consertou', async () => {
    readDispatchEnabledMeta.mockResolvedValue({ enabledAt: '2026-09-25T10:00:00.000Z', enabledBy: 'dono@x' });
    readDispatchPausedMeta.mockResolvedValue({ pausedAt: '2026-09-25T02:00:00.000Z', pausedBy: 'alguem@x' });
    const status = await getDispatchQueueStatus();
    expect(status.status).toBe('running');
    expect(status.pausedBy).toBeNull();
    expect(status.pausedAt).toBeNull();
  });
});

describe('pauseDispatchQueue — o botão do incidente', () => {
  beforeEach(() => {
    readDispatchEnabledMeta.mockResolvedValue({ enabledAt: '2026-09-25T10:00:00.000Z', enabledBy: 'dono@x' });
  });

  it('para o motor e registra quem parou, sem exigir justificativa', async () => {
    const res = await pauseDispatchQueue(ATOR);
    expect(res).toEqual({ ok: true, status: 'paused' });
    expect(clearDispatchEnabledMeta).toHaveBeenCalled();
    expect(writeDispatchPausedMeta).toHaveBeenCalledWith(
      expect.objectContaining({ pausedBy: 'dono@innoprospect.local' }),
    );
    // Sem `reason`: exigir justificativa transformaria o botão de incidente
    // num formulário, que é o que a §6.8.9 manda não fazer.
    expect(writeDispatchPausedMeta.mock.calls[0]![0]).not.toHaveProperty('reason');
  });

  it('🔒 PARA antes de registrar a autoria — se a auditoria falhar, o motor já está parado', async () => {
    const ordem: string[] = [];
    clearDispatchEnabledMeta.mockImplementation(async () => void ordem.push('parou'));
    writeDispatchPausedMeta.mockImplementation(async () => void ordem.push('registrou'));
    await pauseDispatchQueue(ATOR);
    expect(ordem).toEqual(['parou', 'registrou']);
  });

  it('aceita motivo de quem chama a API direto (runbook/script de incidente)', async () => {
    await pauseDispatchQueue(ATOR, 'Evolution devolvendo incerto em série');
    expect(writeDispatchPausedMeta).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Evolution devolvendo incerto em série' }),
    );
  });

  it('já pausado → 409, e NÃO sobrescreve a autoria da pausa que já existia', async () => {
    readDispatchEnabledMeta.mockResolvedValue(null);
    await expect(pauseDispatchQueue(ATOR)).rejects.toThrow();
    expect(clearDispatchEnabledMeta).not.toHaveBeenCalled();
    expect(writeDispatchPausedMeta).not.toHaveBeenCalled();
  });
});

describe('resumeDispatchQueue — a ação de maior risco', () => {
  it('liga o motor, registra quem ligou e LIMPA a autoria da pausa anterior', async () => {
    const res = await resumeDispatchQueue(ATOR);
    expect(res.status).toBe('running');
    expect(writeDispatchEnabledMeta).toHaveBeenCalledWith(
      expect.objectContaining({ enabledBy: 'dono@innoprospect.local' }),
    );
    // Sem esta limpeza, a PRÓXIMA pausa poderia exibir quem parou da vez
    // passada como se fosse agora.
    expect(clearDispatchPausedMeta).toHaveBeenCalled();
  });

  it('já rodando → 409, sem reescrever nada', async () => {
    readDispatchEnabledMeta.mockResolvedValue({ enabledAt: '2026-09-25T10:00:00.000Z', enabledBy: 'outro@x' });
    await expect(resumeDispatchQueue(ATOR)).rejects.toThrow();
    expect(writeDispatchEnabledMeta).not.toHaveBeenCalled();
  });

  it('ator sem e-mail cai no id — nunca grava vazio', async () => {
    await resumeDispatchQueue({ id: 'user-9', email: null });
    expect(writeDispatchEnabledMeta).toHaveBeenCalledWith(expect.objectContaining({ enabledBy: 'user-9' }));
  });
});
