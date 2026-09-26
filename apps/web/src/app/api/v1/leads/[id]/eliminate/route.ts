/**
 * POST /api/v1/leads/:id/eliminate — 🆕 Fase 5.3 (ARQUITETURA §7.3/§7.4,
 * direito de Eliminação do titular, ação `delete_lead_data`). Irreversível
 * (exclusão física) — exige `role=admin` E `{ acknowledge: true }` no corpo,
 * mesmo rigor de confirmação do `POST /api/v1/dispatch/queue/resume` (a
 * ação de MAIOR risco daquele par de rotas). `bodySchema` com `z.literal(true)`
 * já recusa `{}`/`{ acknowledge: false }` como `400 VALIDATION_ERROR`, antes
 * de qualquer lógica de negócio rodar.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eliminateLeadDataBodySchema, idSchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { eliminateLeadData } from '@/lib/services/leads';

const paramsSchema = z.object({ id: idSchema });

export const POST = apiRoute({
  requireRole: 'admin',
  paramsSchema,
  bodySchema: eliminateLeadDataBodySchema,
  handler: async ({ params, session }) => {
    const result = await eliminateLeadData(params.id, session!.user.id);
    return NextResponse.json(result);
  },
});
