import { ApiRequestError } from '@/lib/fetcher';
import type { CreateOptOutRequest, CreateOptOutResponse, OptOutItem } from '@/types/optout';
import { mockNotFound } from './utils';

let seq = 10;
let optouts: OptOutItem[] | null = null;

function buildOptOuts(): OptOutItem[] {
  const now = Date.now();
  return [
    {
      id: 'opt_1',
      phoneE164: '+5511987651234',
      source: 'reply',
      leadName: 'Clínica Vida Sorriso',
      reason: 'Respondeu "PARAR"',
      createdAt: new Date(now - 2 * 86_400_000).toISOString(),
    },
    {
      id: 'opt_2',
      phoneE164: '+5521998765432',
      source: 'public_link',
      leadName: 'Studio Bem-Estar Norte',
      reason: null,
      createdAt: new Date(now - 5 * 86_400_000).toISOString(),
    },
    {
      id: 'opt_3',
      phoneE164: '+5531991234567',
      source: 'manual',
      leadName: null,
      reason: 'Pedido por telefone',
      createdAt: new Date(now - 10 * 86_400_000).toISOString(),
    },
  ];
}

function getOptOuts(): OptOutItem[] {
  if (!optouts) optouts = buildOptOuts();
  return optouts;
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

export function mockListOptOuts(params: { cursor?: string; limit?: number }) {
  const all = [...getOptOuts()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
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

export function mockCreateOptOut(input: CreateOptOutRequest): CreateOptOutResponse {
  const all = getOptOuts();
  if (all.some((o) => o.phoneE164 === input.phoneE164)) {
    throw new ApiRequestError(409, {
      code: 'CONFLICT',
      message: 'Este telefone já está na lista de descadastro.',
      requestId: 'mock',
    });
  }
  const now = new Date().toISOString();
  const item: OptOutItem = {
    id: `opt_${seq++}`,
    phoneE164: input.phoneE164,
    source: input.source ?? 'manual',
    leadName: null,
    reason: input.reason ?? null,
    createdAt: now,
  };
  all.unshift(item);
  return { id: item.id, phoneE164: item.phoneE164, createdAt: item.createdAt, affectedTargets: 0 };
}

export function mockDeleteOptOut(id: string): void {
  const all = getOptOuts();
  const index = all.findIndex((o) => o.id === id);
  if (index === -1) mockNotFound(`Opt-out "${id}" não encontrado.`);
  all.splice(index, 1);
}
