/**
 * DELETE /api/v1/optouts/:id — ARQUITETURA §4.7/§6.7 item 5. Exige `role=admin`.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { idSchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { deleteOptOut } from '@/lib/services/optouts';

const paramsSchema = z.object({ id: idSchema });

export const DELETE = apiRoute({
  paramsSchema,
  handler: async ({ params, session }) => {
    await deleteOptOut(params.id, session!.user);
    return new NextResponse(null, { status: 204 });
  },
});
