// Fonte da verdade: @inno/contracts (packages/contracts/src/user.contract.ts),
// publicado pelo Vega junto com a rota `/api/v1/users` (ver ARQUITETURA.md §4).
// Reexporta com os nomes já usados em `lib/api/users.ts`, `mocks/users.ts` e
// nos componentes — mesmo padrão de `types/optout.ts`.
export type {
  UserRole,
  UserItem,
  ListUsersQuery,
  ListUsersResponse,
  CreateUserBody as CreateUserRequest,
  CreateUserResponse,
  UpdateUserBody as UpdateUserRequest,
  UpdateUserResponse,
} from '@inno/contracts';
