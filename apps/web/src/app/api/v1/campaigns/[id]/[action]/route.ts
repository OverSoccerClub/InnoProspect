/**
 * POST /api/v1/campaigns/:id/{start|pause|resume|cancel} — ARQUITETURA
 * §4.5.9. `bodySchema` é o schema de `resume` tornado OPCIONAL no topo — ele
 * aceita corpo ausente (`start`/`pause`/`cancel`, que não usam corpo) e
 * `{ acknowledgeHalt }` (`resume`). Não dá para escolher o `bodySchema` só
 * depois de saber `params.action` — `apiRoute` já consome `req.text()` uma
 * única vez ANTES do handler rodar (`lib/api-handler.ts`), então um 2º
 * `req.text()` aqui dentro quebraria com "body already read".
 */
import { NextResponse } from 'next/server';
import { campaignActionSchema, idSchema, resumeCampaignBodySchema } from '@inno/contracts';
import { z } from 'zod';
import { apiRoute, badRequest } from '@/lib/api-handler';
import { cancelCampaign, pauseCampaign, resumeCampaign, startCampaign } from '@/lib/services/campaigns';

const paramsSchema = z.object({ id: idSchema, action: campaignActionSchema });
const bodySchema = resumeCampaignBodySchema.optional();

export const POST = apiRoute({
  paramsSchema,
  bodySchema,
  handler: async ({ params, body }) => {
    if (params.action === 'start') {
      const result = await startCampaign(params.id);
      return NextResponse.json(result);
    }
    if (params.action === 'pause') {
      const result = await pauseCampaign(params.id);
      return NextResponse.json(result);
    }
    if (params.action === 'resume') {
      const result = await resumeCampaign(params.id, body ?? {});
      return NextResponse.json(result);
    }
    if (params.action === 'cancel') {
      const result = await cancelCampaign(params.id);
      return NextResponse.json(result);
    }
    badRequest(`Ação desconhecida: "${params.action}".`);
  },
});
