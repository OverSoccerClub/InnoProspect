---
name: evolution-server-multi-servidor
description: Modelagem do EvolutionServer (Fase 4.B) — cifra em repouso em Bytes/GCM, FK nullable temporária com bootstrap operacional, e por que o script roda no container do web (tsx), não do worker (tsup).
metadata:
  type: project
---

Migração `20260923140000_evolution_servers` (packages/db) resolve o
diagnóstico do dono: `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` eram env vars
globais — um servidor Evolution só. Três decisões que vão se repetir:

1. **Credencial cifrada em `Bytes` (bytea), não `String` base64.**
   `apiKeyCiphertext`/`apiKeyIv`/`apiKeyAuthTag` são `Bytes` — mapeiam 1:1
   para `Buffer` no Node (`crypto.createCipheriv`/`createDecipheriv` já
   produzem/consomem Buffer, zero encode/decode manual) e evitam o
   overhead de ~33% que base64 teria numa `String`. Convenção assumida:
   AES-256-GCM, IV de 12 bytes, auth tag de 16 bytes — 3 colunas
   SEPARADAS (não 1 blob concatenado) para não haver risco de errar
   offset ao fatiar um blob único. `apiKeyKeyVersion Int @default(1)`
   versiona a CHAVE-MESTRE (não o algoritmo) — existe para rotação futura
   da chave-mestre sem ter que decifrar/recifrar tudo no mesmo instante em
   que a env var trocar. **A implementação da cifra em si (o arquivo que
   chama `createCipheriv`) é do Vega — eu só fixei o formato das colunas.**
   Onde esse arquivo mora (packages/db, core ou messaging) não foi
   decidido por mim de propósito — é escolha do Vega, sem travar aqui.

2. **FK nullable de propósito — contract (NOT NULL) é uma SEGUNDA migração,
   não incluída nesta entrega.** `WhatsAppInstance.evolutionServerId`
   nasce `String?` porque toda instância de produção já existe e o valor
   certo (qual servidor real ela usa hoje) só existe fora do banco, na env
   var — não dá para backfillar dentro da própria migração de schema. A
   sequência obrigatória: (1) esta migração roda automática no boot; (2)
   script operacional `evolution-servers.ts bootstrap` (a escrever, Vega)
   cria o primeiro `EvolutionServer` a partir da env var e faz 1 UPDATE
   backfillando todo NULL; (3) confirmar `COUNT(*) WHERE
   evolutionServerId IS NULL = 0`; (4) só então uma segunda migração com
   `ALTER COLUMN ... SET NOT NULL`. Rodar o passo 4 antes do 2/3 quebraria
   toda instância existente. Ver [[gate-nullable-e-contadores-concorrentes]]
   para o padrão irmão (lá é sobre "NULL = sem bloqueio"; aqui é "NULL =
   ainda não migrado", outra semântica, mesmo cuidado de ordem).

3. **Script de bootstrap roda no container do `web` via `tsx`, NÃO é
   entrada do tsup do `worker`.** `packages/db/prisma/*.ts` (seed.ts,
   admin.ts) já têm um caminho de execução estabelecido — `node
   node_modules/tsx/dist/cli.mjs packages/db/prisma/<script>.ts` a partir
   de `/app` no container `web` (DEPLOY.md §7 passo 5). A regra "todo
   script operacional novo precisa ser entrada do tsup" (DEPLOY.md §7.2) é
   especificamente do `worker` (que não tem `pnpm`/`tsx`/`src` na imagem
   final) — não se aplica a scripts de `packages/db/prisma`, que sempre
   correram pelo caminho do `web`. Um novo `evolution-servers.ts` segue o
   MESMO padrão de `admin.ts`, não o do worker.

4. **FK `Restrict` em `EvolutionServer` referenciado, `@unique` em
   `baseUrl`.** Mesma família de "409 X_IN_USE" já usada em
   `CampaignInstance.instance`/templates referenciados por Campaign —
   servidor com qualquer instância viva não pode ser apagado por baixo.
   `baseUrl` único depende da APLICAÇÃO normalizar (sem barra final) antes
   de gravar — banco não sabe que duas strings são a "mesma" URL.
