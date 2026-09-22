/**
 * POST /api/v1/leads/bulk — ações em massa (ARQUITETURA §4.3, revisado
 * 2026-09-22: `expectedCount`/resposta por item, ver
 * `packages/contracts/src/lead.contract.ts`).
 */
import { NextResponse } from 'next/server';
import { bulkLeadsBodySchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { bulkUpdateLeads } from '@/lib/services/leads';

export const POST = apiRoute({
  bodySchema: bulkLeadsBodySchema,
  handler: async ({ body, session }) => {
    const result = await bulkUpdateLeads(body, session!.user.id);
    return NextResponse.json(result);
  },
});
