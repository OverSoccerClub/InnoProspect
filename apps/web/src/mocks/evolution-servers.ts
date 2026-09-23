/**
 * mocks/evolution-servers.ts — fixture para `/configuracoes/servidores-
 * evolution` (Fase 4.B, multi-servidor Evolution API) enquanto se testa sem
 * Postgres — ver `convention-mock-api-layer`. As mensagens/reasons abaixo
 * espelham `lib/services/evolution-servers.ts` e `lib/evolution.ts` (Vega),
 * lidos linha a linha antes de escrever isto — não inventados — para o
 * comportamento em mock e em produção não divergir na tela.
 *
 * ⚠️ Mesma regra do backend real: a credencial (`apiKey`) nunca é devolvida
 * por nenhuma função aqui — só guardada internamente (`fakeApiKeyValid`)
 * para simular sucesso/falha em `mockTestEvolutionServerConnection` sem
 * precisar de um Evolution API de verdade no ar.
 */
import type {
  CreateEvolutionServerRequest,
  CreateEvolutionServerResponse,
  EvolutionServerItem,
  TestEvolutionServerConnectionResponse,
  UpdateEvolutionServerRequest,
  UpdateEvolutionServerResponse,
} from '@/types/evolution-server';
import { mockConflict, mockNotFound } from './utils';

type MockEvolutionServer = Omit<EvolutionServerItem, 'instancesCount'> & {
  /** Total de `WhatsAppInstance` apontando para este servidor no mock — cresce em `mockNoteInstanceCreatedOnServer`, cai em `mockNoteInstanceRemovedFromServer` (chamadas por `mocks/whatsapp.ts`). */
  instancesCount: number;
  /** Nunca sai por nenhuma função exportada — só decide `ok`/`error` em `mockTestEvolutionServerConnection`. */
  fakeApiKeyValid: boolean;
};

let seq = 10;
let servers: MockEvolutionServer[] | null = null;

const DAY_MS = 86_400_000;

function buildServers(): MockEvolutionServer[] {
  const now = Date.now();
  return [
    {
      id: 'evo_1',
      name: 'Principal',
      baseUrl: 'https://evolution.innoprospect.com',
      isActive: true,
      hasApiKey: true,
      instancesCount: 3,
      createdAt: new Date(now - 60 * DAY_MS).toISOString(),
      updatedAt: new Date(now - 5 * DAY_MS).toISOString(),
      fakeApiKeyValid: true,
    },
    {
      id: 'evo_2',
      name: 'Secundário (staging)',
      baseUrl: 'https://evolution-staging.innoprospect.com',
      isActive: true,
      hasApiKey: true,
      instancesCount: 1,
      createdAt: new Date(now - 20 * DAY_MS).toISOString(),
      updatedAt: new Date(now - 20 * DAY_MS).toISOString(),
      // Propositalmente "errado" — exercita o caminho de FALHA do botão
      // "Testar conexão" sem precisar de um Evolution API de verdade no ar.
      fakeApiKeyValid: false,
    },
  ];
}

function getServers(): MockEvolutionServer[] {
  if (!servers) servers = buildServers();
  return servers;
}

/** Sem barra final — mesma normalização de `lib/services/evolution-servers.ts#normalizeBaseUrl`: sem isto, "https://x.com" e "https://x.com/" passariam como servidores diferentes. */
function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

// Campo a campo (nunca um spread do objeto vivo do array interno — mesmo
// motivo do bug já documentado: mock GET com referência viva duplica dado
// no React quando um PATCH posterior muta o mesmo objeto por baixo) — e
// nunca inclui `fakeApiKeyValid`, que é só um detalhe interno do mock.
function toItem(server: MockEvolutionServer): EvolutionServerItem {
  return {
    id: server.id,
    name: server.name,
    baseUrl: server.baseUrl,
    isActive: server.isActive,
    hasApiKey: server.hasApiKey,
    instancesCount: server.instancesCount,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
  };
}

function findServer(id: string): MockEvolutionServer {
  const server = getServers().find((s) => s.id === id);
  if (!server) mockNotFound('Servidor Evolution não encontrado.', 'SERVER_NOT_FOUND');
  return server;
}

export function mockListEvolutionServers(): EvolutionServerItem[] {
  return getServers()
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .map(toItem);
}

export function mockCreateEvolutionServer(input: CreateEvolutionServerRequest): CreateEvolutionServerResponse {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const all = getServers();
  if (all.some((s) => s.baseUrl === baseUrl)) {
    mockConflict('SERVER_BASE_URL_TAKEN', `Já existe um servidor cadastrado com a URL ${baseUrl}.`);
  }
  const now = new Date().toISOString();
  const server: MockEvolutionServer = {
    id: `evo_${seq++}`,
    name: input.name.trim(),
    baseUrl,
    isActive: true,
    hasApiKey: true,
    instancesCount: 0,
    createdAt: now,
    updatedAt: now,
    fakeApiKeyValid: true,
  };
  all.unshift(server);
  return toItem(server);
}

export function mockUpdateEvolutionServer(id: string, patch: UpdateEvolutionServerRequest): UpdateEvolutionServerResponse {
  const all = getServers();
  const existing = findServer(id);

  let baseUrl = existing.baseUrl;
  if (patch.baseUrl !== undefined) {
    baseUrl = normalizeBaseUrl(patch.baseUrl);
    if (baseUrl !== existing.baseUrl && all.some((s) => s.baseUrl === baseUrl)) {
      mockConflict('SERVER_BASE_URL_TAKEN', `Já existe um servidor cadastrado com a URL ${baseUrl}.`);
    }
  }

  const updated: MockEvolutionServer = {
    ...existing,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    baseUrl,
    ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    // `apiKey` presente = ROTACIONA a credencial simulada; ausente, a
    // credencial guardada permanece intocada — mesma regra do backend real.
    ...(patch.apiKey !== undefined ? { fakeApiKeyValid: true } : {}),
    updatedAt: new Date().toISOString(),
  };
  const index = all.findIndex((s) => s.id === id);
  all[index] = updated;
  return toItem(updated);
}

/**
 * Espelha `lib/services/evolution-servers.ts#deactivateEvolutionServer`:
 * idempotente, DESATIVA (nunca remove a linha), bloqueia com `409
 * SERVER_IN_USE` se houver instância apontando para este servidor — mesma
 * mensagem (com a contagem e o que fazer a seguir) do backend real.
 */
export function mockDeactivateEvolutionServer(id: string): void {
  const all = getServers();
  const existing = findServer(id);
  if (!existing.isActive) return; // já estava inativo — no-op, mesmo espírito do DELETE real.

  if (existing.instancesCount > 0) {
    mockConflict(
      'SERVER_IN_USE',
      `Este servidor tem ${existing.instancesCount} instância(s) de WhatsApp ativa(s) apontando para ele. Mova ou desative as instâncias antes de desativar o servidor.`,
    );
  }

  const index = all.findIndex((s) => s.id === id);
  all[index] = { ...existing, isActive: false, updatedAt: new Date().toISOString() };
}

/**
 * Nunca lança por a conexão ter falhado (`ok:false` é o RESULTADO do teste,
 * mesma regra do backend real — `testEvolutionServerConnection` só lança se
 * `:id` não existir). Latência simulada com uma variação pequena para a UI
 * não parecer estática.
 */
export function mockTestEvolutionServerConnection(id: string): TestEvolutionServerConnectionResponse {
  const server = findServer(id);
  const latencyMs = 120 + Math.round(Math.random() * 380);
  const checkedAt = new Date().toISOString();

  if (!server.fakeApiKeyValid) {
    return {
      ok: false,
      latencyMs,
      checkedAt,
      error: { code: 'UNAUTHORIZED', message: 'A Evolution API respondeu 401 — a chave cadastrada para este servidor não é válida.' },
    };
  }

  return { ok: true, latencyMs, checkedAt, error: null };
}

// ─────────────────────────────────────────────────────────────────────────
// Usado só por `mocks/whatsapp.ts` (criação/exclusão de instância) — import
// em UMA direção só (whatsapp → evolution-servers), de propósito, para não
// criar um ciclo entre os dois módulos de estado.
// ─────────────────────────────────────────────────────────────────────────

/** Espelha `lib/evolution.ts#requireActiveEvolutionServer`: 404 se o id não existir, 409 `SERVER_INACTIVE` se o servidor estiver desativado. */
export function mockRequireActiveEvolutionServer(id: string): EvolutionServerItem {
  const server = findServer(id);
  if (!server.isActive) {
    mockConflict(
      'SERVER_INACTIVE',
      'Este servidor Evolution está desativado. Escolha outro ou reative-o antes de criar a instância.',
    );
  }
  return toItem(server);
}

export function mockNoteInstanceCreatedOnServer(evolutionServerId: string): void {
  const server = getServers().find((s) => s.id === evolutionServerId);
  if (server) server.instancesCount += 1;
}

export function mockNoteInstanceRemovedFromServer(evolutionServerId: string): void {
  const server = getServers().find((s) => s.id === evolutionServerId);
  if (server) server.instancesCount = Math.max(0, server.instancesCount - 1);
}
