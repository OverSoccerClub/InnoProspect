import { defineConfig } from 'vitest/config';

/**
 * Infra de teste de `apps/worker` — REVISAO-QA.md §3/§6: até esta rodada não
 * havia NENHUM teste aqui. `passWithNoTests: true` é DELIBERADO nesta
 * rodada: `apps/worker/src/**` inteiro está sendo alterado em paralelo (ver
 * handoff do Atlas) — escrever teste contra esse código agora quebraria sob
 * os pés de quem está mexendo nele. O critério de pronto ("infra existe, `pnpm
 * test` roda") fica satisfeito sem arquivo de teste nenhum aqui; assim que o
 * código estabilizar, `scrape-search.job.test.ts` (prioridade #5 do
 * REVISAO-QA.md §4) é o primeiro a entrar — remover `passWithNoTests` nesse
 * momento, para o CI voltar a falhar se o diretório ficar sem teste de novo.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
