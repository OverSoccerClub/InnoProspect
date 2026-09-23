// Fonte da verdade: @inno/contracts (packages/contracts/src/evolution-server.contract.ts),
// publicado pelo Vega junto com a rota `/api/v1/evolution-servers` (Fase
// 4.B). Reexporta com os nomes já usados em `lib/api/evolution-servers.ts`,
// `mocks/evolution-servers.ts` e nos componentes — mesmo padrão de
// `types/user.ts`/`types/whatsapp.ts`.
export type {
  EvolutionServerItem,
  ListEvolutionServersResponse,
  CreateEvolutionServerBody as CreateEvolutionServerRequest,
  CreateEvolutionServerResponse,
  UpdateEvolutionServerBody as UpdateEvolutionServerRequest,
  UpdateEvolutionServerResponse,
  TestEvolutionServerConnectionResponse,
} from '@inno/contracts';
