/**
 * user.contract.ts — CRUD de usuários do sistema (`User`), admin-only. CONTRATO
 * NOVO (não existia rota nenhuma antes desta rodada). `role` é o único
 * controle de acesso do produto (`admin` | `operator`, ARQUITETURA §1.4) — daí
 * todo endpoint aqui exigir `requireRole: 'admin'` em `lib/api-handler.ts`.
 *
 * Senha: NUNCA aparece em nenhum schema de resposta (`userItemSchema`), nunca
 * é ecoada de volta. `max(72)` existe porque bcrypt trunca silenciosamente
 * acima de 72 bytes — sem o limite, duas senhas longas com o mesmo prefixo de
 * 72 bytes autenticariam como iguais (bcryptjs não avisa, só trunca).
 */
import { z } from 'zod';
import { idSchema, isoDateTimeSchema, paginatedSchema, paginationQuerySchema, userRoleSchema } from './common.js';

/** `GET /api/v1/users` (item) e resposta de `POST`/`PATCH`/`GET /:id`. Nunca inclui senha/hash. */
export const userItemSchema = z.object({
  id: idSchema,
  email: z.string(),
  name: z.string(),
  role: userRoleSchema,
  isActive: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type UserItem = z.infer<typeof userItemSchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  role: userRoleSchema.optional(),
  isActive: z.coerce.boolean().optional(),
  /** Busca livre em `name`/`email` (`ILIKE`, ver `lib/services/users.ts`). */
  q: z.string().trim().min(1).max(160).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const listUsersResponseSchema = paginatedSchema(userItemSchema);
export type ListUsersResponse = z.infer<typeof listUsersResponseSchema>;

const emailSchema = z.string().trim().min(3).max(200).email('E-mail inválido.');
/** Normalizado (`trim().toLowerCase()`) em `lib/services/users.ts` — mesma armadilha do login (ver `lib/auth.ts`): gravar com maiúscula cria conta que nunca loga. */
const passwordSchema = z
  .string()
  .min(8, 'A senha deve ter pelo menos 8 caracteres.')
  .max(72, 'A senha deve ter no máximo 72 caracteres (limite do bcrypt).');

/** `POST /api/v1/users` */
export const createUserBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(120),
  role: userRoleSchema.default('operator'),
});
export type CreateUserBody = z.infer<typeof createUserBodySchema>;

export const createUserResponseSchema = userItemSchema;
export type CreateUserResponse = z.infer<typeof createUserResponseSchema>;

/**
 * `PATCH /api/v1/users/:id` — parcial. `password` reseta a senha (mesmo custo
 * bcrypt do resto do projeto); ausente, mantém a atual. `isActive`/`role`
 * passam pelas proteções de auto-remoção/último-admin em `lib/services/users.ts`
 * — o contrato só valida FORMATO, a regra de negócio vive no serviço.
 */
export const updateUserBodySchema = z
  .object({
    email: emailSchema.optional(),
    name: z.string().trim().min(1).max(120).optional(),
    password: passwordSchema.optional(),
    role: userRoleSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Informe ao menos um campo para atualizar.',
  });
export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;

export const updateUserResponseSchema = userItemSchema;
export type UpdateUserResponse = z.infer<typeof updateUserResponseSchema>;
