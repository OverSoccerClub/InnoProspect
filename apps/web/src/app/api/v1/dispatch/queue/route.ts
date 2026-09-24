/**
 * GET/POST /api/v1/dispatch/queue — 🆕 Fase 4.F.3. `GET`: status do freio
 * global do motor de disparo (pausado/rodando + heartbeat do tick). `POST`:
 * pausa (o botão único do incidente, ARQUITETURA §6.8.9) — sem
 * confirmação de propósito, para funcionar em UM clique sob estresse.
 * `requireRole: 'admin'` no `POST` — mesma régua de `POST /api/v1/scraper/
 * queue/resume` (ação de administração operacional).
 */
import { NextResponse } from 'next/server';
import { apiRoute } from '@/lib/api-handler';
import { getDispatchQueueStatus, pauseDispatchQueue } from '@/lib/services/dispatch';

export const GET = apiRoute({
  handler: async () => {
    const status = await getDispatchQueueStatus();
    return NextResponse.json(status);
  },
});

export const POST = apiRoute({
  requireRole: 'admin',
  handler: async () => {
    const result = await pauseDispatchQueue();
    return NextResponse.json(result);
  },
});
