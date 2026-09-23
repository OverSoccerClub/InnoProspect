/**
 * evolution-server.contract.ts — servidores Evolution API (multi-servidor,
 * Fase 4.B, ARQUITETURA §4.6/§4.8/§9.1). CONTRATO NOVO. Model em
 * `packages/db/prisma/schema.prisma#EvolutionServer` (Cronos).
 *
 * ⚠️ A credencial (`apiKey`) É de ENTRADA (`create`/`update`), NUNCA de
 * SAÍDA — nenhum schema de resposta aqui tem um campo com o valor da chave.
 * `hasApiKey` (booleano) é o único sinal de que existe credencial cadastrada
 * — hoje é SEMPRE `true` (a coluna é `NOT NULL`), mas o campo existe porque
 * "existe chave" é uma pergunta legítima da tela de administração e não deve
 * ser respondida expondo/mascarando o valor.
 */
import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common.js';

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/evolution-servers, GET /api/v1/evolution-servers/:id
// ─────────────────────────────────────────────────────────────────────────

export const evolutionServerItemSchema = z.object({
  id: idSchema,
  name: z.string(),
  baseUrl: z.string(),
  isActive: z.boolean(),
  /** Sempre `true` hoje (`EvolutionServer.apiKeyCiphertext` é `NOT NULL`) — ver comentário no topo do arquivo. */
  hasApiKey: z.boolean(),
  /** Nº de `WhatsAppInstance` que apontam para este servidor — informa a tela ANTES de uma tentativa de desativar/apagar que vai bater em `409 SERVER_IN_USE`. */
  instancesCount: z.number().int().min(0),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type EvolutionServerItem = z.infer<typeof evolutionServerItemSchema>;

export const listEvolutionServersResponseSchema = z.object({
  data: z.array(evolutionServerItemSchema),
});
export type ListEvolutionServersResponse = z.infer<typeof listEvolutionServersResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/evolution-servers
// ─────────────────────────────────────────────────────────────────────────

/** `baseUrl` normalizada (sem barra final) em `lib/services/evolution-servers.ts` ANTES de gravar/comparar contra o `@unique` — ver comentário no schema Prisma. */
const baseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .url('baseUrl precisa ser uma URL http(s) absoluta.')
  .refine((v) => /^https?:\/\//.test(v), 'baseUrl precisa ser http(s).');

const apiKeySchema = z.string().trim().min(1, 'apiKey não pode ser vazia.').max(500);

export const createEvolutionServerBodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  baseUrl: baseUrlSchema,
  apiKey: apiKeySchema,
});
export type CreateEvolutionServerBody = z.infer<typeof createEvolutionServerBodySchema>;

export const createEvolutionServerResponseSchema = evolutionServerItemSchema;
export type CreateEvolutionServerResponse = z.infer<typeof createEvolutionServerResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// PATCH /api/v1/evolution-servers/:id
// ─────────────────────────────────────────────────────────────────────────

/**
 * Parcial. `apiKey`, quando presente, ROTACIONA a credencial em repouso
 * (recifra com a versão ATUAL da chave-mestre) — nunca é ecoada de volta,
 * mesma regra do `create`. Ausente, a credencial atual permanece intocada.
 */
export const updateEvolutionServerBodySchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    baseUrl: baseUrlSchema.optional(),
    apiKey: apiKeySchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Informe ao menos um campo para atualizar.' });
export type UpdateEvolutionServerBody = z.infer<typeof updateEvolutionServerBodySchema>;

export const updateEvolutionServerResponseSchema = evolutionServerItemSchema;
export type UpdateEvolutionServerResponse = z.infer<typeof updateEvolutionServerResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/evolution-servers/:id/test-connection
// ─────────────────────────────────────────────────────────────────────────

/**
 * Nunca lança `4xx`/`5xx` por a conexão ter falhado — falhar em testar a
 * conexão NÃO é um erro da rota, é o próprio RESULTADO do teste
 * (`ok: false`). Só devolve erro HTTP se o `:id` não existir (`404`) ou o
 * body/params forem inválidos.
 */
export const testEvolutionServerConnectionResponseSchema = z.object({
  ok: z.boolean(),
  /** Duração da chamada de teste (`GET /instance/fetchInstances` na Evolution), em ms — inclui o tempo até o timeout quando `ok:false` por timeout. */
  latencyMs: z.number().int().min(0),
  checkedAt: isoDateTimeSchema,
  error: z
    .object({
      /** Vocabulário fechado de `MessagingErrorCode` (`@inno/messaging`) ou `"CONFIG_ERROR"` quando nem chegou a chamar a rede (chave-mestre ausente/malformada — `lib/evolution-server-crypto.ts`). */
      code: z.string(),
      message: z.string(),
    })
    .nullable(),
});
export type TestEvolutionServerConnectionResponse = z.infer<typeof testEvolutionServerConnectionResponseSchema>;
