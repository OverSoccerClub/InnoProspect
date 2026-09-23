---
name: convention-evolution-servers-multiserver
description: Fase 4.B — servidores Evolution API multi-servidor (cifra AES-256-GCM, CRUD admin-only, teste de conexão, bootstrap, webhook por instanceKey→instância→servidor→chave, resolução do EvolutionClient por instância)
metadata:
  type: project
---

Entregue 2026-09-23 (pedido direto do dono), em paralelo a
[[bug-pace-lock-blind-set-regression]] na mesma sessão. Schema já vinha do
Cronos (`EvolutionServer` + `WhatsAppInstance.evolutionServerId`, migração
`20260923140000_evolution_servers`, ver comentário completo lá — é a fonte
da verdade sobre a ORDEM de bootstrap). Meu escopo: a cifra, as rotas, o
teste de conexão, o script de bootstrap e a religação de TUDO que falava
Evolution direto por env.

**Cifra (`apps/web/src/lib/evolution-server-crypto.ts`):** AES-256-GCM, IV 12
bytes, auth tag 16 bytes — `encryptEvolutionApiKey`/`decryptEvolutionApiKey`.
Chave-mestre em `EVOLUTION_MASTER_KEY` (base64, `openssl rand -base64 32`),
NUNCA no banco. Versionamento (`EvolutionServer.apiKeyKeyVersion`) para
rotação futura (nunca exercitada ainda) — `resolveEvolutionMasterKey(version)`
procura, NESTA ORDEM, `EVOLUTION_MASTER_KEY_V{version}` primeiro e
`EVOLUTION_MASTER_KEY` (bare) depois; a ORDEM importa porque no dia da
rotação o nome bare passa a apontar para a chave NOVA — só o alias
versionado explícito continua resolvendo a versão ANTIGA. Peguei isso
errado na primeira versão (ordem invertida) e um teste pegou: ver o teste
"usa a versão GRAVADA NA LINHA" em `evolution-server-crypto.test.ts`.
`decryptEvolutionApiKey` NUNCA devolve texto parcial — GCM valida a auth tag
antes de devolver qualquer coisa.

**Gotcha de TypeScript novo no projeto (Bytes do Prisma):** `Buffer` do Node
é `Uint8Array<ArrayBufferLike>` (inclui `SharedArrayBuffer`); o campo
`Bytes` gerado pelo Prisma Client 6.19 exige `Uint8Array<ArrayBuffer>`
(exclui `SharedArrayBuffer`) — `tsc` rejeita passar um `Buffer` direto num
`create`/`update`. Isto é a PRIMEIRA vez que o schema usa `Bytes`; o mesmo
vai acontecer em qualquer campo `Bytes` futuro. Correção: `new
Uint8Array(buf)` (copia para um `ArrayBuffer` novo, satisfaz o tipo — nunca
`as any`) — helper `toPrismaBytes` em `evolution-servers.ts`, duplicado
(comentado) no script de bootstrap por não poder importar de `apps/web`.

**A credencial NUNCA sai** — `hasApiKey: true` (booleano, sempre `true`
porque a coluna é `NOT NULL`) é o único sinal na API/tela de que existe
chave. `create`/`update` (rotação) cifram ANTES de qualquer chamada Prisma.

**Rotas (`packages/contracts/src/evolution-server.contract.ts` +
`apps/web/src/app/api/v1/evolution-servers/**`), TODAS `requireRole:
'admin'`** (mecanismo único já existente, `api-handler.ts` — não inventei
nada novo): `GET`/`POST /evolution-servers`, `GET`/`PATCH`/`DELETE
/evolution-servers/:id` (`DELETE` = desativar, `isActive:false`, NUNCA
apaga a linha — bloqueia com `409 SERVER_IN_USE` se houver instância ATIVA
apontando pra ele; instância já inativa não bloqueia), `POST
/evolution-servers/:id/test-connection`.

**Teste de conexão** (`EvolutionClient.testConnection`, novo método em
`@inno/messaging` — `GET /instance/fetchInstances`, `retryable:false`,
timeout CURTO de 6s pro clique do operador não ficar pendurado — NUNCA
lança por falha de conexão, `ok:false` É o resultado, só `404` se `:id` não
existir). Endpoint escolhido por não depender de nenhuma instância já
existir no servidor — só confirma URL alcançável + apikey aceita.

**Bootstrap (`packages/db/prisma/evolution-servers.ts`, comandos `bootstrap`/
`check`, roda via `tsx` no container do `web`, NUNCA no `worker`):** lê
`EVOLUTION_API_URL`/`EVOLUTION_API_KEY` do ambiente, cria (ou reaproveita,
idempotente) o primeiro `EvolutionServer`, e faz `updateMany` ligando toda
`WhatsAppInstance` com `evolutionServerId IS NULL` a ele. Dono lógico
(`createdById`) é o admin mais antigo do banco (`findFirst` por `role:
'admin'`) — não há ator humano numa sessão de script.

**Resolução do cliente Evolution (`apps/web/src/lib/evolution.ts`,
reescrito) — 3 funções, cada uma pro seu caso:**
- `requireActiveEvolutionServer(id)` — `evolutionServerId` vem do CORPO da
  requisição (`POST /whatsapp/instances`, agora OBRIGATÓRIO no contrato —
  ver PENDÊNCIA da Lyra abaixo): erro de servidor errado é `404`/`409`
  (culpa do request atual).
- `getEvolutionClientForInstance(instance)` — instância JÁ EXISTENTE
  (connect/qr/disconnect/delete/enviar mensagem): usa
  `instance.evolutionServerId` se presente; cai no cliente por
  `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` (env, singleton com log de
  fallback UMA VEZ por processo) SÓ enquanto for `null` (instância legada,
  janela de bootstrap). Servidor inexistente/inativo aqui é `502
  UPSTREAM_ERROR` (não é culpa do request atual, é inconsistência de dados).
- `getEvolutionClientForServer(server)` — usado quando o servidor já foi
  carregado (ex.: `createWhatsAppInstance` depois de
  `requireActiveEvolutionServer`).

**Onde chamei cada uma** — `messages.ts#sendLeadMessage` resolve o cliente
ANTES do write-ahead e ANTES de `evaluateSendGuard` (não dentro do bloco
`try`/`sendText`) — colocar ali violaria o invariante que o Órion audita
("entre o guard e `sendText` só existe a transação de write-ahead") ao
introduzir uma 2ª leitura de banco nessa janela; resolver mais cedo também
evita reservar cota para um envio que nem vai achar servidor.
`whatsapp-instances.ts` (qr/connect/disconnect/delete) resolve dentro do
próprio `try` que já existia (comportamento equivalente, mais simples de
ler).

**Webhook (`app/api/webhooks/evolution/[instanceKey]/route.ts` +
`lib/services/webhook.ts#resolveExpectedWebhookApiKey`, NOVO):** movi a
resolução da chave esperada para o SERVIÇO (rota ficou fina, mesma
convenção #2 de [[convention-api-routes-fase1]]) — cadeia `instanceKey →
instância → EvolutionServer → chave decifrada`, cai no fallback de
`EVOLUTION_API_KEY` (env) SÓ se `evolutionServerId` for `null`. Devolve
`null` (NUNCA lança) em qualquer caso ambíguo — servidor inexistente,
inativo, falha ao decifrar — e a ROTA trata `null` EXATAMENTE como "apikey
não bate" (`404`, fail-closed, mesma regra de nunca confirmar existência
via status diferente). `constantTimeEqual` continua na comparação final —
não regrediu, só a origem da chave esperada mudou de "ler env" para
"decifrar do servidor".

**⚠️ PENDÊNCIA que QUEBRA `pnpm typecheck` em 1 arquivo da Lyra —
`apps/web/src/components/whatsapp/create-instance-dialog.tsx:36`.**
`createWhatsAppInstanceBodySchema` (contrato) passou a exigir
`evolutionServerId` — decisão do Cronos, escrita no comentário do campo no
schema Prisma ("toda rota NOVA de criação de instância deve exigir o campo,
mesmo que o banco ainda aceite NULL"), não uma escolha minha por conta
própria. NÃO editei o componente (território da Lyra). A tela precisa de um
seletor de servidor (`GET /api/v1/evolution-servers`) antes de chamar
`createInstance`. Reportado em destaque no handoff — não é um bug meu para
"resolver depois", é a próxima ação literal da Lyra.

**Testes novos:** `evolution-server-crypto.test.ts` (12, cifra real —
ida-e-volta, IV nunca repete, adulteração de ciphertext/auth-tag falha,
chave errada falha, rotação por versão), `evolution-servers.test.ts` (19,
CRUD + teste de conexão contra `@/test/fake-db` estendido com
`evolutionServer`/`whatsAppInstance.count`/`updateMany`), 7 novos em
`webhook.test.ts` (cadeia completa + fallback + fail-closed em cada caso
ambíguo), 3 novos em `evolution-client.test.ts` (`testConnection`), 6 novos
em `admin-routes.test.ts` (as 5 rotas novas, `requireRole:'admin'` de
verdade via `apiRoute` real). Total do monorepo: 623 (era ~562).

**Não pude validar:** nada disto rodou contra Postgres/Evolution API reais
(mesma limitação de sempre nesta máquina) — a migração do Cronos também não
foi aplicada de verdade. `EvolutionClient.testConnection` contra
`/instance/fetchInstances` nunca foi confirmado contra uma Evolution real
(mesma pendência histórica de todo `packages/messaging`, ver
[[convention-messaging-evolution-api]]) — se o endpoint/shape divergir,
o teste de conexão da tela vai reportar `ok:false` com um código genérico
em vez do erro específico, mas nunca vai travar a rota.

Ver também [[project-innoprospect]], [[convention-api-routes-fase1]],
[[convention-messaging-evolution-api]], [[bug-pace-lock-blind-set-regression]]
(mesma sessão).
