import { defineConfig } from 'vitest/config';

/**
 * Infra de teste de `apps/worker`. `passWithNoTests` foi removido em
 * 2026-09-23 (Íris) — `createScrapeSearchProcessor`
 * (`jobs/scrape-search.job.test.ts`) passou a ter cobertura de verdade,
 * então o CI agora deve voltar a FALHAR se `src/**` ficar sem nenhum teste
 * (regressão de infra), em vez de passar silenciosamente.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
