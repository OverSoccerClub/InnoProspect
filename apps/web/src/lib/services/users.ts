/**
 * lib/services/users.ts — CRUD de usuários do sistema (`User`). CONTRATO
 * NOVO (`@inno/contracts/user.contract.ts`) — não existia rota nenhuma antes
 * desta rodada, e `role` (`admin`|`operator`) só era verificado em UM lugar
 * de todo o código (`optouts.ts#deleteOptOut`). Toda rota deste serviço é
 * `requireRole: 'admin'` em `lib/api-handler.ts` — mecanismo único,
 * centralizado, não repetido aqui.
 *
 * DECISÃO — desativar, nunca excluir de verdade: ver o comentário completo
 * em `packages/db/prisma/schema.prisma` no campo `User.isActive`. Resumo:
 * `SearchJob`/`WhatsAppInstance`/`MessageTemplate`/`Campaign.createdById` são
 * `onDelete: Restrict` — um `DELETE` físico estoura violação de FK (P2003)
 * assim que o usuário tiver criado QUALQUER uma dessas entidades, o que é a
 * regra, não a exceção, para uma conta em uso. `DELETE /api/v1/users/:id`
 * abaixo é soft-delete (`isActive: false`), idempotente.
 *
 * DUAS PROTEÇÕES OBRIGATÓRIAS (pedido explícito do dono):
 *   1. Ninguém pode excluir/rebaixar A SI MESMO — `actor.id === id` bloqueia
 *      `isActive: false` e `role` saindo de `admin` no `PATCH`/`DELETE`.
 *   2. O sistema nunca pode ficar sem NENHUM admin ativo — `lockActiveAdmins
 *      AndCount` (abaixo) trava as linhas de admin ativas (`SELECT ... FOR
 *      UPDATE`) antes de contar, para que uma segunda transação concorrente
 *      tentando reduzir o nº de admins por OUTRO caminho (rebaixar um admin
 *      DIFERENTE) fique bloqueada até a primeira comitar — sem isso, "contar
 *      admins ativos, decidir, then UPDATE" é uma corrida clássica de
 *      write-skew (as duas transações veem 2 admins, nenhuma vê a mudança
 *      ainda não comitada da outra, as duas passam, zera admin). NÃO
 *      validado contra Postgres real nesta rodada (mesma limitação de sempre
 *      nesta máquina, ver memória do Vega) — a lógica sequencial (bloquear
 *      quando resta 1) está testada; o fechamento da corrida sob concorrência
 *      real depende do `FOR UPDATE` funcionar como documentado no Postgres.
 */
import { Prisma, prisma, type User } from '@inno/db';
import bcrypt from 'bcryptjs';
import type {
  CreateUserBody,
  CreateUserResponse,
  ListUsersQuery,
  ListUsersResponse,
  UpdateUserBody,
  UserItem,
} from '@inno/contracts';
import { conflict, forbidden, notFound } from '@/lib/api-handler';
import { logger } from '@/lib/logger';

/** Mesmo custo do resto do projeto (`packages/db/prisma/admin.ts`, seed) — nunca divergir, senão hashes antigos e novos ficam com "força" diferente sem motivo. */
const BCRYPT_COST = 12;

// Mesma normalização do `authorize` em `lib/auth.ts` — se as duas
// divergirem, um usuário criado aqui com maiúscula nunca consegue logar
// (armadilha já documentada em `packages/db/prisma/admin.ts`/seed).
function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function toUserItem(user: User): UserItem {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export async function listUsers(query: ListUsersQuery): Promise<ListUsersResponse> {
  const where: Prisma.UserWhereInput = {};
  if (query.role) where.role = query.role;
  if (query.isActive !== undefined) where.isActive = query.isActive;
  if (query.q) {
    where.OR = [
      { name: { contains: query.q, mode: 'insensitive' } },
      { email: { contains: query.q, mode: 'insensitive' } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
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
    data: page.map(toUserItem),
    page: { cursor: query.cursor ?? null, nextCursor, limit: query.limit, total },
  };
}

/**
 * `GET /api/v1/users/:id` — existe pelo mesmo motivo de `templates.ts#getTemplate`
 * (comentário lá): a tela de edição é acessível por link direto, e o registro
 * pode estar fora da primeira página da listagem.
 */
export async function getUser(id: string): Promise<UserItem> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) notFound('Usuário não encontrado.');
  return toUserItem(user);
}

export async function createUser(body: CreateUserBody): Promise<CreateUserResponse> {
  const email = normalizeEmail(body.email);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) conflict(`Já existe um usuário com o e-mail ${email}.`);

  const passwordHash = await bcrypt.hash(body.password, BCRYPT_COST);

  let created: User;
  try {
    created = await prisma.user.create({
      data: { email, passwordHash, name: body.name, role: body.role },
    });
  } catch (err) {
    // Corrida rara: dois `POST` simultâneos com o mesmo e-mail passam pelo
    // `findUnique` acima antes de qualquer um comitar. O `@unique` do schema
    // garante que só um `create` vence — o outro cai aqui.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      conflict(`Já existe um usuário com o e-mail ${email}.`);
    }
    throw err;
  }

  logger.info('usuario.criado', { userId: created.id, role: created.role });
  return toUserItem(created);
}

/**
 * Trava as linhas de admin ATIVO e conta — só chamar dentro de um
 * `$transaction`, e só quando a operação PODE reduzir o nº de admins ativos
 * (ver comentário de concorrência no topo do arquivo).
 */
async function lockActiveAdminsAndCount(tx: Prisma.TransactionClient): Promise<number> {
  await tx.$queryRaw`SELECT id FROM users WHERE role = 'admin' AND "isActive" = true FOR UPDATE`;
  return tx.user.count({ where: { role: 'admin', isActive: true } });
}

export async function updateUser(id: string, patch: UpdateUserBody, actor: { id: string }): Promise<UserItem> {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) notFound('Usuário não encontrado.');

  const isSelf = actor.id === id;
  const demotingSelf = isSelf && existing.role === 'admin' && patch.role !== undefined && patch.role !== 'admin';
  const deactivatingSelf = isSelf && patch.isActive === false;
  if (demotingSelf) forbidden('Você não pode remover seu próprio acesso de administrador.');
  if (deactivatingSelf) forbidden('Você não pode desativar sua própria conta.');

  const email = patch.email !== undefined ? normalizeEmail(patch.email) : undefined;
  if (email !== undefined && email !== existing.email) {
    const emailTaken = await prisma.user.findUnique({ where: { email } });
    if (emailTaken) conflict(`Já existe um usuário com o e-mail ${email}.`);
  }

  const data: Prisma.UserUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (email !== undefined) data.email = email;
  if (patch.password !== undefined) data.passwordHash = await bcrypt.hash(patch.password, BCRYPT_COST);
  if (patch.role !== undefined) data.role = patch.role;
  if (patch.isActive !== undefined) data.isActive = patch.isActive;

  // Só precisa da trava/contagem se esta mudança PODE reduzir o nº de admins
  // ativos — evita o `SELECT ... FOR UPDATE` extra em toda edição de perfil
  // (nome, senha, e-mail) que não toca `role`/`isActive`.
  const leavingAdminRole = patch.role !== undefined && patch.role !== 'admin' && existing.role === 'admin';
  const beingDeactivated = patch.isActive === false && existing.isActive;
  const mayReduceAdmins = existing.role === 'admin' && existing.isActive && (leavingAdminRole || beingDeactivated);

  const updated = await prisma.$transaction(async (tx) => {
    if (mayReduceAdmins) {
      const activeAdmins = await lockActiveAdminsAndCount(tx);
      if (activeAdmins <= 1) {
        conflict('Não é possível remover o último administrador ativo do sistema.');
      }
    }
    return tx.user.update({ where: { id }, data });
  });

  logger.info('usuario.atualizado', { userId: id, actorId: actor.id, campos: Object.keys(data) });
  return toUserItem(updated);
}

/**
 * `DELETE /api/v1/users/:id` — soft-delete (`isActive: false`), nunca remove
 * a linha (ver decisão no topo do arquivo). Idempotente: chamar duas vezes
 * no mesmo usuário já inativo é um no-op silencioso (`204` das duas vezes),
 * mesmo espírito de `publicOptOut` — reenviar a mesma requisição não deve
 * fazer o segundo clique se comportar diferente do primeiro.
 */
export async function deactivateUser(id: string, actor: { id: string }): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) notFound('Usuário não encontrado.');

  if (actor.id === id) forbidden('Você não pode desativar sua própria conta.');
  if (!existing.isActive) return; // já estava inativo — nada a fazer.

  await prisma.$transaction(async (tx) => {
    if (existing.role === 'admin') {
      const activeAdmins = await lockActiveAdminsAndCount(tx);
      if (activeAdmins <= 1) {
        conflict('Não é possível desativar o último administrador ativo do sistema.');
      }
    }
    await tx.user.update({ where: { id }, data: { isActive: false } });
  });

  logger.info('usuario.desativado', { userId: id, actorId: actor.id });
}
