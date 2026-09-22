---
name: prisma-generate-eperm-dev-server
description: `prisma generate`/`pnpm typecheck` falham com EPERM ao renomear o .dll.node do client enquanto o `next dev` do dono está rodando no Windows — não é bug do schema.
metadata:
  type: project
---

Com o `next dev` do dono ativo (`apps/web`), rodar `prisma generate` — direto
ou via `pnpm typecheck` (que no `turbo.json` tem `generate` como
`dependsOn`) — falha assim no Windows:

```
Error: EPERM: operation not permitted, rename
'...\generated\client\query_engine-windows.dll.node.tmp<PID>' ->
'...\generated\client\query_engine-windows.dll.node'
```

**Por quê:** o processo do `next dev` carrega o binário nativo do query
engine em memória; o Windows não deixa renomear/substituir um `.dll.node`
que está em uso por outro processo. Não é falha do schema nem da migração —
aconteceu até numa mudança 100% aditiva (só `CREATE INDEX` novo, nenhum
campo/model alterado), onde o Prisma Client TS gerado nem mudaria de
verdade.

**Como aplicar:** quando isso acontecer:
1. Não tentar matar o processo do dono (`next dev`) para "resolver" —  não é
   seu para matar.
2. Rodar `tsc --noEmit` direto dentro de `packages/db` (sem passar pelo
   `generate` do turbo) para confirmar que o *schema*/tipos estão OK — se a
   mudança for só índice novo (sem novo campo/model/enum), o client já
   gerado antes continua válido, então isso é suficiente para validar.
2. `pnpm test` na raiz não depende de `generate` (script raiz é só
   `pnpm -r --if-present run test`, sem passar por turbo) — rodar para
   confirmar que nada quebrou, mesmo sem regenerar o client.
3. Reportar no handoff que o `prisma generate`/`pnpm typecheck` completo
   (monorepo) só vai rodar de verdade quando o dono reiniciar o `next dev`
   (ou numa sessão sem ele rodando) — não é bloqueio real do trabalho, é
   travamento de arquivo específico do Windows.
