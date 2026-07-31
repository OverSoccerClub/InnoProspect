/**
 * GET /api/v1/searches/:id — ARQUITETURA §4.2. Alvo do polling de 3s da
 * tela de progresso (Lyra) enquanto `status ∈ {queued, running}`.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { idSchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { getSearchJobDetail } from '@/lib/services/searches';

const paramsSchema = z.object({ id: idSchema });

export const GET = apiRoute({
  paramsSchema,
  handler: async ({ params }) => {
    const detail = await getSearchJobDetail(params.id);
    return NextResponse.json(detail);
  },
});
