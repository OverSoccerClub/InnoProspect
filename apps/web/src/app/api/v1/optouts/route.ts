/**
 * GET /api/v1/optouts, POST /api/v1/optouts — ARQUITETURA §4.7.
 */
import { NextResponse } from 'next/server';
import { createOptOutBodySchema, listOptOutsQuerySchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { createOptOut, listOptOuts } from '@/lib/services/optouts';

export const GET = apiRoute({
  querySchema: listOptOutsQuerySchema,
  handler: async ({ query }) => {
    const result = await listOptOuts(query);
    return NextResponse.json(result);
  },
});

export const POST = apiRoute({
  bodySchema: createOptOutBodySchema,
  handler: async ({ body, session }) => {
    const result = await createOptOut(body, session!.user.id);
    return NextResponse.json(result, { status: 201 });
  },
});
