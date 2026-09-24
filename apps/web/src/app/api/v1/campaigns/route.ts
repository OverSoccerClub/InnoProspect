/**
 * GET /api/v1/campaigns, POST /api/v1/campaigns — ARQUITETURA §4.5.4/§4.5.7.
 * Sem `requireRole`: campanha é ferramenta de trabalho do operador do dia a
 * dia (como leads/templates), não infraestrutura administrada só por admin
 * (diferente de `/whatsapp/instances`/`/users`, ver `convention-admin-role-
 * and-user-crud` na memória do Vega).
 */
import { NextResponse } from 'next/server';
import { createCampaignBodySchema, listCampaignsQuerySchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { createCampaign, listCampaigns } from '@/lib/services/campaigns';

export const GET = apiRoute({
  querySchema: listCampaignsQuerySchema,
  handler: async ({ query }) => {
    const result = await listCampaigns(query);
    return NextResponse.json(result);
  },
});

export const POST = apiRoute({
  bodySchema: createCampaignBodySchema,
  handler: async ({ body, session }) => {
    const result = await createCampaign(body, session!.user.id);
    return NextResponse.json(result, { status: 201 });
  },
});
