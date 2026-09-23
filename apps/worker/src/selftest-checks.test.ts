/**
 * selftest-checks.test.ts — cobre a parte TESTÁVEL SEM infra real de
 * `selftest-checks.ts`: `formatError` e o runner de passos (`runSteps`). Os
 * passos concretos (`checkPostgres`/`checkFilasBullMq`/`checkChromium`/
 * `checkHeartbeat`) exigem Postgres/Redis/Chromium de verdade — a mesma
 * razão por que `index.ts` (que os chama no boot) e `selftest.ts` (o
 * entrypoint de CLI) também não têm teste próprio neste projeto. Só
 * inspecionamos os NOMES dos passos de cada modo (`FULL_STEPS`/
 * `PING_STEPS`), nunca chamamos `.run()` deles aqui.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatError, runSteps, FULL_STEPS, PING_STEPS, type SelfTestStep } from './selftest-checks.js';

describe('formatError', () => {
  it('usa err.message quando é um Error simples', () => {
    expect(formatError(new Error('deu ruim'))).toBe('deu ruim');
  });

  it('encadeia a causa quando err.cause é um Error de verdade', () => {
    const err = new Error('falha externa', { cause: new Error('causa raiz') });
    expect(formatError(err)).toBe('falha externa (causa: causa raiz)');
  });

  it('não quebra e ignora a causa quando ela não é um Error (ex.: string)', () => {
    const err = new Error('falha externa', { cause: 'string qualquer' });
    expect(formatError(err)).toBe('falha externa');
  });

  it('converte valores que não são Error para string, sem lançar', () => {
    expect(formatError('só uma string')).toBe('só uma string');
    expect(formatError(42)).toBe('42');
  });
});

describe('runSteps', () => {
  it('roda todos os passos e reporta ok=true quando todos passam', async () => {
    const report = await runSteps([
      { name: 'a', run: async () => 'detalhe a' },
      { name: 'b', run: async () => undefined },
    ]);
    expect(report.ok).toBe(true);
    expect(report.steps).toHaveLength(2);
    expect(report.steps[0]).toMatchObject({ name: 'a', ok: true, detail: 'detalhe a' });
    expect(report.steps[1]).toMatchObject({ name: 'b', ok: true });
  });

  it('um passo que falha não impede os seguintes de rodar (senão um Chromium quebrado esconderia um Postgres também fora do ar)', async () => {
    const terceiro = vi.fn().mockResolvedValue('rodou');
    const report = await runSteps([
      {
        name: 'a',
        run: async () => {
          throw new Error('quebrou');
        },
      },
      { name: 'b', run: terceiro },
    ]);

    expect(report.ok).toBe(false);
    expect(terceiro).toHaveBeenCalledTimes(1);
    expect(report.steps[0]).toMatchObject({ name: 'a', ok: false, error: 'quebrou' });
    expect(report.steps[1]).toMatchObject({ name: 'b', ok: true, detail: 'rodou' });
  });

  it('reporta a mensagem formatada (sem stack) mesmo quando o passo lança algo que não é Error', async () => {
    const steps: SelfTestStep[] = [
      {
        name: 'esquisito',
        // `Promise.reject('...')`, não `throw`, para rejeitar com um valor
        // que NÃO é um `Error` sem disparar a regra de lint que exige lançar
        // só `Error` — é justamente esse caso (passo mal-comportado) que
        // este teste cobre em `formatError`.
        run: () => Promise.reject('só uma string lançada'),
      },
    ];
    const report = await runSteps(steps);
    expect(report.steps[0]).toMatchObject({ name: 'esquisito', ok: false, error: 'só uma string lançada' });
  });

  it('sem passo nenhum, é sucesso vazio (não trava em array vazio)', async () => {
    const report = await runSteps([]);
    expect(report.ok).toBe(true);
    expect(report.steps).toEqual([]);
  });
});

describe('timeout de passo (não travar para sempre)', () => {
  // Incidente real desta entrega (2026-09-23): a 1ª execução manual de
  // `node dist/selftest.js`, sem Redis disponível, TRAVOU o processo — o
  // `retryStrategy` padrão do `ioredis` tenta reconectar para sempre, então
  // `queue.waitUntilReady()` nunca resolvia nem rejeitava. Este teste prova
  // que `runSteps` sempre termina em tempo limitado, mesmo que um passo em
  // si nunca resolva.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reporta falha (não trava) quando um passo nunca resolve nem rejeita', async () => {
    const stepQueNuncaTermina: SelfTestStep = {
      name: 'travado',
      run: () => new Promise<string | void>(() => {}),
    };

    const reportPromise = runSteps([stepQueNuncaTermina], 100);
    await vi.advanceTimersByTimeAsync(100);
    const report = await reportPromise;

    expect(report.ok).toBe(false);
    expect(report.steps[0]).toMatchObject({ name: 'travado', ok: false });
    expect(report.steps[0]?.error).toContain('não terminou em 100ms');
  });

  it('um passo travado não impede os seguintes de rodar', async () => {
    const seguinte = vi.fn().mockResolvedValue('rodou mesmo assim');
    const reportPromise = runSteps(
      [
        { name: 'travado', run: () => new Promise<string | void>(() => {}) },
        { name: 'seguinte', run: seguinte },
      ],
      100,
    );
    await vi.advanceTimersByTimeAsync(100);
    const report = await reportPromise;

    expect(seguinte).toHaveBeenCalledTimes(1);
    expect(report.steps[1]).toMatchObject({ name: 'seguinte', ok: true, detail: 'rodou mesmo assim' });
  });
});

describe('composição dos modos completo vs --ping', () => {
  it('modo completo cobre módulos internos, Postgres, filas BullMQ e Chromium', () => {
    expect(FULL_STEPS.map((s) => s.name)).toEqual(['modulos-internos', 'postgres', 'redis-filas', 'chromium']);
  });

  it('modo --ping é deliberadamente mais leve: sem Chromium nem módulos internos', () => {
    expect(PING_STEPS.map((s) => s.name)).toEqual(['postgres', 'heartbeat']);
    expect(PING_STEPS.map((s) => s.name)).not.toContain('chromium');
    expect(PING_STEPS.map((s) => s.name)).not.toContain('redis-filas');
  });
});
