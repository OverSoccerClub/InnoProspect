---
name: infra-monorepo-scaffold
description: O que foi montado no esqueleto do monorepo InnoProspect (Fase 1.1) — layout real, versões, scripts
metadata:
  type: project
---

Esqueleto entregue em 2026-07-30 (Fase 1.1). `pnpm install`, `pnpm typecheck`, `pnpm lint` e `pnpm
build` passam limpos nos workspaces que eu possuo: `apps/web`, `apps/worker`, `packages/config`,
`packages/contracts`, `packages/core`, `packages/scraper`, `packages/messaging`.

## Versões pinadas (verificar antes de assumir que ainda são as mesmas)
Node 24.12 / pnpm 9.12 já estavam na máquina. Next 15.1.4, React 19.0.0, Tailwind 4 (`@tailwindcss/postcss`),
TypeScript ~5.7 (resolveu 5.9.3), ESLint 9 (flat config), Turborepo ~2.3 (resolveu 2.10.7), tsx 4,
tsup 8, ioredis 5, pino 9. **Antes de recomendar uma versão específica em sessão futura, rode `pnpm why
<pkg>` ou olhe o `pnpm-lock.yaml` — pode ter mudado.**

## Estrutura de scripts raiz (`package.json`)
`dev`/`build`/`lint`/`typecheck` delegam para `turbo run <task>` (cada workspace roda o próprio script
homônimo). `db:migrate` → `pnpm --filter @inno/db run migrate:dev`; `db:seed` → `pnpm --filter @inno/db
run db:seed`. **Esses nomes vêm do `package.json` real que o Cronos criou — se ele renomear os scripts
do Prisma, os scripts raiz quebram silenciosamente até alguém rodar `pnpm db:migrate`.** Checar
`packages/db/package.json` antes de confiar nesse mapeamento em sessões futuras.

## Pacotes internos (`packages/contracts|core|scraper|messaging`)
Não têm passo de build próprio — cada `package.json` expõe `"exports": { ".": "./src/index.ts" }`
apontando direto pro TS fonte. `apps/web` consome via `transpilePackages` no `next.config.ts` (ainda
vazio, comentário deixado pra Vega/Lyra preencherem quando importarem algo de fato). `apps/worker`
bundla via `tsup` — se algum desses pacotes virar dependência real do worker, o Dockerfile precisa
copiar o `package.json` dele no estágio `deps` (comentário já deixado no Dockerfile).

## `infra/docker-compose.dev.yml` vs `infra/docker-compose.yml`
Só o `.dev.yml` existe até agora (postgres+redis, para desenvolvimento local com `pnpm dev` rodando
fora de container). O `docker-compose.yml` completo (com Evolution API, web, worker containerizados) é
tarefa futura de infra (Fase 3.3 / 5.5), não desta entrega — não confundir os dois arquivos.

## `@inno/db` (Cronos) ainda incompleto no momento desta entrega
No fim da minha sessão, `packages/db/package.json` já existia (scripts `migrate:dev`, `migrate:deploy`,
`db:seed`, `generate`, `typecheck`, dependências `@prisma/client`/`prisma` 6.19.3), mas `pnpm typecheck`
falhava nele com `TS18003: No inputs were found` — ainda sem `prisma/schema.prisma` nem `src/index.ts`.
Isso é esperado (Cronos trabalhando em paralelo) e não é um bug do meu esqueleto — se `pnpm typecheck`
falhar de novo especificamente em `@inno/db`, primeiro checar se o schema/seed já foram commitados antes
de investigar infra.
