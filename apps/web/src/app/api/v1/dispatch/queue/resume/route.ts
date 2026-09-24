/**
 * POST /api/v1/dispatch/queue/resume — 🆕 Fase 4.F.3: liga/retoma o motor de
 * disparo. Exige `{ acknowledge: true }` no corpo (mesmo espírito de `POST
 * /api/v1/scraper/queue/resume`) — LIGAR é a ação de maior risco deste par
 * de rotas (ARQUITETURA §6.8.9: "a primeira ativação é com 1 instância,
 * campanha curta, dentro da janela comercial e com alguém olhando"), então é
 * a que carrega a confirmação explícita — PAUSAR (`POST /api/v1/dispatch/
 * queue`) não tem, de propósito.
 *
 * `409 CONFLICT` se o motor já estiver rodando (idempotência: chamar duas
 * vezes não é erro de sistema). `requireRole: 'admin'`.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiRoute } from '@/lib/api-handler';
import { resumeDispatchQueue } from '@/lib/services/dispatch';

const bodySchema = z.object({ acknowledge: z.literal(true) });

export const POST = apiRoute({
  requireRole: 'admin',
  bodySchema,
  handler: async ({ session }) => {
    const result = await resumeDispatchQueue({ id: session!.user.id, email: session!.user.email });
    return NextResponse.json(result);
  },
});
