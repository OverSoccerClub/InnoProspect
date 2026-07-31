/**
 * GET /api/v1/health — pública (sem sessão, `middleware.ts` deixa passar),
 * usada por healthcheck de infra (Docker/Vulcano). Não devolve o envelope de
 * erro padrão em caso de falha porque quem consome isto normalmente é uma
 * ferramenta de orquestração, não a UI — só um `200`/`503` simples.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@inno/db';
import { apiRoute } from '@/lib/api-handler';

export const GET = apiRoute({
  requireAuth: false,
  handler: async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return NextResponse.json({ status: 'ok', database: 'ok', time: new Date().toISOString() });
    } catch {
      return NextResponse.json({ status: 'degraded', database: 'error', time: new Date().toISOString() }, { status: 503 });
    }
  },
});
