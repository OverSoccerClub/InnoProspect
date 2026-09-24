/**
 * selftest-checks.ts — as checagens em si do auto-teste do worker (ver
 * `selftest.ts`, o ENTRYPOINT de linha de comando que embrulha isto). Este
 * arquivo é uma biblioteca pura, sem `main()` nem efeito colateral de
 * topo-de-módulo — é o que `index.ts` importa para rodar o modo completo no
 * BOOT, e o que `selftest.ts` importa para virar `node dist/selftest.js`.
 *
 * ⚠️ NÃO adicione nenhum código de topo-de-módulo com efeito colateral
 * aqui (nem um `console.log`, nem um `if (algumaCondição) { ... }` fora de
 * função). Motivo real, não hipotético: este arquivo é importado por DOIS
 * entrypoints do tsup (`index.ts` e `selftest.ts`) — o `splitting` do
 * esbuild então o extrai para um CHUNK compartilhado. Um efeito colateral de
 * topo-de-módulo aqui rodaria toda vez que QUALQUER um dos dois entrypoints
 * for carregado, não só quando `selftest.ts` for executado diretamente —
 * foi exatamente esse bug (o gatilho de CLI acabou dentro do chunk
 * compartilhado, e `import.meta.url` passou a apontar para o CHUNK, nunca
 * para `selftest.js`) que motivou separar este arquivo do `selftest.ts` em
 * 2026-09-23. Mantenha o gatilho de CLI (`main`, `process.exit`, a
 * comparação de "sou o processo principal?") SÓ em `selftest.ts`.
 *
 * POR QUE ISTO EXISTE (a razão importa mais que o código): em 22-23/09/2026
 * cinco incidentes derrubaram o worker em produção — nome de fila com `:`
 * (`ce30738`), `.ts` fonte dentro do bundle (`0cea1c1`), Chromium divergente
 * da imagem base (`403c68b`), `require` de CommonJS num bundle ESM
 * (`b13c002`), e um script operacional impossível de rodar no container
 * (`7e7f4c7`). **Todos os cinco passaram por typecheck, lint, centenas de
 * testes e `next build`/`tsup build` — verdes.** Nenhum desses portões olha
 * para o artefato que sobe (`dist/*.js` rodando com `node` puro, sem `pnpm`,
 * sem `tsx`, contra Postgres/Redis/Chromium de verdade). Este módulo é essa
 * rede que faltava: uma bateria de checagens que só passa se o artefato REAL
 * conseguir fazer, de verdade, exatamente o que já quebrou uma vez.
 *
 * DOIS MODOS — deliberadamente com custo diferente (ver Bloco 1 do
 * PROGRESSO.md: "rodar o auto-teste completo a cada 30s é diferente de
 * rodar uma vez no boot"):
 *
 *   FULL_STEPS (`node dist/selftest.js`)        — COMPLETO. Carrega os
 *     pacotes internos que já quebraram por empacotamento (@inno/core,
 *     @inno/db, @inno/scraper), roda `SELECT 1` real no Postgres, instancia
 *     as 3 filas do BullMQ de verdade (é o que pegaria o nome com `:`)
 *     contra o Redis real, e abre+fecha um Chromium de verdade (é o que
 *     pegaria a divergência de versão/`pwuser`). Chamado 1x no BOOT do
 *     processo (`index.ts`, antes de subir qualquer `Worker`/`Queue` real —
 *     fail-fast: se isto falhar, o processo nem chega a tentar consumir
 *     job) e pelo CI (`.github/workflows/ci.yml`) como smoke test do
 *     artefato recém-buildado, contra Postgres/Redis efêmeros e a MESMA
 *     imagem base do Playwright que a produção usa.
 *
 *   PING_STEPS (`node dist/selftest.js --ping`) — LEVE. Só Postgres
 *     (`SELECT 1`, uma conexão nova e barata) + o heartbeat que o PROCESSO
 *     PRINCIPAL já grava no Redis a cada `HEARTBEAT_INTERVAL_MS`
 *     (`lib/queue-state.ts`, `scheduler.ts`). NÃO abre Chromium nem
 *     instancia fila. É o `HEALTHCHECK` do `Dockerfile`, chamado pelo
 *     Docker a cada ~30s, para sempre, enquanto o container viver.
 *
 * POR QUE OS DOIS MODOS NÃO SÃO A MESMA COISA (a decisão de design que a
 * tarefa pediu para justificar): abrir e fechar um Chromium de verdade custa
 * ~1-2s e um processo de sistema inteiro. Repetir isso a cada 30s, para
 * sempre, dentro do MESMO container que está rodando o scraping real, é
 * puro desperdício de CPU/memória competindo com o trabalho de verdade — e
 * não prova nada que o próprio fluxo de scraping não já prove sozinho: se o
 * Chromium do processo principal morrer, o próximo `SearchTask` falha com
 * `BROWSER_CRASH`, entra no retry/backoff já existente e (se persistir) abre
 * alerta (`observability/alerts.ts`) — o HEALTHCHECK não precisa duplicar
 * esse sinal. O que o HEALTHCHECK recorrente PRECISA garantir é mais barato
 * e mais direto: "o laço principal do worker (`scheduler.ts`) ainda está
 * vivo e escrevendo", não "o Postgres/Redis existem em abstrato" — por isso
 * ele lê o heartbeat que o PRÓPRIO processo em execução grava, em vez de
 * abrir sua própria conexão "de mentira" que provaria só que o Redis
 * responde, não que o worker está de fato consumindo.
 */
import type { Queue as BullMqQueue } from 'bullmq';

export type SelfTestStepResult = {
  name: string;
  ok: boolean;
  durationMs: number;
  /** Preenchido só em sucesso — um resumo curto do que foi confirmado. */
  detail?: string;
  /** Preenchido só em falha — mensagem legível, SEM stack trace (ver `formatError`). */
  error?: string;
};

export type SelfTestReport = {
  ok: boolean;
  steps: SelfTestStepResult[];
};

export type SelfTestStep = { name: string; run: () => Promise<string | void> };

/**
 * Reduz qualquer erro a UMA linha legível, sem stack trace — é o que permite
 * "dizer exatamente o que falhou sem depender de leitura de stack" (pedido
 * explícito da tarefa). Encadeia `cause` só quando é de fato um `Error`
 * (mesma armadilha documentada no incidente de `handleScrapeFailure`,
 * `scrape-search.job.ts`: `err: err.message` perde a causa real; aqui é o
 * inverso — formatamos nós mesmos a causa em texto, para não depender do
 * encadeamento automático do pino, que este módulo não usa de propósito
 * (ver o comentário de `runSteps`).
 */
export function formatError(err: unknown): string {
  if (err instanceof Error) {
    const cause = err.cause;
    const causeMsg = cause instanceof Error ? ` (causa: ${cause.message})` : '';
    return `${err.message}${causeMsg}`;
  }
  return String(err);
}

/**
 * Timeout padrão de CADA passo — descoberto na prática, não hipotético:
 * a 1ª execução manual de `node dist/selftest.js` nesta entrega (sem Redis
 * disponível na máquina) TRAVOU o processo indefinidamente em
 * `checkFilasBullMq`/`checkHeartbeat` — o BullMQ usa `ioredis` por baixo, e o
 * `retryStrategy` padrão do `ioredis` tenta reconectar PARA SEMPRE (nunca
 * desiste sozinho), então `queue.waitUntilReady()` nunca resolve nem rejeita
 * enquanto o Redis estiver inacessível. Um auto-teste que existe para "dizer
 * exatamente o que falhou" não pode ele mesmo ficar mudo, pendurado para
 * sempre — pior que qualquer um dos 5 incidentes que o motivaram, porque
 * NENHUM sinal chega a lugar nenhum (nem log, nem exit code). Cada passo
 * corre contra este relógio; se vencer, é reportado como falha (não como
 * hang), e os passos seguintes continuam normalmente.
 */
export const DEFAULT_STEP_TIMEOUT_MS = Number(process.env.SELFTEST_STEP_TIMEOUT_MS) || 20_000;

async function runWithTimeout(step: SelfTestStep, timeoutMs: number): Promise<string | void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `passo "${step.name}" não terminou em ${timeoutMs}ms — travado, provavelmente numa dependência externa ` +
            'que nunca respondeu nem falhou (Postgres/Redis fora do ar sem recusar a conexão rápido, ou Chromium ' +
            'pendurado). Isto NÃO fecha a conexão pendente por conta própria — se isto disparar de verdade, reinicie ' +
            'o processo depois de investigar; não confie só em rodar de novo.',
        ),
      );
    }, timeoutMs);
    // Não retém o processo vivo só por causa deste timer — quem quer que
    // esteja de fato esperando o passo (o `await Promise.race` abaixo) já
    // segura o processo pelo motivo certo.
    timer.unref?.();
  });

  try {
    return await Promise.race([step.run(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Roda cada passo isoladamente — um passo que lança (ou que vence o timeout
 * acima) NUNCA impede os seguintes de rodar (senão um Chromium quebrado
 * escondia se o Postgres também está fora do ar). Sem `pino` de propósito:
 * quem consome isto pode ser uma ferramenta de linha de comando (CI,
 * `docker exec`, humano lendo o log de boot) OU `index.ts` (que decide como
 * logar via `pino` por conta própria, ver o chamador) — este módulo só
 * devolve dados estruturados.
 */
export async function runSteps(steps: SelfTestStep[], stepTimeoutMs = DEFAULT_STEP_TIMEOUT_MS): Promise<SelfTestReport> {
  const results: SelfTestStepResult[] = [];
  for (const step of steps) {
    const startedAt = Date.now();
    try {
      const detail = await runWithTimeout(step, stepTimeoutMs);
      results.push({ name: step.name, ok: true, durationMs: Date.now() - startedAt, detail: detail || undefined });
    } catch (err) {
      results.push({ name: step.name, ok: false, durationMs: Date.now() - startedAt, error: formatError(err) });
    }
  }
  return { ok: results.every((r) => r.ok), steps: results };
}

/**
 * Carrega os pacotes internos que JÁ quebraram por empacotamento
 * (`ERR_UNKNOWN_FILE_EXTENSION` em `.ts` fonte, `Dynamic require of "buffer"
 * is not supported` em dependência CommonJS embutida num bundle ESM — ver
 * `apps/worker/tsup.config.ts`) e confere que os símbolos que o resto do
 * worker depende de fato existem. `import()` DINÂMICO de propósito: um
 * `import` estático no topo do arquivo que falhasse quebraria o carregamento
 * do MÓDULO inteiro antes de `runSteps` sequer começar a rodar — o erro
 * apareceria cru, do jeito que apareceu nos 5 incidentes, exatamente o que
 * este módulo existe para não deixar acontecer de novo.
 */
async function checkModulosInternos(): Promise<string> {
  const [core, db, scraper, sending] = await Promise.all([
    import('@inno/core'),
    import('@inno/db'),
    import('@inno/scraper'),
    // 🆕 Fase 4.F.0 — mesma prova que os outros três: se o bundle do worker
    // não embutiu `@inno/sending` de verdade (`noExternal` do
    // `tsup.config.ts`), o `import()` dinâmico aqui é exatamente o ponto
    // onde isso aparece — `ERR_UNKNOWN_FILE_EXTENSION` tentando carregar o
    // `.ts` fonte via symlink do pnpm, ANTES de qualquer Worker/Queue subir.
    import('@inno/sending'),
  ]);
  if (typeof core.isOffNiche !== 'function') {
    throw new Error('@inno/core carregou, mas "isOffNiche" não é uma função — export quebrado ou tree-shaking indevido');
  }
  if (!db.prisma || typeof db.prisma.$queryRaw !== 'function') {
    throw new Error('@inno/db carregou, mas "prisma" não parece um PrismaClient válido');
  }
  if (typeof scraper.BrowserSession !== 'function') {
    throw new Error('@inno/scraper carregou, mas "BrowserSession" não é uma classe — export quebrado ou tree-shaking indevido');
  }
  if (typeof sending.executeSendAttempt !== 'function') {
    throw new Error('@inno/sending carregou, mas "executeSendAttempt" não é uma função — export quebrado ou tree-shaking indevido');
  }
  return '@inno/core, @inno/db, @inno/scraper e @inno/sending carregaram e expõem os símbolos esperados';
}

/** Conexão real, consulta real — `new PrismaClient()` não lança sem `DATABASE_URL` (só na 1ª query), então só um `SELECT` prova conectividade. */
async function checkPostgres(): Promise<string> {
  const { prisma } = await import('@inno/db');
  const rows = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`;
  const ok = Array.isArray(rows) && rows.length === 1 && Number(rows[0]?.ok) === 1;
  if (!ok) {
    throw new Error('Postgres respondeu, mas "SELECT 1" não devolveu o valor esperado — resposta: ' + JSON.stringify(rows));
  }
  return 'SELECT 1 ok';
}

/**
 * Instancia as 3 filas de `QUEUES` (`queues.ts`) contra o Redis real e espera
 * a conexão ficar pronta — é exatamente o que o construtor `new Queue(nome)`
 * do BullMQ validou (e rejeitou) no incidente do nome com `:`: aquele erro
 * acontecia no CONSTRUTOR, antes de qualquer `waitUntilReady`, então só
 * instanciar já basta para reproduzir a classe do bug; `waitUntilReady`
 * adiciona a prova de que o Redis está de fato acessível, não só que o nome
 * é válido.
 */
async function checkFilasBullMq(): Promise<string> {
  const { Queue } = await import('bullmq');
  const { QUEUES, bullConnectionOptions } = await import('./queues.js');
  const connection = bullConnectionOptions();
  const nomes = Object.values(QUEUES);

  for (const nome of nomes) {
    const queue: BullMqQueue = new Queue(nome, { connection });
    try {
      await queue.waitUntilReady();
    } finally {
      await queue.close();
    }
  }
  return `${nomes.length} filas: ${nomes.join(', ')}`;
}

/**
 * Abre e fecha um Chromium de verdade via `BrowserSession` (`@inno/scraper`,
 * a mesma classe que `scheduler.ts`/`PlaywrightMapsEngine` usam em
 * produção) — instância PRÓPRIA deste selftest, não o engine singleton do
 * pacote (`getDefaultEngine`), então não interfere com nenhum estado que o
 * processamento real de `SearchTask` esteja usando. É isto que pegaria a
 * divergência de versão Playwright-vs-imagem-base (`BROWSER_CRASH`) e a
 * criação do usuário `pwuser` — os dois incidentes reais de 2026-09-22.
 */
async function checkChromium(): Promise<string> {
  const { BrowserSession, defaultSessionConfig, NoopProxyProvider } = await import('@inno/scraper');
  const session = new BrowserSession(new NoopProxyProvider(), defaultSessionConfig());
  try {
    await session.getContext('selftest', 'SP');
  } finally {
    await session.close();
  }
  return 'Chromium abriu e fechou um BrowserContext';
}

/**
 * Modo `--ping`: só Postgres. O heartbeat (abaixo) já prova Redis
 * acessível — repetir aqui seria custo duplicado.
 */
async function checkHeartbeat(): Promise<string> {
  const { Queue } = await import('bullmq');
  const { QUEUES, bullConnectionOptions } = await import('./queues.js');
  const { WORKER_HEARTBEAT_KEY, HEARTBEAT_TTL_SECONDS } = await import('./lib/queue-state.js');

  // Reaproveita `Queue#client` para obter uma conexão ioredis pronta, em vez
  // de declarar `ioredis` como dependência própria do worker só para isto —
  // mesma decisão já registrada em `lib/queue-state.ts` (bullmq já carrega
  // ioredis por baixo).
  const queue: BullMqQueue = new Queue(QUEUES.scrapeSearch, { connection: bullConnectionOptions() });
  try {
    const client = await queue.client;
    const value = await client.get(WORKER_HEARTBEAT_KEY);
    if (!value) {
      throw new Error(
        `chave "${WORKER_HEARTBEAT_KEY}" ausente no Redis — o processo principal do worker não grava heartbeat ` +
          `há mais de ${HEARTBEAT_TTL_SECONDS}s (parado, reiniciando, ou nunca chegou a subir os Workers). ` +
          'Isto NÃO testa Postgres/Chromium — ver `node dist/selftest.js` (modo completo) para isso.',
      );
    }
    return `heartbeat gravado em ${value}`;
  } finally {
    await queue.close();
  }
}

/** Ver o comentário de cabeçalho — módulos internos, Postgres, filas BullMQ e Chromium. */
export const FULL_STEPS: SelfTestStep[] = [
  { name: 'modulos-internos', run: checkModulosInternos },
  { name: 'postgres', run: checkPostgres },
  { name: 'redis-filas', run: checkFilasBullMq },
  { name: 'chromium', run: checkChromium },
];

/** Ver o comentário de cabeçalho — deliberadamente mais leve, para o `HEALTHCHECK` recorrente do Docker. */
export const PING_STEPS: SelfTestStep[] = [
  { name: 'postgres', run: checkPostgres },
  { name: 'heartbeat', run: checkHeartbeat },
];

export type SelfTestMode = 'full' | 'ping';

/**
 * Timeout por passo do modo `--ping` — deliberadamente menor que
 * `DEFAULT_STEP_TIMEOUT_MS` (20s). Motivo: o `HEALTHCHECK` do `Dockerfile`
 * declara seu PRÓPRIO `--timeout` (o Docker mata o processo se ele passar
 * disso, marcando o check como falho sem nenhum diagnóstico nosso) — com só
 * 2 passos sequenciais neste modo, um teto de 8s por passo garante um pior
 * caso (~16s) confortavelmente abaixo do `--timeout` do `HEALTHCHECK`, então
 * é o NOSSO relatório (com a mensagem exata de qual passo travou) que
 * aparece no log, não um `SIGKILL` mudo do Docker.
 */
export const PING_STEP_TIMEOUT_MS = Number(process.env.SELFTEST_PING_STEP_TIMEOUT_MS) || 8_000;

export async function runSelfTest(mode: SelfTestMode = 'full', stepTimeoutMs?: number): Promise<SelfTestReport> {
  if (mode === 'ping') {
    return runSteps(PING_STEPS, stepTimeoutMs ?? PING_STEP_TIMEOUT_MS);
  }
  return runSteps(FULL_STEPS, stepTimeoutMs);
}
