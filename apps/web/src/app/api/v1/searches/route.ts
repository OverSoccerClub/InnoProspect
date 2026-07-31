/**
 * POST /api/v1/searches, GET /api/v1/searches — ARQUITETURA §4.2.
 */
import { NextResponse } from 'next/server';
import { createSearchJobBodySchema, listSearchJobsQuerySchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { createSearchJob, listSearchJobs } from '@/lib/services/searches';

export const GET = apiRoute({
  querySchema: listSearchJobsQuerySchema,
  handler: async ({ query }) => {
    const result = await listSearchJobs(query);
    return NextResponse.json(result);
  },
});

export const POST = apiRoute({
  bodySchema: createSearchJobBodySchema,
  handler: async ({ body, session }) => {
    const result = await createSearchJob(body, session!.user.id);
    return NextResponse.json(result, { status: 201 });
  },
});
