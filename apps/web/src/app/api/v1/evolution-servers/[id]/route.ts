/**
 * GET /api/v1/evolution-servers/:id, PATCH /api/v1/evolution-servers/:id,
 * DELETE /api/v1/evolution-servers/:id — `requireRole: 'admin'` (ver
 * `evolution-servers/route.ts`). `DELETE` DESATIVA (`isActive: false`), não
 * apaga a linha — ver `lib/services/evolution-servers.ts`.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { idSchema, updateEvolutionServerBodySchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { deactivateEvolutionServer, getEvolutionServerDetail, updateEvolutionServer } from '@/lib/services/evolution-servers';

const paramsSchema = z.object({ id: idSchema });

export const GET = apiRoute({
  requireRole: 'admin',
  paramsSchema,
  handler: async ({ params }) => {
    const result = await getEvolutionServerDetail(params.id);
    return NextResponse.json(result);
  },
});

export const PATCH = apiRoute({
  requireRole: 'admin',
  paramsSchema,
  bodySchema: updateEvolutionServerBodySchema,
  handler: async ({ params, body }) => {
    const result = await updateEvolutionServer(params.id, body);
    return NextResponse.json(result);
  },
});

export const DELETE = apiRoute({
  requireRole: 'admin',
  paramsSchema,
  handler: async ({ params }) => {
    await deactivateEvolutionServer(params.id);
    return new NextResponse(null, { status: 204 });
  },
});
