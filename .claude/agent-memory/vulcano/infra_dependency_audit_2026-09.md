---
name: infra-dependency-audit-2026-09
description: pnpm audit em 2026-09-22 — mudou muito desde agosto (3 high+1 moderate → 3 critical+9 high+7 moderate+1 low), com item ACIONÁVEL real (next RCE)
metadata:
  type: project
---

`pnpm audit` (raiz do monorepo) em 2026-09-22, na mesma entrega que criou o CI. O que
estava registrado até agora (referência de agosto, sem memória própria minha que eu tenha
encontrado — pode ter vindo de uma sessão do Órion): 3 `high` + 1 `moderate`, todos
herdados de `sharp`/`postcss` via `next`, sem uso prático. **Isso NÃO é mais o quadro atual
— mudou bastante, e um dos achados novos é diretamente acionável.**

## Estado em 2026-09-22: 20 advisories — 3 critical, 9 high, 7 moderate, 1 low

**Os 3 `critical` — dois deles são ACIONÁVEIS de verdade:**
- **`next` — duas RCEs não-autenticadas** (`GHSA-p293-qw3h-jr36`, RCE em servidor Windows;
  `GHSA-2xp9-vwfh-vxw4`, RCE na Image Optimization API via AVIF). Vulnerável em `>=13.4.0
  <15.5.24` / `>=10.0.0 <15.5.24`. `apps/web/package.json` pina `"next": "15.5.22"` (versão
  EXATA, sem `^`) — **abaixo do patch**. Correção: bump para `>=15.5.24`. Isto é diferente
  de tudo que estava registrado antes: não é dependência transitiva inerte, é o `next` DIRETO
  do app, pinado exato, com CVE de RCE não-autenticada. **Fora do meu escopo nesta entrega**
  (não posso tocar `apps/**`) — reportado ao Atlas para Vega/Nova decidirem o bump (checar
  breaking changes do Next entre 15.5.22 e 15.5.24 antes de subir).
- **`vitest` — RCE quando o servidor de UI do Vitest está escutando** (`GHSA-5xrq-8626-4rwp`,
  vulnerável `<3.2.6`). Todo o monorepo está em `vitest: "^2.1.8"` (resolvido em 2.1.9).
  Exploração exige rodar `vitest --ui` com a porta exposta — este projeto só roda `vitest
  run` (sem UI, sem servidor), então o risco prático aqui é baixo, mas o audit vai continuar
  acusando até alguém bumpar (2.x → 4.x é major, território da Íris/quem doa os scripts de
  teste — fora do meu escopo de arquivo).

**Os 9 `high`**: `vite`/`esbuild` (transitivos de `vitest`, mesma lógica do bump acima),
`sharp` (2 advisories, libvips/libheif — transitivo de `next`, já era o achado de agosto),
`postcss` (2 advisories — transitivo de `next`, já era o achado de agosto), `js-yaml` (2
advisories — transitivo de `eslint`, ferramenta de dev, não roda em produção), `nanoid`
(transitivo de `postcss`), `deepmerge-ts` (transitivo de `prisma@6.19.3` via
`@prisma/config` — CLI do Prisma, não roda em runtime de produção).

**Os 7 `moderate` + 1 `low`**: mesma família (`vite`/`esbuild`/`postcss`/`vitest`/
`@vitest/mocker`), todos dev-tooling ou transitivos de `next`.

## O que É acionável nesta auditoria (novo, vs. agosto)
1. **Bump `next` em `apps/web/package.json` para `>=15.5.24`** — prioridade real, é RCE
   não-autenticada em dependência direta de produção, não transitiva. Reportar como
   PENDÊNCIA urgente, não implementar eu mesmo (fora do meu escopo de arquivos).
2. **Bump `vitest` (2.x → 4.x+) em todos os workspaces** — resolve o critical de UI-RCE e o
   moderate de path traversal do `@vitest/mocker`. Risco baixo de exploração aqui (UI nunca
   liga em CI/produção), mas fácil de silenciar o audit. Major bump — testar a suíte inteira
   depois (340 testes) antes de confiar.
3. Todo o resto (`js-yaml`, `deepmerge-ts`, `nanoid`, `sharp`, `postcss`, `vite`, `esbuild`)
   segue sem uso prático em runtime de produção — mesma conclusão de agosto, só que a lista
   cresceu porque o ecossistema (`next`, `prisma`, `eslint`) evoluiu e trouxe advisories
   novos nas mesmas árvores de sempre. `pnpm.overrides` no `package.json` raiz forçaria
   versões patch nessas transitivas sem esperar os pacotes-pai — **não fiz isso aqui**: é
   mudança de resolução de dependências compartilhada por todo o monorepo, fora do escopo
   que o dono me deu nesta entrega (só script novo no root `package.json`, não `overrides`).
   Reportado como sugestão em PENDÊNCIAS, não implementado.

## Como reproduzir
`pnpm audit` na raiz (usa o `pnpm-lock.yaml` do workspace inteiro). JSON completo em
`pnpm audit --json` se precisar de detalhe programático — o `--json` sozinho no PowerShell
mistura um `DeprecationWarning` do Node no stdout antes do JSON; redirecionar STDERR
separado (`2>/dev/null` ou `2>$null`) evita corromper o parse.

Ver [[infra_ci_github_actions]] para o pipeline que criei na mesma entrega.
