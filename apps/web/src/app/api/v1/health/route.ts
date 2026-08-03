/**
 * GET /api/v1/health — pública (sem sessão, `middleware.ts` deixa passar),
 * usada por healthcheck de infra (EasyPanel). Não devolve o envelope de erro
 * padrão em caso de falha porque quem consome isto normalmente é uma
 * ferramenta de orquestração, não a UI — só um `200`/`503` + corpo com um
 * campo de status por dependência.
 *
 * Onda 1 (REVISAO-ARQUITETURA §4.2 N3, "health check que mente"): até
 * 2026-08-03 isto só fazia `SELECT 1` — respondia `200 ok` com o worker
 * morto, o Redis fora do ar e a fila pausada há dias, e não havia como saber
 * a diferença entre essas 5 causas distintas de "uma busca nunca sai de
 * queued" (REVISAO-ARQUITETURA §2.1). Agora reporta banco, Redis, heartbeat
 * do worker e estado da fila SEPARADAMENTE (`lib/services/scraper-health.ts`)
 * — só o Postgres decide o HTTP status (200/503, ver comentário lá do
 * porquê); as outras dependências aparecem em `checks.*` para o banner de
 * saúde da Lyra (`GET /api/v1/scraper/queue` tem o detalhe completo, incluso
 * os incidentes abertos).
 */
import { NextResponse } from 'next/server';
import { apiRoute } from '@/lib/api-handler';
import { getHealthReport } from '@/lib/services/scraper-health';

export const GET = apiRoute({
  requireAuth: false,
  handler: async () => {
    const report = await getHealthReport();
    const httpStatus = report.checks.database.status === 'ok' ? 200 : 503;
    return NextResponse.json(report, { status: httpStatus });
  },
});
