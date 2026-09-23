---
name: bug-web-image-script-wrong-location
description: Script operacional escrito em apps/web/scripts/ falha ERR_MODULE_NOT_FOUND em produção — a imagem do web só copia o bundle .next/standalone + packages/db, nunca apps/web/src ou outros @inno/*
metadata:
  type: project
---

**Sintoma (2026-09-23, 2ª vez que este tipo de erro bloqueia o dono em
produção):** `node node_modules/tsx/dist/cli.mjs apps/web/scripts/
sync-instance-api-keys.ts` no container do `web` → `Error
[ERR_MODULE_NOT_FOUND]: Cannot find module '/app/apps/web/scripts/
sync-instance-api-keys.ts'`.

**Causa raiz — duas camadas, não só o caminho:**
1. `apps/web/scripts/` nunca é copiado para a imagem. `apps/web/Dockerfile`
   (stage `runner`) copia só `.next/standalone`, `.next/static`, `public`,
   `node_modules` completo, `packages/db/prisma`, `packages/db/src`, os dois
   `package.json` e `pnpm-workspace.yaml`. Nenhum `apps/web/src`/`apps/web/
   scripts` sobrevive — o que existe em runtime é o BUNDLE do Next, não o
   fonte.
2. Mesmo se o arquivo existisse, as dependências que ele importava não
   estariam lá: `@inno/messaging` e `apps/web/src/lib/*`. O `node_modules`
   completo TEM os symlinks `@inno/*`, mas eles só resolvem para pacotes cujo
   CÓDIGO-FONTE também foi copiado — hoje só `packages/db`. `@inno/messaging`
   fica pendurado sem destino.

O contraste que devia ter me feito notar o padrão antes: `packages/db/
prisma/evolution-servers.ts` (o script de bootstrap anterior, mesma sessão)
RODA — porque importa só `node:crypto` e `../src/client.js`, os dois
presentes na imagem.

**Correção:** todo script operacional NOVO do `web` vive em
`packages/db/prisma/` (mesmo lugar de `seed.ts`/`admin.ts`/
`evolution-servers.ts`), importa só `node:*` + `../src/client.js`, e chama
qualquer HTTP externo com `fetch` puro (nunca `@inno/messaging`/
`EvolutionClient`). Se precisar de uma função de outro pacote (ex.: a cifra
AES-GCM de `evolution-server-crypto.ts`), DUPLICA deliberadamente — nunca
importa `apps/web/src` ou `@inno/*` além do próprio `@inno/db`. Regra
completa (com o "porquê" e uma guarda de CI proposta) em `DEPLOY.md §7.2.1`.

**Como evitar de novo:** isto é a MESMA classe de bug do backfill do worker
(`DEPLOY.md §7.2`, "todo script operacional precisa ser entrada do tsup" —
lá porque a imagem do worker só carrega `dist/`) — só que pelo motivo
inverso: o `web` carrega o BUNDLE do Next, não o fonte. **Antes de escrever
qualquer script operacional novo, decidir em que imagem ele vai rodar e
verificar contra o `Dockerfile` daquela imagem o que realmente é copiado —
nunca assumir que "existe no repo" = "existe no container".** Documentado
como regra permanente (não só um bug pontual) porque a 1ª vez (worker) não
generalizou para a 2ª vez (web) — cada imagem tem sua própria lista de
"o que sobrevive", e as duas listas são diferentes por motivos diferentes.

Ver também [[convention-evolution-servers-multiserver]] (o script que já
seguia o padrão certo, mesma sessão), [[bug-webhook-apikey-instance-vs-global]]
(o script que quebrou este bug, agora corrigido e movido para
`packages/db/prisma/sync-instance-api-keys.ts`), [[project-innoprospect]].
