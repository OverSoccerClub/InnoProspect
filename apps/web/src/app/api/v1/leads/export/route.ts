/**
 * GET /api/v1/leads/export — mesmos filtros de `GET /leads`, em CSV
 * (ARQUITETURA §4.3, revisado 2026-09-22: separador `;` + coluna
 * `descadastrado`, ver `packages/contracts/src/lead.contract.ts`).
 *
 * Autenticada como as demais rotas — sem `rateLimit` porque essa opção do
 * `apiRoute` é só para rota PÚBLICA (webhook/opt-out); uma rota autenticada
 * já é limitada implicitamente por exigir login, e um limite aqui só
 * atrapalharia um download legítimo do operador.
 *
 * Streaming de verdade: `iterateLeadsForExport` pagina por cursor, e cada
 * página é escrita no `ReadableStream` assim que chega — nunca acumulamos o
 * CSV inteiro em memória antes de responder.
 *
 * ⚠️ Limitação conhecida: como o corpo é um stream, o status HTTP (`200`) e
 * os headers já foram enviados quando a geração começa. Se uma página
 * falhar no meio (ex.: Postgres cai), `controller.error` aborta a conexão —
 * o cliente recebe um arquivo truncado, não um erro estruturado. A
 * validação de teto (`LEAD_EXPORT_MAX_ROWS`) roda ANTES de abrir o stream
 * exatamente para evitar o caso mais provável de erro no meio do caminho.
 */
import { NextResponse } from 'next/server';
import { exportLeadsQuerySchema, LEAD_EXPORT_COLUMNS, LEAD_EXPORT_MAX_ROWS } from '@inno/contracts';
import { apiRoute, badRequest } from '@/lib/api-handler';
import {
  buildCsvLine,
  countLeadsForExport,
  CSV_BOM,
  iterateLeadsForExport,
  leadExportFilename,
} from '@/lib/services/leads';

export const GET = apiRoute({
  querySchema: exportLeadsQuerySchema,
  handler: async ({ query }) => {
    const total = await countLeadsForExport(query);
    if (total > LEAD_EXPORT_MAX_ROWS) {
      badRequest(
        `O filtro resolve para ${total} leads, acima do limite de ${LEAD_EXPORT_MAX_ROWS} por export. Refine o filtro.`,
        undefined,
        'EXPORT_TOO_LARGE',
      );
    }

    const columns = query.columns?.length ? query.columns : LEAD_EXPORT_COLUMNS;
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(CSV_BOM));
          controller.enqueue(encoder.encode(buildCsvLine(columns)));
          for await (const row of iterateLeadsForExport(query)) {
            controller.enqueue(encoder.encode(buildCsvLine(columns.map((column) => row[column]))));
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new NextResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${leadExportFilename()}"`,
      },
    });
  },
});
