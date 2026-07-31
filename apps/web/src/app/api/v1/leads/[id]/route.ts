/**
 * GET /api/v1/leads/:id, PATCH /api/v1/leads/:id — ARQUITETURA §4.3.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { idSchema, patchLeadBodySchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { getLeadDetail, patchLead } from '@/lib/services/leads';

const paramsSchema = z.object({ id: idSchema });

export const GET = apiRoute({
  paramsSchema,
  handler: async ({ params }) => {
    const detail = await getLeadDetail(params.id);
    return NextResponse.json(detail);
  },
});

export const PATCH = apiRoute({
  paramsSchema,
  bodySchema: patchLeadBodySchema,
  handler: async ({ params, body, session }) => {
    const result = await patchLead(params.id, body, session!.user.id);
    return NextResponse.json(result);
  },
});
