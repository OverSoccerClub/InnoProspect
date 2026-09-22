/**
 * GET /api/v1/dashboard/summary — painel logado (contrato fechado com Lyra,
 * `@inno/contracts#dashboardSummarySchema`).
 */
import { NextResponse } from 'next/server';
import { apiRoute } from '@/lib/api-handler';
import { getDashboardSummary } from '@/lib/services/dashboard';

export const GET = apiRoute({
  handler: async () => {
    const result = await getDashboardSummary();
    return NextResponse.json(result);
  },
});
