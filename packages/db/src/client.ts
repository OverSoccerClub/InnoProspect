import { PrismaClient } from './generated/client/index.js';

/**
 * Singleton do PrismaClient.
 *
 * Por quê singleton: em dev, o Next.js (apps/web) recarrega módulos a cada
 * mudança de arquivo (HMR/Fast Refresh). Sem o cache em `globalThis`, cada
 * reload criaria uma nova instância de PrismaClient — e cada instância abre
 * seu próprio pool de conexões com o Postgres, esgotando o limite de
 * conexões do banco em poucos minutos de desenvolvimento. Em produção
 * (`NODE_ENV=production`) isso não acontece (o processo não recarrega
 * módulos), então lá sempre criamos uma instância nova e normal.
 *
 * `apps/worker` importa este mesmo client — é o processo 2 do sistema
 * (ARQUITETURA.md §1.2) e compartilha o banco com `apps/web`, nunca chama a
 * web por HTTP.
 */

declare global {
  // eslint-disable-next-line no-var
  var __innoProspectPrisma: PrismaClient | undefined;
}

function createPrismaClient() {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
  });
}

export const prisma: PrismaClient = globalThis.__innoProspectPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__innoProspectPrisma = prisma;
}
