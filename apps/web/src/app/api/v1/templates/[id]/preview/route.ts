/**
 * POST /api/v1/templates/:id/preview — ARQUITETURA §4.4.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { idSchema, previewTemplateBodySchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { previewTemplate } from '@/lib/services/templates';

const paramsSchema = z.object({ id: idSchema });

export const POST = apiRoute({
  paramsSchema,
  bodySchema: previewTemplateBodySchema,
  handler: async ({ params, body }) => {
    const result = await previewTemplate(params.id, body);
    return NextResponse.json(result);
  },
});
