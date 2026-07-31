/**
 * GET /api/v1/leads — ARQUITETURA §4.3.
 */
import { NextResponse } from 'next/server';
import { listLeadsQuerySchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { listLeads } from '@/lib/services/leads';

export const GET = apiRoute({
  querySchema: listLeadsQuerySchema,
  handler: async ({ query }) => {
    const result = await listLeads(query);
    return NextResponse.json(result);
  },
});
