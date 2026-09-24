/**
 * POST /api/v1/campaigns/:id/targets/:targetId/send — disparo MANUAL de UM
 * alvo de campanha (🆕 Fase 4.D). Nenhum laço automático — o operador clica
 * alvo a alvo; o motor (`dispatch-tick.job`) é a Fase 4.F. Reusa o MESMO
 * portão de envio do `POST /leads/:id/messages`
 * (`lib/services/messages.ts#sendLeadMessage`) — ver `lib/services/
 * campaigns.ts#sendCampaignTargetMessage`.
 */
import { NextResponse } from 'next/server';
import { idSchema, sendCampaignTargetBodySchema } from '@inno/contracts';
import { z } from 'zod';
import { apiRoute } from '@/lib/api-handler';
import { sendCampaignTargetMessage } from '@/lib/services/campaigns';

const paramsSchema = z.object({ id: idSchema, targetId: idSchema });

export const POST = apiRoute({
  paramsSchema,
  bodySchema: sendCampaignTargetBodySchema,
  handler: async ({ params, body, session }) => {
    const result = await sendCampaignTargetMessage(params.id, params.targetId, body, { id: session!.user.id, role: session!.user.role });
    return NextResponse.json(result);
  },
});
