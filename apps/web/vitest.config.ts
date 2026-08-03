import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// __dirname não existe em ESM ("type": "module" no package.json do app) —
// mesmo truque usado em next.config.ts, só para resolver o alias `@/*`
// abaixo (o `tsconfig.json` já declara `@/*` -> `./src/*`, mas isso é só
// para o `tsc`; o Vitest/Vite precisa do alias próprio).
const currentDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Infra de teste de `apps/web` — REVISAO-QA.md §3/§6: até esta rodada não
 * havia NENHUM teste aqui (zero `vitest`, zero script `test`). Cobre só
 * `src/**\/*.test.ts` (unitário, com Prisma mockado — ver `src/test/fake-db.ts`
 * e os comentários em cada `*.test.ts`). Testes que exigem Postgres/Redis
 * reais (concorrência de transação, constraint única de verdade) NÃO cabem
 * aqui — ver REVISAO-QA.md §3 "O que exige ambiente vivo".
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(currentDir, './src'),
    },
  },
});
