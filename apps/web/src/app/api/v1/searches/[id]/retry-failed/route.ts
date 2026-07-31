/**
 * POST /api/v1/searches/:id/retry-failed — ARQUITETURA §4.2.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { idSchema } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';
import { retryFailedSearchTasks } from '@/lib/services/searches';

const paramsSchema = z.object({ id: idSchema });

export const POST = apiRoute({
  paramsSchema,
  handler: async ({ params }) => {
    const result = await retryFailedSearchTasks(params.id);
    return NextResponse.json(result, { status: 202 });
  },
});
