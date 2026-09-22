---
name: infra-ci-github-actions
description: Pipeline de CI (.github/workflows/ci.yml) criado em 2026-09-22 — o que valida, versões pinadas, decisões de escopo
metadata:
  type: project
---

Repositório acabou de ir público para o GitHub (`github.com/OverSoccerClub/InnoProspect`).
Até 2026-09-22 não havia NENHUM CI — regressão só aparecia no build do EasyPanel, depois
do push. Criado `.github/workflows/ci.yml`: um job único (`build-and-test`), em `push` e
`pull_request` para `main`, passos sequenciais: checkout → `pnpm/action-setup@v4` (versão
9.12.0, igual ao `packageManager` do `package.json` raiz e ao `corepack prepare` dos dois
Dockerfiles) → `actions/setup-node@v4` (Node 22, `cache: 'pnpm'` — **precisa vir DEPOIS do
pnpm no PATH**, senão o cache do setup-node não acha o store) → `pnpm install
--frozen-lockfile` → `pnpm --filter @inno/db run generate` (explícito) → `pnpm typecheck` →
`pnpm lint` → `pnpm test`.

## Por que Node 22 (não a 20.9 do `engines` nem a 24.12 que estava na máquina de dev)
`engines.node` no `package.json` raiz diz `>=20.9.0`, mas os DOIS Dockerfiles de produção
pinam `ARG NODE_VERSION=22` (`node:22-alpine`). Instrução explícita do dono: "confira no
package.json/Dockerfiles, não chute" — o que importa é rodar igual à produção, não igual à
máquina de dev. Se um dia os Dockerfiles subirem de major, mudar aqui junto.

## Por que `generate` é um passo explícito, não confiado ao `turbo.json`
`turbo.json` já declara `generate` como `dependsOn` de `build` e `typecheck` — então
`pnpm typecheck` dispara `prisma generate` sozinho. MAS o script raiz `test` é `pnpm -r
--if-present run test` (roda `vitest run` em cada workspace via pnpm recursivo puro), **não
passa pelo Turborepo** — sem o passo explícito de `generate` antes, `pnpm test` no CI
importaria `@inno/db` sem o Prisma Client gerado e quebraria. Descoberto lendo `turbo.json`
+ `package.json` raiz antes de escrever o workflow, não por tentativa e erro.

## `DATABASE_URL` no CI é placeholder, env de job (não secret do GitHub)
Mesmo valor (`postgresql://user:pass@localhost:5432/placeholder`) usado como default do
`ARG DATABASE_URL` nos Dockerfiles — `prisma generate` só resolve o schema, nunca conecta.
Setado como `env:` no nível do job (não por step) porque `new PrismaClient()` (singleton em
`packages/db/src/client.ts`) LÊ `DATABASE_URL` na construção — se um teste importar
`@inno/db` transitivamente (mesmo com Prisma mockado via fake objects, não `vi.mock`), falha
imediatamente sem essa env. Confirmado rodando os 340 testes localmente com só essa env
setada — passou limpo.

## Validado localmente antes de escrever o workflow (não só por leitura)
Com `DATABASE_URL` placeholder exportado nesta máquina: `pnpm --filter @inno/db run
generate` ok, `pnpm lint` ok (0 erros, 1 warning pré-existente em `packages/scraper`),
`pnpm test` ok (340/340 testes, todos os workspaces), `pnpm typecheck` (root, via turbo) ok
— rodou limpo desta vez, **ao contrário do aviso conhecido** de que o Windows trava o
binário do Prisma quando o `next dev` da porta 3000 está no ar (ver
[[feedback_pnpm_docker_monorepo_gotchas]]). Não travou nesta sessão — não sei dizer se o
`next dev` não estava ativo no momento ou se o problema é intermitente; não removi o aviso
da memória anterior, só registrei que hoje passou. O que NÃO pude provar aqui: como o
workflow se comporta de fato num runner `ubuntu-latest` do GitHub — só a primeira execução
real no GitHub confirma isso.

## O que este CI NÃO faz (de propósito)
Não roda `docker build` nem `next build` — `next build` exigiria segredos de produção reais
ou placeholders que não provam nada sobre o build do EasyPanel, para gerar um artefato que
o CI não usa. Documentado em `DEPLOY.md §9`.

Ver [[infra_dependency_audit_2026-09]] para o `pnpm audit` feito na mesma entrega (achado
mudou muito desde agosto — tem item acionável real agora).
