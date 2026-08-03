/**
 * lib/services/templates.ts — `MessageTemplate` (ARQUITETURA §4.4, §6.4). As
 * regras de variável/spintax vivem em `@inno/core` (`templates/render.ts`,
 * `templates/spintax.ts`) — este arquivo só orquestra: valida, chama Prisma,
 * monta a resposta do contrato.
 */
import { Prisma, prisma, type MessageTemplate } from '@inno/db';
import {
  countSpintaxVariations,
  extractKnownVariables,
  findMissingVariables,
  firstName,
  hasSpintax,
  parseSpintax,
  renderTemplate,
  resolveSpintax,
  validateTemplateVariables,
  type TemplateVariableValues,
} from '@inno/core';
import type {
  CreateTemplateBody,
  CreateTemplateResponse,
  ListTemplatesQuery,
  ListTemplatesResponse,
  PatchTemplateBody,
  PreviewTemplateBody,
  PreviewTemplateResponse,
  TemplateItem,
} from '@inno/contracts';
import { badRequest, conflict, notFound } from '@/lib/api-handler';

/**
 * Variação mínima abaixo da qual a resposta de `POST /templates` inclui
 * `warnings: [{ code: 'LOW_VARIATION' }]` — AVISO, não bloqueio (ARQUITETURA
 * §4.4: "se spintaxVariations < 3, retorna 201 com warnings"). Distinto do
 * bloqueio de `409 INSUFFICIENT_TEXT_VARIATION` no `start` de campanha
 * (limiar 10, ARQUITETURA §6.4) — aquele é escopo de `campaigns` (Fase 4),
 * não desta rota.
 */
const LOW_VARIATION_THRESHOLD = 3;

/** Valores de exemplo para preview SEM `leadId` — deixa claro que é dado fictício, não um Lead real. */
const SAMPLE_PREVIEW_VALUES: TemplateVariableValues = {
  nome: 'Empresa Exemplo Ltda',
  primeiro_nome: 'Empresa',
  cidade: 'Campinas',
  uf: 'SP',
  categoria: 'Clínica odontológica',
  site: 'https://exemplo.com.br',
  telefone: '+5511987654321',
};

function toTemplateItem(template: MessageTemplate): TemplateItem {
  return {
    id: template.id,
    name: template.name,
    body: template.body,
    variablesUsed: template.variablesUsed as TemplateItem['variablesUsed'],
    hasSpintax: hasSpintax(template.body),
    spintaxVariations: countSpintaxVariations(template.body),
    isActive: template.isActive,
    usageCount: template.usageCount,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

/** `422 UNKNOWN_VARIABLE`/`422 INVALID_SPINTAX` (ARQUITETURA §4.4) — o `code` HTTP continua `VALIDATION_ERROR` (convenção dos 8 códigos fechados), a distinção semântica vai na `message`. */
function validateBody(body: string): void {
  const variableCheck = validateTemplateVariables(body);
  if (!variableCheck.valid) {
    badRequest(
      `Variável(is) desconhecida(s) em "{{...}}": ${variableCheck.unknownVariables.join(', ')}.`,
      variableCheck.unknownVariables.map((v) => ({ path: 'body', message: `Variável desconhecida: {{${v}}}` })),
    );
  }

  const spintaxCheck = parseSpintax(body);
  if (!spintaxCheck.valid) {
    badRequest(`Sintaxe de spintax inválida: ${spintaxCheck.error.message}`, [
      { path: 'body', message: spintaxCheck.error.message },
    ]);
  }
}

export async function listTemplates(query: ListTemplatesQuery): Promise<ListTemplatesResponse> {
  const where: Prisma.MessageTemplateWhereInput = {};
  if (query.isActive !== undefined) where.isActive = query.isActive;
  if (query.q) {
    where.OR = [
      { name: { contains: query.q, mode: 'insensitive' } },
      { body: { contains: query.q, mode: 'insensitive' } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.messageTemplate.count({ where }),
    prisma.messageTemplate.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    }),
  ]);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

  return {
    data: page.map(toTemplateItem),
    page: { cursor: query.cursor ?? null, nextCursor, limit: query.limit, total },
  };
}

export async function createTemplate(body: CreateTemplateBody, createdById: string): Promise<CreateTemplateResponse> {
  validateBody(body.body);

  const created = await prisma.messageTemplate.create({
    data: {
      name: body.name,
      body: body.body,
      isActive: body.isActive,
      variablesUsed: extractKnownVariables(body.body),
      createdById,
    },
  });

  const item = toTemplateItem(created);
  const warnings = item.spintaxVariations < LOW_VARIATION_THRESHOLD
    ? [{
        code: 'LOW_VARIATION' as const,
        message: `Este template gera apenas ${item.spintaxVariations} variação(ões) de texto. Considere adicionar spintax ({opção a|opção b}) para reduzir o risco de bloqueio (ARQUITETURA §6.4).`,
      }]
    : undefined;

  return { ...item, ...(warnings ? { warnings } : {}) };
}

/**
 * `GET /api/v1/templates/:id` — busca de um template só.
 *
 * Existe porque a tela de edição (`templates/[id]`) é acessível por link
 * direto: quem abre a URL não passou pela listagem antes. Sem esta rota, a UI
 * precisava carregar a lista inteira e filtrar no cliente — o que funciona com
 * poucos templates e depois **falha em silêncio**, quando o registro procurado
 * cai fora da primeira página e o link direto simplesmente para de achá-lo,
 * sem erro nenhum. (Pedido da Lyra no handoff da Fase 3.)
 */
export async function getTemplate(id: string): Promise<TemplateItem> {
  const template = await prisma.messageTemplate.findUnique({ where: { id } });
  if (!template) notFound('Template não encontrado.');
  return toTemplateItem(template);
}

export async function patchTemplate(id: string, patch: PatchTemplateBody): Promise<TemplateItem> {
  const existing = await prisma.messageTemplate.findUnique({ where: { id } });
  if (!existing) notFound('Template não encontrado.');

  if (patch.body !== undefined) validateBody(patch.body);

  const data: Prisma.MessageTemplateUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.isActive !== undefined) data.isActive = patch.isActive;
  if (patch.body !== undefined) {
    data.body = patch.body;
    data.variablesUsed = extractKnownVariables(patch.body);
  }

  const updated = await prisma.messageTemplate.update({ where: { id }, data });
  return toTemplateItem(updated);
}

/**
 * `DELETE /api/v1/templates/:id` — `409 TEMPLATE_IN_USE` se QUALQUER
 * campanha referenciar o template (schema reforça com `onDelete: Restrict`,
 * ARQUITETURA §4.4 + handoff do Cronos: "trate a violação em vez de deixar
 * estourar 500"). Checagem PROATIVA (evita a corrida óbvia de "checou, mas
 * uma campanha nasceu entre o check e o delete") + try/catch como
 * backstop no próprio `delete` para o caso de essa corrida acontecer mesmo
 * assim — dupla proteção, sem depender só do código de erro exato do Prisma.
 */
export async function deleteTemplate(id: string): Promise<void> {
  const existing = await prisma.messageTemplate.findUnique({ where: { id } });
  if (!existing) notFound('Template não encontrado.');

  const inUse = await prisma.campaign.findFirst({ where: { templateId: id }, select: { id: true } });
  if (inUse) {
    conflict('Este template está em uso por uma campanha e não pode ser apagado. Desative-o (isActive: false) em vez de apagar.');
  }

  try {
    await prisma.messageTemplate.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2003' || err.code === 'P2014')) {
      conflict('Este template está em uso por uma campanha e não pode ser apagado. Desative-o (isActive: false) em vez de apagar.');
    }
    throw err;
  }
}

function buildLeadPreviewValues(lead: {
  name: string;
  city: { name: string } | null;
  uf: string;
  category: string | null;
  website: string | null;
  phoneE164: string | null;
}): TemplateVariableValues {
  return {
    nome: lead.name,
    primeiro_nome: firstName(lead.name),
    cidade: lead.city?.name,
    uf: lead.uf,
    categoria: lead.category ?? undefined,
    site: lead.website ?? undefined,
    telefone: lead.phoneE164 ?? undefined,
    // `minha_empresa` (ARQUITETURA §4.4/§7.4): não há model de configuração
    // ("Settings"/"Organization") no schema hoje — só existe `User`. Lido de
    // env como solução pragmática desta rodada; sem a env, a variável fica
    // "missing" no preview (honesto: avisa que falta configurar, em vez de
    // inventar um valor). Ver PENDÊNCIAS no handoff sobre modelar isso de
    // verdade quando a Fase 4 (campanhas) precisar disso pra valer.
    minha_empresa: process.env.APP_COMPANY_NAME || undefined,
  };
}

export async function previewTemplate(id: string, body: PreviewTemplateBody): Promise<PreviewTemplateResponse> {
  const template = await prisma.messageTemplate.findUnique({ where: { id } });
  if (!template) notFound('Template não encontrado.');

  let values: TemplateVariableValues;
  if (body.leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: body.leadId },
      include: { city: { select: { name: true } } },
    });
    if (!lead) notFound('Lead não encontrado.');
    values = buildLeadPreviewValues(lead);
  } else {
    values = { ...SAMPLE_PREVIEW_VALUES, minha_empresa: process.env.APP_COMPANY_NAME || undefined };
  }

  const rendered = renderTemplate(template.body, values);
  const missingVariables = findMissingVariables(template.body, values);
  const usedVariableNames = extractKnownVariables(template.body);

  const previews = Array.from({ length: body.sampleCount }, (_, i) => {
    const seed = `${id}:${body.leadId ?? 'sample'}:${i}`;
    const text = resolveSpintax(rendered, { seed });
    const usedVariables: Record<string, string> = {};
    for (const name of usedVariableNames) {
      usedVariables[name] = values[name] ?? '';
    }
    return { text, length: text.length, usedVariables };
  });

  return { previews, missingVariables };
}
