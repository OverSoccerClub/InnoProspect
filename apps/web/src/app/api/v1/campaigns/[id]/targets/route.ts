/** GET /api/v1/campaigns/:id/targets — ARQUITETURA §4.5.7. */
import { NextResponse } from 'next/server';
import { idSchema, listCampaignTargetsQuerySchema } from '@inno/contracts';
import { z } from 'zod';
import { apiRoute } from '@/lib/api-handler';
import { listCampaignTargets } from '@/lib/services/campaigns';

const paramsSchema = z.object({ id: idSchema });

export const GET = apiRoute({
  paramsSchema,
  querySchema: listCampaignTargetsQuerySchema,
  handler: async ({ params, query }) => {
    const result = await listCampaignTargets(params.id, query);
    return NextResponse.json(result);
  },
});
