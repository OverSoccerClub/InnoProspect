/**
 * GET/POST /api/v1/dispatch/queue — 🆕 Fase 4.F.3. `GET`: status do freio
 * global do motor de disparo (pausado/rodando + heartbeat do tick). `POST`:
 * pausa (o botão único do incidente, ARQUITETURA §6.8.9) — sem
 * confirmação de propósito, para funcionar em UM clique sob estresse.
 * `requireRole: 'admin'` no `POST` — mesma régua de `POST /api/v1/scraper/
 * queue/resume` (ação de administração operacional).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiRoute } from '@/lib/api-handler';
import { getDispatchQueueStatus, pauseDispatchQueue } from '@/lib/services/dispatch';

export const GET = apiRoute({
  handler: async () => {
    const status = await getDispatchQueueStatus();
    return NextResponse.json(status);
  },
});

/**
 * Corpo TODO opcional — a tela não envia nada (pausar é um clique, §6.8.9).
 * `reason` existe para quem chama a API direto (runbook, script de
 * incidente) poder deixar escrito o porquê; `.optional()` no objeto inteiro
 * mantém `POST` sem corpo válido, que é o caminho da tela.
 */
const bodySchema = z.object({ reason: z.string().trim().min(1).max(280).optional() }).optional();

export const POST = apiRoute({
  requireRole: 'admin',
  bodySchema,
  handler: async ({ body, session }) => {
    const result = await pauseDispatchQueue({ id: session!.user.id, email: session!.user.email }, body?.reason);
    return NextResponse.json(result);
  },
});
