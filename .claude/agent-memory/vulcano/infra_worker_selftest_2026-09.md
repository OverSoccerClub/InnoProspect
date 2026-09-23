---
name: infra-worker-selftest-2026-09
description: Auto-teste do worker dentro da imagem (selftest-checks.ts/selftest.ts) — arquitetura, o bug de tree-shaking que quebrou a 1ª versão, o bug de hang sem timeout, CI job novo, HEALTHCHECK do Dockerfile
metadata:
  type: project
---

Entrega de 2026-09-23 (Onda 1, resposta direta aos 5 incidentes de 22-23/09
que passaram por typecheck/lint/testes/build — ver `PROGRESSO.md`,
"Armadilhas já pagas"). Trabalhei em paralelo com o Vega (ele em
`apps/web/src/**`, `schema.prisma`, `observability/sanity.ts`) no MESMO
working tree, sem worktree separada — isso importa, ver "Armadilha" abaixo.

## Arquivos entregues
- `apps/worker/src/selftest-checks.ts` (novo) — biblioteca pura: `formatError`,
  `runSteps` (com timeout por passo), `FULL_STEPS` (módulos internos →
  Postgres `SELECT 1` → 3 filas BullMQ reais → Chromium via `BrowserSession`)
  e `PING_STEPS` (Postgres + heartbeat do Redis). `runSelfTest(mode)`.
- `apps/worker/src/selftest.ts` (novo) — ENTRYPOINT de CLI fino: só `main()` +
  `printReport()`, chamado incondicionalmente no topo do módulo.
- `apps/worker/src/index.ts` — chama `runSelfTest('full')` no boot, ANTES de
  `startWorkers()`; substitui o antigo `prisma.$connect()` isolado.
- `apps/worker/tsup.config.ts` — `selftest.ts` como 3º entry (mesma regra do
  backfill: script operacional = entrada do tsup).
- `apps/worker/Dockerfile` — `HEALTHCHECK` novo (`node dist/selftest.js
  --ping`, `--interval=30s --timeout=20s --start-period=40s --retries=3`) +
  corrigido o aviso "não validado" que já estava desatualizado (ver
  cabeçalho do arquivo — um build real JÁ tinha acontecido e corrigido o bug
  do `pwuser`).
- `.github/workflows/ci.yml` — job novo `worker-selftest` (`needs:
  build-and-test`): builda o worker de verdade (`tsup`), sobe `services:
  postgres`/`redis` efêmeros, instala Chromium via `pnpm --filter
  @inno/scraper exec playwright install --with-deps chromium` (mesma versão
  pinada, sem duplicar número no workflow) e roda `node dist/selftest.js`.
- `DEPLOY.md` — §6 (worker) atualizado, §7.2 (uso manual de `selftest.js`),
  §8/§8.1 novo (procedimento de verificação do `X-Forwarded-For`, ver
  [[infra_xff_easypanel_verificacao]]), §9 (CI com 2 jobs) reescrito.

## Dois bugs reais que eu mesmo introduzi e corrigi na hora — guardar os dois

**1. Tree-shaking/code-splitting do tsup engoliu o gatilho de CLI.** 1ª versão
tinha TUDO (biblioteca + `main()` + `if (isDirectRun)`) num arquivo só,
importado tanto por `index.ts` quanto sendo o próprio entry do tsup. Como
DOIS entries importavam partes do mesmo módulo, o esbuild moveu o módulo
INTEIRO para um chunk compartilhado — `import.meta.url` dentro do chunk
nunca é igual ao caminho de `process.argv[1]` (que é o do ENTRY, não do
chunk), então `isDirectRun` era sempre `false` e `node dist/selftest.js`
saía com código 0 SEM RODAR NENHUM PASSO. Só descobri rodando o `node
dist/selftest.js` de verdade e vendo o arquivo de saída ter 369 bytes (só
re-exports) — nunca teria pego isso só com typecheck/lint/test, que é
EXATAMENTE a classe de bug que este projeto existe para não deixar passar.
**Correção estrutural:** biblioteca (`selftest-checks.ts`, sem NENHUM efeito
colateral de topo-de-módulo) separada do entrypoint de CLI
(`selftest.ts`, só `main()`, chamado incondicionalmente, sem `isDirectRun`)
— o entrypoint não é importado por mais ninguém, então não há por que o
tsup o mover para um chunk. **Regra geral: qualquer entry do tsup que
TAMBÉM seja importado como biblioteca por outro entry precisa ter o
gatilho de execução (`main()`/`if (require.main)`/`isDirectRun`) num
arquivo PRÓPRIO, nunca misturado com o código reutilizável.**

**2. `ioredis` retry infinito = hang sem fim, sem sinal nenhum.**
`bullConnectionOptions()` não define `retryStrategy` nem `connectTimeout` —
o default do `ioredis` tenta reconectar PARA SEMPRE. Rodei `node dist/
selftest.js` manualmente sem Redis disponível e ele travou por > 120s (achei
via `wmic process ... get CommandLine,ProcessId` + `taskkill /F /PID` — não
existe "kill background job" na minha ferramenta, tive que identificar o PID
específico do processo `node dist/selftest.js` para não matar o `next dev`
que estava rodando ao lado). **Correção:** `runSteps` agora tem timeout por
passo (`DEFAULT_STEP_TIMEOUT_MS=20s` cheio, `PING_STEP_TIMEOUT_MS=8s` no modo
`--ping`) via `Promise.race` + `setTimeout.unref()`; e o CLI faz
`process.exit()` explícito no final (não só `process.exitCode = ...`) porque
`Promise.race` NÃO cancela a promessa perdedora — uma conexão/retry
abandonada continua rodando em segundo plano e seguraria o event loop
indefinidamente se eu confiasse em drenagem natural. **Regra geral: todo
"selftest"/healthcheck que depende de I/O externo precisa de timeout PRÓPRIO
— nunca confiar que a lib cliente (ioredis, ou qualquer coisa com retry
automático) vai desistir sozinha.**

## Achado colateral, NÃO corrigido (fora do meu escopo de arquivo)
`apps/worker/src/lib/queue-state.ts#recordHeartbeat` chama `client.set(key,
value, { EX: HEARTBEAT_TTL_SECONDS })` — sintaxe de OPÇÕES em objeto, que é
da lib `redis` (node-redis v4), não do `ioredis` (que usa argumentos
posicionais: `set(key, value, 'EX', seconds)`). Isto É `ioredis` aqui
(`bullmq` usa `ioredis` por baixo, confirmado em `node_modules/.pnpm/
ioredis@5.11.1/.../RedisCommander.d.ts`). Não testei se isso de fato lança em
runtime (não tenho Redis nesta máquina) nem toquei no arquivo (fora do meu
escopo desta entrega, território do Vega/quem escreveu `queue-state.ts`) —
reportado ao Atlas para alguém confirmar contra Redis real. Se lançar, o
heartbeat nunca é gravado com TTL e `scheduler.ts` loga erro a cada 15s
silenciosamente engolido (`.catch(err => logger.error(...))`) — sintoma:
`checkHeartbeat` do meu `--ping` reportaria "chave ausente" mesmo com o
worker saudável.

## Armadilha do working tree compartilhado (2 agentes, mesma pasta, sem worktree)
Vega editava `packages/db/prisma/schema.prisma`/`observability/sanity.ts`/
`packages/scraper/**` AO VIVO enquanto eu rodava `pnpm typecheck` — vi o
mesmo comando falhar, depois passar, com o número de erros mudando entre
duas execuções segundos depois (linha 94→108, `fill_rate_enrichment`
aparecendo e desaparecendo). **Não é regressão minha nem dele — é o preço de
dois agentes na mesma working copy sem isolamento.** Antes de reportar uma
falha de typecheck como sua, cheque `git status`/`git diff` no arquivo
apontado — se estiver fora do seu escopo de arquivos E modificado (dirty),
é sinal de trabalho concorrente, não bug seu.

Ver [[infra_ci_github_actions]] (job 1, que este job 2 complementa) e
[[feedback_playwright_chromium_version_pin]] (por que a versão do Chromium
tem que casar nos dois lados, agora também no CI).
