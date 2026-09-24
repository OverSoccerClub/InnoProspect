/**
 * GET /api/v1/campaigns/:id, PATCH /api/v1/campaigns/:id,
 * DELETE /api/v1/campaigns/:id — ARQUITETURA §4.5.5/§4.5.6/§4.5.7.
 */
import { NextResponse } from 'next/server';
import { idSchema, patchCampaignBodySchema } from '@inno/contracts';
import { z } from 'zod';
import { apiRoute } from '@/lib/api-handler';
import { deleteCampaign, getCampaignDetail, patchCampaign } from '@/lib/services/campaigns';

const paramsSchema = z.object({ id: idSchema });

export const GET = apiRoute({
  paramsSchema,
  handler: async ({ params }) => {
    const result = await getCampaignDetail(params.id);
    return NextResponse.json(result);
  },
});

export const PATCH = apiRoute({
  paramsSchema,
  bodySchema: patchCampaignBodySchema,
  handler: async ({ params, body }) => {
    const result = await patchCampaign(params.id, body);
    return NextResponse.json(result);
  },
});

export const DELETE = apiRoute({
  paramsSchema,
  handler: async ({ params }) => {
    await deleteCampaign(params.id);
    return new NextResponse(null, { status: 204 });
  },
});
