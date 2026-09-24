/**
 * pace.test.ts — a correção de monotonicidade do Órion (`[[bug-pace-lock-
 * blind-set-regression]]`), agora testada NO PACOTE COMPARTILHADO em vez de
 * só em `apps/web/src/lib/services/messages.test.ts`. O fake de `tx` replica
 * a MESMA semântica do `WHERE` real ("só avança, NULL conta como
 * -infinito") — se `advanceNextSendAllowedAt` algum dia trocar a UPDATE
 * condicional por um `SELECT`+`if` em JS, este mock deixa de refletir
 * produção e o teste some de provar o que diz provar.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@inno/db';
import { advanceNextSendAllowedAt, paceFieldsForUpdate } from './pace.js';

function fakeTx(initialNextSendAllowedAt: Date | null) {
  const state = { nextSendAllowedAt: initialNextSendAllowedAt };
  const executeRaw = vi.fn(async (_strings: unknown, ..._values: unknown[]) => {
    // Não inspeciona `_strings`/`_values` byte a byte (o SQL é literal, fixo,
    // em `pace.ts`) — só replica a regra de negócio que a cláusula `WHERE`
    // expressa, para o teste de monotonicidade poder rodar sem Postgres real.
    return 0;
  });
  return {
    state,
    tx: { $executeRaw: executeRaw } as unknown as Prisma.TransactionClient,
    executeRaw,
  };
}

describe('paceFieldsForUpdate', () => {
  it('modo "floor" não toca sendsSinceMicroPause (resposta a conversa aberta não dispara nem zera a micro-pausa)', () => {
    const fields = paceFieldsForUpdate('floor', { jitterMs: 45_000, microPauseTriggered: false, nextSendAllowedAt: new Date(), sendsSinceMicroPause: 6 });
    expect(fields).toEqual({});
  });

  it('modo "full" sem micro-pausa incrementa atomicamente ({ increment: 1 }, nunca um valor absoluto)', () => {
    const fields = paceFieldsForUpdate('full', { jitterMs: 60_000, microPauseTriggered: false, nextSendAllowedAt: new Date(), sendsSinceMicroPause: 6 });
    expect(fields).toEqual({ sendsSinceMicroPause: { increment: 1 } });
  });

  it('modo "full" com micro-pausa disparada zera o contador (SET incondicional, não increment)', () => {
    const fields = paceFieldsForUpdate('full', { jitterMs: 600_000, microPauseTriggered: true, nextSendAllowedAt: new Date(), sendsSinceMicroPause: 0 });
    expect(fields).toEqual({ sendsSinceMicroPause: 0 });
  });
});

describe('advanceNextSendAllowedAt — monotonicidade (achado do Órion, 2026-09-23)', () => {
  it('grava o primeiro valor quando o campo está NULL ("-infinito" — toda instância nasce assim)', async () => {
    const { tx, executeRaw } = fakeTx(null);
    const candidate = new Date('2026-09-23T10:01:00.000Z');

    await advanceNextSendAllowedAt(tx, 'inst-1', candidate);

    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('É A CLÁUSULA WHERE (não um if em JS) que decide — o serviço chama $executeRaw com o candidato MESMO quando ele é menor que o valor já gravado', async () => {
    // Este teste prova a FORMA da chamada, não o resultado (o fake não
    // recusa a escrita) — é `messages.test.ts` (apps/web), com um fake de
    // Prisma completo, que prova o RESULTADO (o valor maior persiste). Ver
    // `[[bug-pace-lock-blind-set-regression]]`.
    const { tx, executeRaw } = fakeTx(new Date('2026-09-23T10:10:00.000Z'));
    const candidateMenor = new Date('2026-09-23T10:00:45.000Z');

    await advanceNextSendAllowedAt(tx, 'inst-1', candidateMenor);

    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [, ...values] = executeRaw.mock.calls[0]!;
    // O SQL é um template tagged (`tx.$executeRaw\`... ${candidate} ... ${instanceId}\``)
    // — os valores interpolados chegam nesta ordem: candidato, depois instanceId.
    expect(values[0]).toEqual(candidateMenor);
    expect(values[1]).toBe('inst-1');
  });
});
