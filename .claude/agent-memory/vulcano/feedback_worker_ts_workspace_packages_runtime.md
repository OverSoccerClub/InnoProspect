---
name: feedback-worker-ts-workspace-packages-runtime
description: Incidente real de produção (worker morre no boot com ERR_UNKNOWN_FILE_EXTENSION) — pacotes internos que exportam .ts fonte quebram qualquer entrypoint Node puro, não só bundlers
metadata:
  type: feedback
---

## Pacote workspace que exporta `.ts` fonte direto (`"exports": { ".": "./src/index.ts" }`) só funciona atrás de um bundler/transpiler — nunca em `node dist/index.js` puro

Em 2026-09-22 o `apps/worker` buildou com sucesso no EasyPanel, subiu e morreu no boot:
`TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts" for
.../packages/db/src/index.ts`. Já estava sinalizado como risco em
[[infra_monorepo_scaffold]] desde a Fase 1.1 ("se algum desses pacotes virar
dependência real do worker, o Dockerfile precisa copiar o `package.json`
dele") — mas o risco real não era o `COPY` faltando (esse já estava certo),
era que **nenhum desses pacotes tinha etapa de build própria**: `main`/
`exports` apontavam pro `.ts` fonte, e o `apps/web` nunca sentiu isso porque o
Next transpila (`transpilePackages`). O `apps/worker` roda `node dist/index.js`
puro (via `tsup`, que por padrão trata `workspace:*` como `external` — não
bundla) — Node não entende `.ts`, ponto final.

**Por quê isso não apareceu antes:** o build (`tsup`) e o `typecheck` (`tsc`)
passam limpos com pacotes assim — os dois entendem `.ts` nativamente. O erro
só existe no `node dist/index.js` real, ou seja, só aparece no **boot do
container**, nunca em CI/lint/test. **Sempre que um workspace novo (worker,
ou qualquer outro processo standalone) passar a depender de um pacote interno
que exporta `.ts` fonte, isso precisa ser resolvido ANTES do primeiro deploy,
não descoberto por ele.**

**Como aplicar / correção adotada (2026-09-22):**
- Pacotes SEM binário nativo nem asset lido por caminho relativo em runtime
  (`@inno/core`, `@inno/contracts`, `@inno/scraper` — confirmado via grep por
  `readFileSync`/`__dirname`/`import(` fora de arquivos de teste) → **embutir
  no bundle do consumidor** via `noExternal` no `tsup.config.ts`
  (`apps/worker/tsup.config.ts`). Simples, sem tocar no pacote em si.
- Pacotes com binário nativo cujo carregamento depende de caminho relativo ao
  PRÓPRIO arquivo (`@inno/db`, por causa do Prisma Client gerado — o query
  engine é localizado via `config.dirname = __dirname` dentro de
  `generated/client/index.js`) **NÃO podem ser embutidos** — bundlar quebra
  esse `__dirname` (passa a apontar pro `dist/` do consumidor) e o erro só
  aparece em runtime, contra banco real. Solução: build próprio e mínimo
  (`tsc -p tsconfig.build.json`) compilando SÓ os arquivos manuscritos
  (`src/index.ts`, `src/client.ts`) **em lugar** — `rootDir`/`outDir` iguais
  a `src`, então o `.js` sai ao LADO do `.ts` e o import relativo pro
  `generated/client` (que fica intocado, gerado à parte pelo `prisma
  generate`) continua resolvendo sem reescrever nenhum caminho.
  `package.json#exports` ganhou condição `types` (aponta pro `.ts`, preserva
  fidelidade de tipos) + `default` (aponta pro `.js` compilado, é o que Node/
  webpack resolvem em runtime).

**Armadilha ao bundlar um pacote interno com `noExternal`:** o esbuild passa a
seguir TODO o grafo de import a partir dali, incluindo as dependências npm
REAIS desse pacote (não só o próprio pacote). `@inno/scraper` importa
`playwright`, e `playwright` faz `require()` condicional de `chromium-bidi`
(dependência opcional, feature-detectada em runtime, não instalada neste
projeto) — o esbuild tenta resolver estaticamente e falha o build
(`Could not resolve "chromium-bidi/..."`). Isso NÃO acontecia antes porque o
tsup só marca como external automaticamente o que já está listado nas
`dependencies` do package.json do PACOTE QUE ESTÁ BUILDANDO
(`apps/worker/package.json`) — `playwright` é dependência de `@inno/scraper`,
não do worker, então só passou a ser "alcançado" depois que `@inno/scraper`
entrou no `noExternal`. Correção: `external: ['playwright']` explícito no
`tsup.config.ts`, ao lado do `noExternal`. **Ao bundlar qualquer pacote
interno, sempre rodar o build de verdade e ler o erro do esbuild — não supor
que só as dependências diretas do pacote raiz importam.**

**Validação real feita (sem Docker/Postgres/Redis na máquina):**
- `node --input-type=module -e "import('./packages/db/src/index.js')"` — client
  compilado carrega sem erro, engine resolve via `__dirname` corretamente.
- `grep -on "@inno/[a-z]*" apps/worker/dist/index.js` — só `@inno/db`
  remanescente (core/contracts/scraper confirmados embutidos).
- `pnpm list --filter "worker..." playwright"` — prova que o mesmo filtro
  usado no `pnpm install --shamefully-hoist` do Dockerfile inclui `playwright`
  na árvore, sem precisar mutar o `node_modules` local de verdade (ver
  [[feedback_pnpm_docker_monorepo_gotchas]] — mesma lógica, um nível mais
  fundo na árvore de deps).
- `node apps/worker/dist/index.js` local falha em `Cannot find package
  'playwright'` — ESPERADO e não é regressão: local não tem
  `--shamefully-hoist`, só o Docker tem. Confirma que o `ERR_UNKNOWN_FILE_
  EXTENSION` original desapareceu (a falha mudou de classe, do jeito certo).
- **NÃO validado:** `docker build` real, boot do worker com Postgres/Redis
  reais, primeira conexão do Prisma Client dentro do container. Ver
  [[infra_deploy_easypanel]] para o padrão de "o que fica sem prova sem
  Docker nesta máquina".

Ver [[infra_monorepo_scaffold]] (aviso original que antecipou o risco) e
[[feedback_pnpm_docker_monorepo_gotchas]] (mesmo padrão de hoisting, deps
diretas vs. transitivas).
