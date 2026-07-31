/**
 * GET /api/v1/locations/ufs — ARQUITETURA §4.1.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@inno/db';
import type { ListUfsResponse } from '@inno/contracts';
import { apiRoute } from '@/lib/api-handler';

export const GET = apiRoute({
  handler: async () => {
    const ufs = await prisma.uf.findMany({
      orderBy: { nome: 'asc' },
      include: { _count: { select: { cities: true } } },
    });

    const body: ListUfsResponse = {
      data: ufs.map((uf) => ({
        id: uf.sigla,
        sigla: uf.sigla,
        nome: uf.nome,
        cityCount: uf._count.cities,
      })),
    };
    return NextResponse.json(body);
  },
});
