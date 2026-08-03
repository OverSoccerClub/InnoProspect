/**
 * GET /api/v1/templates/:id, PATCH /api/v1/templates/:id,
 * DELETE /api/v1/templates/:id — ARQUITETURA §4.4.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { idSchema, patchTemplateBodySchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { deleteTemplate, getTemplate, patchTemplate } from '@/lib/services/templates';

const paramsSchema = z.object({ id: idSchema });

export const GET = apiRoute({
  paramsSchema,
  handler: async ({ params }) => {
    const template = await getTemplate(params.id);
    return NextResponse.json(template);
  },
});

export const PATCH = apiRoute({
  paramsSchema,
  bodySchema: patchTemplateBodySchema,
  handler: async ({ params, body }) => {
    const result = await patchTemplate(params.id, body);
    return NextResponse.json(result);
  },
});

export const DELETE = apiRoute({
  paramsSchema,
  handler: async ({ params }) => {
    await deleteTemplate(params.id);
    return new NextResponse(null, { status: 204 });
  },
});
