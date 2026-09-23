/**
 * POST /api/v1/evolution-servers/:id/test-connection — "testar conexão" do
 * cadastro de servidor (Fase 4.B, pedido direto do dono: "sem isso, o dono
 * cadastra errado e só descobre quando uma instância falhar"). Sempre
 * `200`, mesmo quando o teste falha (`ok:false` é o RESULTADO, não um erro
 * da rota) — só `404` se `:id` não existir. `requireRole: 'admin'` (ver
 * `evolution-servers/route.ts`).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { idSchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { testEvolutionServerConnection } from '@/lib/services/evolution-servers';

const paramsSchema = z.object({ id: idSchema });

export const POST = apiRoute({
  requireRole: 'admin',
  paramsSchema,
  handler: async ({ params }) => {
    const result = await testEvolutionServerConnection(params.id);
    return NextResponse.json(result);
  },
});
