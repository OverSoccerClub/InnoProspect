/**
 * Ponto único de entrada de @inno/db. `apps/web` e `apps/worker` importam
 * SÓ daqui — nunca direto de `src/generated/client` ou `src/client.ts`
 * (mantém o import estável se o caminho de geração do Prisma mudar).
 */

export { prisma } from './client.js';

// Client, enums, tipos de model e namespace de utilitários (`Prisma`) do
// Prisma Client gerado — é assim que Vega monta os `where`/`select`/`include`
// tipados nas rotas de API e no worker.
export * from './generated/client/index.js';
