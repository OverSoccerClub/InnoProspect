---
name: schema-conventions
description: Convenções fixas do schema Prisma do InnoProspect (packages/db) — ids, chaves naturais, enums, geração de migração sem Postgres local.
metadata:
  type: project
---

Convenções estabelecidas desde a Fase 1 e mantidas em todas as migrações
seguintes (Fase 2/3/4, `20260801130000_add_messaging_and_campaigns`):

- **IDs operacionais são `cuid(2)`** (`@id @default(cuid(2))`). Tabelas de
  referência geográfica (`Uf`, `City`) usam **chave natural** como PK
  (`sigla`, `ibgeCode`) — nunca cuid2 nelas.
- **Enums novos precisam bater valor-a-valor com
  `packages/contracts/src/common.ts`** (e com os `*.contract.ts`
  específicos). Antes de criar/alterar um enum no Prisma, ler os contratos
  Zod correspondentes — eles são a fonte da verdade quando já existem
  (Vega/Lyra já codificam contra eles). Exceção documentada: enums 100%
  internos sem contrato Zod publicado ainda (ex.: `ScraperHealthEventType`/
  `Severity`) — nesse caso o Prisma é a fonte da verdade até alguém publicar
  o contrato, e o schema tem um comentário avisando disso.
- **`@map("nome_tabela")` sempre em snake_case plural**, coerente com as
  tabelas da Fase 1 (`users`, `search_jobs`, `lead_activities`, etc.).
- **Sem banco Postgres disponível na máquina de desenvolvimento** (ver
  [[innoprospect-bloqueio-docker]] na memória global do usuário) — toda
  migração deste projeto até agora foi gerada com
  `prisma migrate diff --from-schema-datamodel <snapshot do schema ANTES>
  --to-schema-datamodel schema.prisma --script`, nunca `--from-migrations`
  (que exigiria um shadow database real). Isso funciona porque comparar
  datamodel-a-datamodel não precisa de conexão viva; só `--from-migrations`
  ou aplicar a migração de fato exige. Cada migração gerada assim TEM que
  declarar explicitamente no cabeçalho do `.sql` que não foi aplicada contra
  banco vivo.
- **Índice único parcial `search_jobs_active_niche_uf_key`** (WHERE
  status IN ('queued','running')) foi escrito à mão na migração
  `20260730120000_init` porque o Prisma DSL não expressa `WHERE` em
  `@@unique`. Não existe no `schema.prisma` — se algum dia `prisma migrate
  dev` for usado (em vez de diff manual) e propuser `DROP INDEX` nele, **não
  aceitar**. Migrações aditivas puramente novas (que não tocam
  `search_jobs`) não têm esse risco, mas sempre vale conferir.
- **Toda migração em banco com dado real precisa ser aditiva**: sem
  `ALTER COLUMN` destrutivo, sem `NOT NULL` sem default em tabela existente,
  sem rename. Até agora (Fases 1-4) isso sempre foi possível porque cada
  fase nova só adicionou tabelas, nunca precisou alterar `Lead`/`SearchJob`.
