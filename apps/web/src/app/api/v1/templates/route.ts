/**
 * GET /api/v1/templates, POST /api/v1/templates — ARQUITETURA §4.4.
 */
import { NextResponse } from 'next/server';
import { createTemplateBodySchema, listTemplatesQuerySchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { createTemplate, listTemplates } from '@/lib/services/templates';

export const GET = apiRoute({
  querySchema: listTemplatesQuerySchema,
  handler: async ({ query }) => {
    const result = await listTemplates(query);
    return NextResponse.json(result);
  },
});

export const POST = apiRoute({
  bodySchema: createTemplateBodySchema,
  handler: async ({ body, session }) => {
    const result = await createTemplate(body, session!.user.id);
    return NextResponse.json(result, { status: 201 });
  },
});
