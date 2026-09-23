/**
 * GET /api/v1/users, POST /api/v1/users — CRUD de usuários do sistema.
 * `requireRole: 'admin'` (operador recebe `403 FORBIDDEN`) — ver comentário
 * completo em `lib/api-handler.ts#ApiRouteOptions.requireRole` e a decisão
 * de escopo em `lib/services/users.ts`.
 */
import { NextResponse } from 'next/server';
import { createUserBodySchema, listUsersQuerySchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { createUser, listUsers } from '@/lib/services/users';

export const GET = apiRoute({
  requireRole: 'admin',
  querySchema: listUsersQuerySchema,
  handler: async ({ query }) => {
    const result = await listUsers(query);
    return NextResponse.json(result);
  },
});

export const POST = apiRoute({
  requireRole: 'admin',
  bodySchema: createUserBodySchema,
  handler: async ({ body }) => {
    const result = await createUser(body);
    return NextResponse.json(result, { status: 201 });
  },
});
