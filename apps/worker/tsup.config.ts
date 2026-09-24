import { defineConfig } from 'tsup';

// HISTÓRICO (Vulcano, 2026-09-22): o worker buildava e subia no EasyPanel, mas
// morria no boot com `ERR_UNKNOWN_FILE_EXTENSION` tentando carregar
// `packages/db/src/index.ts` — por padrão o tsup marca `workspace:*` como
// dependência EXTERNA (não bundla), então `dist/index.js` continuava com
// `import ... from '@inno/db'`/`@inno/core'`/`@inno/scraper'`, e em produção o
// Node resolve isso via `node_modules` (symlink do pnpm pro CÓDIGO-FONTE em
// `packages/*/src`) — que é `.ts` puro, sem etapa de build própria. O
// `apps/web` nunca sentiu isso porque o Next transpila esses pacotes
// (`transpilePackages`); o worker, rodando `node dist/index.js` puro, não tem
// esse tratamento.
//
// `@inno/core`, `@inno/contracts` e `@inno/scraper` são só TypeScript (sem
// binário nativo, sem asset lido por caminho relativo em runtime — conferido
// em 2026-09-22) — seguros para embutir dentro do bundle do worker.
//
// 🆕 Fase 4.F.0 — `@inno/sending` (motor de disparo, ARQUITETURA §6.8.0)
// entrou no `noExternal` pelo MESMO motivo: é só TypeScript, importa
// `@inno/db`/`@inno/core`/`@inno/messaging` (nenhum dos três tem binário
// nativo próprio — `@inno/db` continua external, ver comentário abaixo) e
// NENHUM `next/*`/`process.env` (contrato do pacote, `packages/sending/
// src/ports.ts`). Ficar FORA daqui repetiria, byte a byte, o incidente de
// 22/09: o bundle mantém `import '@inno/sending'`, o Node resolve para o
// `.ts` fonte via symlink do pnpm, e o processo morre no boot com
// `ERR_UNKNOWN_FILE_EXTENSION` — só aparece no boot do CONTAINER, nunca em
// `pnpm typecheck`/`lint`/`build` na máquina de quem escreveu.
export default defineConfig({
  // O segundo entry NÃO é conveniência: sem ele o backfill é impossível de
  // rodar em produção. A imagem final (stage `runner` do Dockerfile) não tem
  // `pnpm`, não tem `tsx` e não copia `src/` — só `dist/`, o `package.json` e
  // o node_modules de produção. Um script que só existe como `.ts` executado
  // por `tsx` funciona na máquina de quem escreveu e falha no container com
  // `pnpm: not found`, que foi exatamente o que aconteceu em 2026-09-23
  // quando o dono foi rodar o backfill de `offNiche`.
  //
  // Regra para o próximo script operacional (backfill, migração de dado,
  // reprocessamento): ele entra AQUI, e a instrução de uso é
  // `node dist/<nome>.js` — nunca `pnpm run <script>`, que pressupõe um
  // ambiente de desenvolvimento que a imagem de produção não tem.
  // `src/selftest.ts` (Vulcano, 2026-09-23) segue a MESMA regra do backfill
  // acima: `node dist/selftest.js`/`node dist/selftest.js --ping` precisam
  // rodar na imagem final (CI e `HEALTHCHECK` do Dockerfile), que não tem
  // `pnpm`/`tsx`/`src/`. Ver o cabeçalho de `selftest.ts` para o que cada
  // modo verifica e por quê os dois custam diferente de propósito.
  entry: ['src/index.ts', 'src/scripts/backfill-off-niche.ts', 'src/selftest.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  sourcemap: true,
  // `@inno/db` fica DE FORA de propósito (não entra aqui, continua external —
  // comportamento default do tsup para workspace:*). Ele expõe o Prisma
  // Client GERADO (`packages/db/src/generated/client`), cujo carregamento do
  // query engine nativo é resolvido por `__dirname` relativo ao PRÓPRIO
  // arquivo gerado (`config.dirname = __dirname` em
  // `generated/client/index.js`). Se `@inno/db` fosse embutido aqui, esse
  // `__dirname` passaria a ser `apps/worker/dist/`, e o engine desapareceria —
  // erro que só apareceria em runtime, contra banco real. Em vez disso,
  // `@inno/db` ganhou build próprio (`tsc -p tsconfig.build.json`, compila só
  // `index.ts`/`client.ts` EM LUGAR, ao lado do `.ts`) e continua sendo
  // resolvido normalmente via `node_modules` — ver `packages/db/package.json`
  // (`exports`) e `packages/db/tsconfig.build.json`.
  noExternal: [/^@inno\/(core|contracts|scraper|sending)$/],
  // `playwright` PRECISA ficar external de forma EXPLÍCITA (não basta o
  // default do tsup/esbuild): o default só marca como external o que já
  // está nas `dependencies` do PRÓPRIO package.json (apps/worker) — como
  // `playwright` é dependência de `@inno/scraper`, não do worker, ele passa a
  // ser alcançado pelo grafo de import só DEPOIS que `@inno/scraper` entrou
  // no `noExternal` acima, e o esbuild tenta inliná-lo. Isso quebra o build:
  // o próprio `playwright-core` faz `require('chromium-bidi/...')`
  // condicional (feature-detectado em runtime, dependência opcional que este
  // projeto não instala) e o esbuild tenta resolver estaticamente e falha.
  // Confirmado empiricamente em 2026-09-22 (build falhava com "Could not
  // resolve chromium-bidi/..." antes deste `external`).
  external: ['playwright'],
  // INCIDENTE 2 (produção, 2026-09-22, logo depois de embutir os pacotes):
  // `Error: Dynamic require of "buffer" is not supported`, vindo de
  // `iconv-lite`/`safer-buffer` (chegam por `@inno/scraper` → `cheerio` →
  // `encoding-sniffer`). São pacotes em CommonJS: ao serem embutidos num
  // bundle ESM, os `require()` deles viram um atalho do esbuild que LANÇA,
  // porque `require` não existe em módulo ESM.
  //
  // O próprio atalho gerado já tem a saída: ele começa com
  // `typeof require !== "undefined" ? require : (…lança…)`. Basta existir um
  // `require` de verdade no escopo do arquivo. `createRequire` é a forma
  // oficial do Node de obter um, e o `import.meta.url` ancora a resolução no
  // próprio `dist/index.js` — então os pacotes CommonJS embutidos passam a
  // resolver como resolveriam fora do bundle.
  //
  // Alternativa descartada: marcar `cheerio` e companhia como `external`.
  // Resolveria este caso e deixaria a mesma armadilha armada para a próxima
  // dependência CommonJS que entrasse pelo grafo — o banner cobre a classe
  // inteira do problema, não só a ocorrência de hoje.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
});
