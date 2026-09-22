import { ApiRequestError } from '@/lib/fetcher';
import { countVariations, extractKnownVariables, findUnknownVariables, hasSpintax, renderSamples } from '@/lib/spintax';
import type {
  CreateTemplateRequest,
  CreateTemplateResponse,
  TemplateItem,
  TemplatePreviewResponse,
  UpdateTemplateRequest,
} from '@/types/template';
import { mockNotFound } from './utils';

let seq = 10;
let templates: TemplateItem[] | null = null;

function buildTemplates(): TemplateItem[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'tpl_1',
      name: 'Primeiro contato — genérico',
      body:
        '{Olá|Oi|Bom dia}, tudo bem? Aqui é da {{minha_empresa}}. {Vi que|Notei que} a {{nome}} {atende|trabalha} em {{cidade}} e {separamos|montamos} uma condição especial para {{categoria}}.\n\nSe preferir não receber mais mensagens, responda SAIR.',
      variablesUsed: [],
      hasSpintax: true,
      spintaxVariations: 0,
      isActive: true,
      usageCount: 12,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'tpl_2',
      name: 'Follow-up sem resposta',
      body: 'Oi {{primeiro_nome}}, passando para saber se você viu minha mensagem anterior. Se preferir não receber mais mensagens, responda SAIR.',
      variablesUsed: [],
      hasSpintax: false,
      spintaxVariations: 0,
      isActive: true,
      usageCount: 3,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'tpl_3',
      name: 'Rascunho — pouca variação (risco)',
      body: 'Olá, {{nome}}! Temos uma oferta para {{categoria}} em {{cidade}}. Responda SAIR para não receber mais.',
      variablesUsed: [],
      hasSpintax: false,
      spintaxVariations: 0,
      isActive: false,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    },
  ].map((t) => ({
    ...t,
    variablesUsed: extractKnownVariables(t.body),
    hasSpintax: hasSpintax(t.body),
    spintaxVariations: countVariations(t.body),
  }));
}

function getTemplates(): TemplateItem[] {
  if (!templates) templates = buildTemplates();
  return templates;
}

function encodeCursor(index: number): string {
  return btoa(String(index));
}
function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  try {
    return Number(atob(cursor)) || 0;
  } catch {
    return 0;
  }
}

export function mockListTemplates(params: { cursor?: string; limit?: number; isActive?: boolean }) {
  let all = [...getTemplates()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (params.isActive !== undefined) all = all.filter((t) => t.isActive === params.isActive);
  const limit = Math.min(100, params.limit ?? 25);
  const start = decodeCursor(params.cursor);
  const page = all.slice(start, start + limit);
  const nextIndex = start + limit;
  return {
    data: page,
    page: {
      cursor: params.cursor ?? null,
      nextCursor: nextIndex < all.length ? encodeCursor(nextIndex) : null,
      limit,
      total: all.length,
    },
  };
}

export function mockGetTemplate(id: string): TemplateItem {
  const t = getTemplates().find((item) => item.id === id);
  if (!t) mockNotFound(`Template "${id}" não encontrado.`);
  return t;
}

function validateBody(body: string) {
  const unknown = findUnknownVariables(body);
  if (unknown.length > 0) {
    throw new ApiRequestError(422, {
      code: 'VALIDATION_ERROR',
      message: `Variável desconhecida: {{${unknown[0]}}}. Use apenas as variáveis sugeridas.`,
      details: unknown.map((v) => ({ path: 'body', message: `Variável desconhecida: {{${v}}}` })),
      requestId: 'mock',
    });
  }
}

export function mockCreateTemplate(input: CreateTemplateRequest): CreateTemplateResponse {
  validateBody(input.body);
  const now = new Date().toISOString();
  const item: TemplateItem = {
    id: `tpl_${seq++}`,
    name: input.name.trim(),
    body: input.body,
    variablesUsed: extractKnownVariables(input.body),
    hasSpintax: hasSpintax(input.body),
    spintaxVariations: countVariations(input.body),
    isActive: input.isActive ?? true,
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  getTemplates().unshift(item);
  if (item.spintaxVariations < 3) {
    return {
      ...item,
      warnings: [
        {
          code: 'LOW_VARIATION',
          message: `Esta mensagem gera apenas ${item.spintaxVariations} variação(ões) de texto. Adicione alternativas com {opção a|opção b} para reduzir o risco de bloqueio.`,
        },
      ],
    };
  }
  return item;
}

export function mockPatchTemplate(id: string, patch: UpdateTemplateRequest): CreateTemplateResponse {
  const all = getTemplates();
  const index = all.findIndex((t) => t.id === id);
  if (index === -1) mockNotFound(`Template "${id}" não encontrado.`);
  if (patch.body !== undefined) validateBody(patch.body);
  const current = all[index]!;
  const merged: TemplateItem = {
    ...current,
    ...patch,
    name: patch.name?.trim() ?? current.name,
    updatedAt: new Date().toISOString(),
  };
  if (patch.body !== undefined) {
    merged.variablesUsed = extractKnownVariables(patch.body);
    merged.hasSpintax = hasSpintax(patch.body);
    merged.spintaxVariations = countVariations(patch.body);
  }
  all[index] = merged;
  if (merged.spintaxVariations < 3) {
    return {
      ...merged,
      warnings: [
        {
          code: 'LOW_VARIATION',
          message: `Esta mensagem gera apenas ${merged.spintaxVariations} variação(ões) de texto. Adicione alternativas com {opção a|opção b} para reduzir o risco de bloqueio.`,
        },
      ],
    };
  }
  return merged;
}

export function mockDeleteTemplate(id: string): void {
  const all = getTemplates();
  const index = all.findIndex((t) => t.id === id);
  if (index === -1) mockNotFound(`Template "${id}" não encontrado.`);
  const template = all[index]!;
  // simula a regra do contrato: template com uso > 5 (proxy de "em campanha ativa") não pode ser excluído
  if (template.usageCount > 5) {
    throw new ApiRequestError(409, {
      code: 'CONFLICT',
      message: 'Este template está em uso por uma campanha em andamento e não pode ser excluído.',
      requestId: 'mock',
    });
  }
  all.splice(index, 1);
}

export function mockPreviewTemplate(id: string, sampleCount = 3): TemplatePreviewResponse {
  const template = mockGetTemplate(id);
  const texts = renderSamples(template.body, sampleCount);
  return {
    previews: texts.map((text) => ({ text, length: text.length, usedVariables: {} })),
    missingVariables: [],
  };
}
