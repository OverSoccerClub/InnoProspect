/**
 * GET /api/v1/locations/ufs/:sigla/cities?q=&limit= — ARQUITETURA §4.1.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@inno/db';
import { listCitiesQuerySchema, ufSchema, type ListCitiesResponse } from '@inno/contracts';
import { apiRoute, notFound } from '@/lib/api-handler';

const paramsSchema = z.object({ sigla: ufSchema });

export const GET = apiRoute({
  paramsSchema,
  querySchema: listCitiesQuerySchema,
  handler: async ({ params, query }) => {
    const uf = await prisma.uf.findUnique({ where: { sigla: params.sigla } });
    if (!uf) notFound(`UF "${params.sigla}" não encontrada.`);

    const cities = await prisma.city.findMany({
      where: {
        uf: params.sigla,
        ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
      },
      orderBy: [{ population: 'desc' }, { name: 'asc' }],
      take: query.limit,
    });

    const body: ListCitiesResponse = {
      data: cities.map((city) => ({
        ibgeCode: city.ibgeCode,
        nome: city.name,
        slug: city.slug,
        population: city.population,
      })),
    };
    return NextResponse.json(body);
  },
});
