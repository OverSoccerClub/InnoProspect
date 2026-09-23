/**
 * GET /api/v1/users/:id, PATCH /api/v1/users/:id, DELETE /api/v1/users/:id —
 * `requireRole: 'admin'` (operador recebe `403 FORBIDDEN`). `DELETE` é
 * soft-delete (`isActive: false`, nunca remove a linha — ver
 * `lib/services/users.ts`). Autoproteção (não pode se excluir/rebaixar) e
 * "nunca zero admin" vivem no serviço, não aqui.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { idSchema, updateUserBodySchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { deactivateUser, getUser, updateUser } from '@/lib/services/users';

const paramsSchema = z.object({ id: idSchema });

export const GET = apiRoute({
  requireRole: 'admin',
  paramsSchema,
  handler: async ({ params }) => {
    const result = await getUser(params.id);
    return NextResponse.json(result);
  },
});

export const PATCH = apiRoute({
  requireRole: 'admin',
  paramsSchema,
  bodySchema: updateUserBodySchema,
  handler: async ({ params, body, session }) => {
    const result = await updateUser(params.id, body, session!.user);
    return NextResponse.json(result);
  },
});

export const DELETE = apiRoute({
  requireRole: 'admin',
  paramsSchema,
  handler: async ({ params, session }) => {
    await deactivateUser(params.id, session!.user);
    return new NextResponse(null, { status: 204 });
  },
});
