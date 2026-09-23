/**
 * scrape-search.job.test.ts
 *
 * Duas partes:
 *  1. `pauseQueueFor` (transição de alerta) — já existia.
 *  2. `createScrapeSearchProcessor` — o PROCESSADOR de 1 SearchTask (claim,
 *     scrape, dedupe/upsert, offNiche, retry/backoff, fechamento do
 *     SearchJob). Até 2026-09-23 isto nunca tinha sido exercitado por
 *     nenhum teste — é o código que grava cada lead que existe no banco
 *     (ARQUITETURA §1.5 Fluxo A). Ver inventário em
 *     `.claude/agent-memory/iris/project_innoprospect_testing.md`.
 *
 * Estratégia de mock: fake db em memória (`../test/fake-db.ts`, mesmo
 * padrão de `apps/web/src/test/fake-db.ts`) para `@inno/db`; `runSearch`
 * mockado (não sobe browser nenhum) mas o resto de `@inno/scraper`
 * (`ScrapeError`, `SCRAPE_ERROR_POLICY`, `backoffForAttempt`) é REAL — é o
 * que faz o teste pegar de verdade uma divergência entre a tabela de
 * retry/backoff e o que o processador assume. `@inno/core`
 * (`buildMachineUpdate`/`computeDedupeKey`/`isOffNiche`/`normalizeBrPhone`)
 * também é real, pelo mesmo motivo — são funções puras já bem testadas em
 * `packages/core`, e usá-las de verdade aqui exercita a INTEGRAÇÃO entre o
 * job e elas, não só "o job chamou alguma coisa".
 *
 * Import dinâmico dentro da factory do `vi.mock('@inno/db', ...)` — não
 * `vi.mock('@inno/db', () => ({ prisma: fakePrismaClient }))` com
 * `fakePrismaClient` importado estaticamente no topo do arquivo: isso
 * quebra com "Cannot access '...' before initialization" (hoisting do
 * `vi.mock`, ver `[[feedback_vitest_mock_hoisting]]` na memória da Íris).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job, Queue } from 'bullmq';
import type * as ScraperModule from '@inno/scraper';

vi.mock('../observability/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

const persistQueuePause = vi.fn().mockResolvedValue(undefined);
vi.mock('../lib/queue-state.js', () => ({ persistQueuePause }));

const sendAlert = vi.fn().mockResolvedValue(undefined);
vi.mock('../observability/alerts.js', () => ({ sendAlert }));

// Sanidade (A1-A4) roda de verdade contra o Postgres depois de cada task
// bem-sucedida — fora do escopo deste arquivo (tem sua própria lógica,
// ainda sem teste próprio, ver PENDÊNCIAS do handoff). Mockada aqui só para
// não precisar fakear `searchTask.findMany`/`lead.count`/etc. que ela usa,
// que não têm nada a ver com o que este arquivo testa.
const evaluateAndRecordSanity = vi.fn().mockResolvedValue(undefined);
vi.mock('../observability/sanity.js', () => ({ evaluateAndRecordSanity }));

const runSearch = vi.fn();
vi.mock('@inno/scraper', async (importOriginal) => {
  const actual = await importOriginal<typeof ScraperModule>();
  return { ...actual, runSearch };
});

vi.mock('@inno/db', async () => {
  const { fakePrismaClient } = await import('../test/fake-db.js');
  return { prisma: fakePrismaClient };
});

const { pauseQueueFor, createScrapeSearchProcessor } = await import('./scrape-search.job.js');
const { resetFakeDb, getFakeDbState } = await import('../test/fake-db.js');

function fakeQueue(initiallyPaused: boolean) {
  let paused = initiallyPaused;
  return {
    isPaused: vi.fn(async () => paused),
    pause: vi.fn(async () => {
      paused = true;
    }),
    add: vi.fn().mockResolvedValue(undefined),
  } as unknown as Queue;
}

describe('pauseQueueFor (transição de alerta)', () => {
  beforeEach(() => {
    sendAlert.mockClear();
    persistQueuePause.mockClear();
  });

  it('fila estava rodando -> pausa agora: alerta UMA vez', async () => {
    const queue = fakeQueue(false);

    await pauseQueueFor(queue, 60_000, 'RATE_LIMITED', 'rate limited', 'high');

    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(sendAlert).toHaveBeenCalledWith({
      kind: 'queue_paused',
      code: 'RATE_LIMITED',
      severity: 'high',
      message: 'rate limited',
      reason: 'scrape_error',
    });
  });

  it('fila JÁ estava pausada: não realerta', async () => {
    const queue = fakeQueue(true);

    await pauseQueueFor(queue, 60_000, 'RATE_LIMITED', 'rate limited de novo', 'high');

    expect(sendAlert).not.toHaveBeenCalled();
    // Mesmo sem alertar, a metadata é regravada (motivo pode ter mudado) —
    // só o alerta é que respeita a transição.
    expect(persistQueuePause).toHaveBeenCalledTimes(1);
  });
});

const CITY = { ibgeCode: '3550308', name: 'São Paulo', uf: 'SP', population: 12_000_000 };

function buildBusiness(overrides: Partial<{
  name: string;
  phoneRaw: string | null;
  address: string | null;
  category: string | null;
  externalRef: string | null;
  sourceUrl: string;
  rating: number | null;
}> = {}) {
  return {
    name: 'Empresa Teste',
    phoneRaw: null,
    address: 'Rua Teste, 123',
    cityGuess: null,
    website: null,
    category: 'Clínica odontológica',
    rating: 4.5,
    reviewCount: 10,
    latitude: null,
    longitude: null,
    externalRef: '0xexternal:1',
    sourceUrl: 'https://www.google.com/maps/place/?q=place_id:1',
    ...overrides,
  };
}

function buildOutput(businesses: ReturnType<typeof buildBusiness>[]) {
  return {
    businesses,
    meta: {
      engineId: 'playwright-maps' as const,
      queryString: 'clínica odontológica em São Paulo, SP',
      durationMs: 1000,
      scrolls: 1,
      reachedEnd: true,
      sourceUrl: 'https://www.google.com/maps/search/clinica+odontologica+em+Sao+Paulo%2C+SP',
    },
  };
}

describe('createScrapeSearchProcessor', () => {
  beforeEach(() => {
    runSearch.mockReset();
    evaluateAndRecordSanity.mockClear();
    sendAlert.mockClear();
    persistQueuePause.mockClear();
    resetFakeDb({
      cities: [CITY],
      searchJobs: [
        {
          id: 'job_1',
          niche: 'clínica odontológica',
          uf: 'SP',
          status: 'queued',
          totalTasks: 1,
          doneTasks: 0,
          failedTasks: 0,
          leadsFound: 0,
          leadsNew: 0,
          maxResultsPerCity: 20,
          startedAt: null,
          finishedAt: null,
        },
      ],
      searchTasks: [
        {
          id: 'task_1',
          searchJobId: 'job_1',
          cityId: CITY.ibgeCode,
          status: 'pending',
          attempt: 0,
          maxAttempts: 3,
          startedAt: null,
          finishedAt: null,
          resultCount: null,
          errorCode: null,
          errorMessage: null,
        },
      ],
    });
  });

  function runJob(scrapeQueue: Queue) {
    const processor = createScrapeSearchProcessor(scrapeQueue);
    return processor({ data: { searchTaskId: 'task_1' } } as Job<{ searchTaskId: string }>);
  }

  it('task que não está pending é ignorada (claim atômico falha) — nunca chama runSearch', async () => {
    getFakeDbState().searchTasks[0]!.status = 'running';
    const queue = fakeQueue(false);

    await runJob(queue);

    expect(runSearch).not.toHaveBeenCalled();
    expect(getFakeDbState().leads).toHaveLength(0);
  });

  it('caminho feliz: cria leads novos, fecha a task como done e incrementa os contadores do SearchJob', async () => {
    runSearch.mockResolvedValue(
      buildOutput([
        buildBusiness({ externalRef: 'ext-1', name: 'Clínica A', category: 'Clínica odontológica' }),
        buildBusiness({ externalRef: 'ext-2', name: 'Restaurante B', category: 'Restaurante' }),
      ]),
    );
    const queue = fakeQueue(false);

    await runJob(queue);

    const state = getFakeDbState();
    expect(state.leads).toHaveLength(2);
    // offNiche é calculado por lead, comparado ao nicho da busca — a clínica
    // adere ("clini"/"odont" em comum), o restaurante não.
    expect(state.leads.find((l) => l.externalRef === 'ext-1')?.offNiche).toBe(false);
    expect(state.leads.find((l) => l.externalRef === 'ext-2')?.offNiche).toBe(true);

    const task = state.searchTasks[0]!;
    expect(task.status).toBe('done');
    expect(task.resultCount).toBe(2);

    const job = state.searchJobs[0]!;
    expect(job.doneTasks).toBe(1);
    expect(job.leadsFound).toBe(2);
    expect(job.leadsNew).toBe(2);
    // totalTasks=1 e a única task fechou -> o SearchJob se completa sozinho.
    expect(job.status).toBe('completed');

    expect(evaluateAndRecordSanity).toHaveBeenCalledTimes(1);
  });

  it('recoleta da MESMA empresa (dedupeKey igual) faz UPDATE, não duplica, e não conta como leadsNew', async () => {
    getFakeDbState().leads.push({
      id: 'lead_existing',
      name: 'Clínica A (nome antigo)',
      phoneRaw: null,
      phoneE164: null,
      phoneType: 'unknown',
      address: 'Endereço antigo',
      cityId: CITY.ibgeCode,
      uf: 'SP',
      website: null,
      category: 'Clínica odontológica',
      rating: 3,
      reviewCount: 5,
      latitude: null,
      longitude: null,
      externalRef: 'ext-1',
      dedupeKey: 'ext-1',
      offNiche: false,
      sourceType: 'google_maps_scrape',
      sourceUrl: 'https://old.example',
      sourceQuery: 'antigo',
      collectedAt: new Date('2026-01-01T00:00:00Z'),
      lastSeenAt: new Date('2026-01-01T00:00:00Z'),
      searchJobId: 'job_1',
      searchTaskId: 'task_old',
      engineId: 'playwright-maps',
    });
    runSearch.mockResolvedValue(
      buildOutput([buildBusiness({ externalRef: 'ext-1', name: 'Clínica A', rating: 4.9 })]),
    );
    const queue = fakeQueue(false);

    await runJob(queue);

    const state = getFakeDbState();
    expect(state.leads).toHaveLength(1); // não duplicou
    expect(state.leads[0]!.rating).toBe(4.9); // campo de máquina foi atualizado
    expect(state.leads[0]!.sourceQuery).toBe('antigo'); // campo de ORIGEM nunca é tocado pelo update (buildMachineUpdate)

    const job = state.searchJobs[0]!;
    expect(job.leadsFound).toBe(1);
    expect(job.leadsNew).toBe(0); // já existia -> não é novo
  });

  it('offNiche de um lead recoletado é relativo ao nicho da busca de ORIGEM, não da task atual (regra do worker, niche.ts)', async () => {
    // Lead nasceu de uma busca de "restaurante" (job_origin) — a categoria
    // "Restaurante" adere a ESSA busca. Agora ele é recoletado pela task
    // atual, cuja busca é "clínica odontológica": se o worker comparasse
    // contra o nicho ATUAL por engano, marcaria erroneamente offNiche=true.
    getFakeDbState().searchJobs.push({
      id: 'job_origin',
      niche: 'restaurante',
      uf: 'SP',
      status: 'completed',
      totalTasks: 1,
      doneTasks: 1,
      failedTasks: 0,
      leadsFound: 1,
      leadsNew: 1,
      maxResultsPerCity: 20,
      startedAt: null,
      finishedAt: null,
    });
    getFakeDbState().leads.push({
      id: 'lead_existing',
      name: 'Restaurante B',
      phoneRaw: null,
      phoneE164: null,
      phoneType: 'unknown',
      address: null,
      cityId: CITY.ibgeCode,
      uf: 'SP',
      website: null,
      category: 'Restaurante',
      rating: 4,
      reviewCount: 2,
      latitude: null,
      longitude: null,
      externalRef: 'ext-2',
      dedupeKey: 'ext-2',
      offNiche: false,
      sourceType: 'google_maps_scrape',
      sourceUrl: 'https://old.example',
      sourceQuery: 'restaurante em São Paulo, SP',
      collectedAt: new Date('2026-01-01T00:00:00Z'),
      lastSeenAt: new Date('2026-01-01T00:00:00Z'),
      searchJobId: 'job_origin',
      searchTaskId: 'task_old',
      engineId: 'playwright-maps',
    });
    runSearch.mockResolvedValue(
      buildOutput([buildBusiness({ externalRef: 'ext-2', name: 'Restaurante B', category: 'Restaurante' })]),
    );
    const queue = fakeQueue(false);

    await runJob(queue);

    const lead = getFakeDbState().leads.find((l) => l.externalRef === 'ext-2');
    expect(lead?.offNiche).toBe(false); // aderente à busca de ORIGEM (restaurante), não à busca atual (clínica)
  });

  it('erro retryable dentro do teto (NAVIGATION_TIMEOUT): reenfileira com backoff, task volta para pending', async () => {
    const { ScrapeError } = await import('@inno/scraper');
    runSearch.mockRejectedValue(new ScrapeError('NAVIGATION_TIMEOUT', 'timeout de navegação'));
    const queue = fakeQueue(false);

    await runJob(queue);

    const task = getFakeDbState().searchTasks[0]!;
    expect(task.status).toBe('pending');
    expect(task.errorCode).toBe('NAVIGATION_TIMEOUT');
    expect(queue.add).toHaveBeenCalledTimes(1);
    const [jobName, data, opts] = (queue.add as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(jobName).toBe('scrape-search-task');
    expect(data).toEqual({ searchTaskId: 'task_1' });
    expect(opts.delay).toBeGreaterThan(0);
    // Não é um erro com pauseQueueMs (NAVIGATION_TIMEOUT não pausa a fila) — nunca alerta.
    expect(sendAlert).not.toHaveBeenCalled();
    // SearchJob não fecha: a task ainda vai rodar de novo.
    expect(getFakeDbState().searchJobs[0]!.status).not.toBe('completed');
  });

  it('tentativas esgotadas: task falha em definitivo, mas o SearchJob continua e se completa (uma cidade falha não derruba tudo)', async () => {
    // Task já em sua última tentativa permitida (maxAttempts=3): claimTask
    // incrementa attempt de 2 -> 3 antes do runSearch falhar.
    getFakeDbState().searchTasks[0]!.attempt = 2;
    const { ScrapeError } = await import('@inno/scraper');
    runSearch.mockRejectedValue(new ScrapeError('NAVIGATION_TIMEOUT', 'timeout de novo'));
    const queue = fakeQueue(false);

    await runJob(queue);

    const task = getFakeDbState().searchTasks[0]!;
    expect(task.status).toBe('failed');
    expect(task.attempt).toBe(3);
    expect(queue.add).not.toHaveBeenCalled(); // esgotou — não reenfileira

    const job = getFakeDbState().searchJobs[0]!;
    expect(job.failedTasks).toBe(1);
    // totalTasks=1 e a única task fechou (failed) -> job completa mesmo assim.
    expect(job.status).toBe('completed');
  });

  it('LAYOUT_CHANGED (maxAttempts=0): falha JÁ na 1ª tentativa, sem retry, e pausa a fila indefinidamente com severidade crítica', async () => {
    const { ScrapeError } = await import('@inno/scraper');
    runSearch.mockRejectedValue(new ScrapeError('LAYOUT_CHANGED', 'nenhuma alternativa de SELECTORS.resultsFeed casou'));
    const queue = fakeQueue(false);

    await runJob(queue);

    const task = getFakeDbState().searchTasks[0]!;
    expect(task.status).toBe('failed'); // esgotou na hora — política é maxAttempts: 0
    expect(queue.add).not.toHaveBeenCalled();

    expect(queue.pause).toHaveBeenCalledTimes(1);
    expect(sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'queue_paused', code: 'LAYOUT_CHANGED', severity: 'critical' }),
    );
    expect(persistQueuePause).toHaveBeenCalledWith(
      queue,
      expect.objectContaining({ code: 'LAYOUT_CHANGED', resumeAt: null }), // Infinity -> sem resumeAt, exige POST /queue/resume manual
    );
  });
});
