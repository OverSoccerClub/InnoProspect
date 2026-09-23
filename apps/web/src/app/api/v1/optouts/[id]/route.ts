/**
 * DELETE /api/v1/optouts/:id — ARQUITETURA §4.7/§6.7 item 5. Exige
 * `role=admin` — `requireRole: 'admin'` (Onda 4, mecanismo central em
 * `lib/api-handler.ts`; antes desta rodada a checagem era um `if` ad-hoc
 * dentro de `deleteOptOut`, único lugar do código que verificava `role` —
 * migrado para não duplicar a lógica agora que existe um lugar próprio).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { idSchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { deleteOptOut } from '@/lib/services/optouts';

const paramsSchema = z.object({ id: idSchema });

export const DELETE = apiRoute({
  requireRole: 'admin',
  paramsSchema,
  handler: async ({ params, session }) => {
    await deleteOptOut(params.id, session!.user.id);
    return new NextResponse(null, { status: 204 });
  },
});
