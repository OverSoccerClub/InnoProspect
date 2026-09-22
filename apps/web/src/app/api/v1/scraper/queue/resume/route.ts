/**
 * POST /api/v1/scraper/queue/resume — retomada manual da fila `scrape-search`
 * (Onda 1, item 1.2/1.3). Exige `{ acknowledge: true }` no corpo — confirmação
 * explícita de que um humano investigou o incidente, no mesmo espírito do
 * `acknowledgeHalt` que a ARQUITETURA §6.5/§6.6 já previa para campanhas.
 *
 * `409 CONFLICT` se a fila já não estiver pausada (idempotência: chamar duas
 * vezes não é erro de sistema, mas também não há nada pra fazer na segunda).
 * `200 { ok: true, status: 'running', resolvedIncidents }` no sucesso.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiRoute } from '@/lib/api-handler';
import { resumeScraperQueue } from '@/lib/services/scraper-health';

const bodySchema = z.object({ acknowledge: z.literal(true) });

export const POST = apiRoute({
  bodySchema,
  handler: async () => {
    const result = await resumeScraperQueue();
    return NextResponse.json(result);
  },
});
