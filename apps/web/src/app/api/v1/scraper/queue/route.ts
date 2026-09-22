/**
 * GET /api/v1/scraper/queue — estado operacional da fila `scrape-search`:
 * pausada ou rodando, motivo/desde quando, e os `ScraperHealthEvent` ainda
 * abertos. Onda 1 (REVISAO-ARQUITETURA §5, item 1.2/1.3 — "não existe
 * caminho de recuperação sem shell").
 *
 * ⚠️ Endpoint criado por Vega sem contrato prévio da Nova em ARQUITETURA §4
 * (a revisão de 2026-08-03 pediu o item, não definiu o formato) — documentado
 * no handoff da tarefa para a Lyra consumir; formalizar em
 * `packages/contracts` se/quando a Nova revisar o §4. Exige sessão (mesma
 * regra default de `apiRoute`) — não é rota pública.
 */
import { NextResponse } from 'next/server';
import { apiRoute } from '@/lib/api-handler';
import { getScraperQueueStatus } from '@/lib/services/scraper-health';

export const GET = apiRoute({
  handler: async () => {
    const status = await getScraperQueueStatus();
    return NextResponse.json(status);
  },
});
