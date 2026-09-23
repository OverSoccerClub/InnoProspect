---
name: bug-webhook-apikey-instance-vs-global
description: Webhook da Evolution mudo em produção (nenhum retorno aceito) — 2 causas em sequência no MESMO incidente: (1) só validava a apikey GLOBAL do servidor, a v2 tem uma PRÓPRIA por instância; (2) a apikey só era lida do HEADER, a v2.3.7 manda também/só no CORPO do JSON
metadata:
  type: project
---

**🆕 Atualização 2026-09-23, incidente #2 (CONFIRMADO, não mais hipótese) —
mesma sessão, depois da correção #1 abaixo já estar em produção:** o log novo
(`webhook evolution: apikey sem correspondência...`) provou que `instanceKey`
resolvia (`instanceId` aparecia) mas a `apikey` recebida não batia com
NENHUMA das duas candidatas já aceitas (própria da instância + do servidor).
Causa raiz real, confirmada lendo o código (não infra): a rota
(`app/api/webhooks/evolution/[instanceKey]/route.ts`) só lia
`req.headers.get('apikey')` — o CORPO do webhook nunca era olhado para
autenticação, e o schema Zod do evento (`evolutionWebhookEventSchema`,
`packages/contracts/src/webhook.contract.ts`) nem declara um campo `apikey`
(ele descreve só `event`/`instance`/`data`), então mesmo que a Evolution
mandasse `apikey` dentro do JSON, `safeParse` o descartaria em silêncio antes
de qualquer comparação. A Evolution v2.3.7 pode assinar levando a `apikey` no
CORPO (`{ apikey, event, instance, data, ... }`) em vez do (ou além do)
cabeçalho — sem log específico, "não veio candidata alguma" e "veio mas não
bateu" produziam o MESMO warn, cegando o diagnóstico de novo.

**Correção #2:** `extractApiKeyFromBody` (`lib/services/webhook.ts`) lê
`apikey` direto do `rawBody` (ANTES/À PARTE de `parseEvolutionWebhookEvent`,
que só normaliza o evento e nunca veria esse campo). `isWebhookApiKeyAccepted`
mudou de assinatura — recebe agora `receivedApiKeys: readonly string[]` (0 a
2 candidatas: header e/ou corpo) em vez de uma string única, e compara CADA
candidata contra CADA credencial aceita via `flatMap`/`map` sem
short-circuit (mesma garantia de tempo constante de antes, agora estendida
ao produto cruzado). A rota loga `apiKeySource` (`'cabeçalho'` /
`'corpo'` / `'cabeçalho e corpo'` / `'nenhum (ausente...)'`) — NUNCA o valor —
na recusa, para a distinção que faltou no incidente #1 não faltar de novo. A
resposta HTTP continua sempre `404` genérico nos dois casos (não virar
oráculo). 8 testes novos em `webhook.test.ts` (aceito só por header, só por
corpo, ambas erradas, nenhuma presente, + 4 de `extractApiKeyFromBody`
isolado). `pnpm typecheck`/`lint`/`test` verdes (667 testes).

**Como evitar de novo (generalização, some-se à de baixo):** quando um
provedor externo pode transportar a MESMA credencial em mais de um
"canal" de transporte (aqui: header HTTP OU corpo JSON), a mesma lógica de
"aceitar todas as fontes conhecidas em paralelo" (já aplicada aos NÍVEIS da
credencial no incidente #1) também vale para os CANAIS de transporte dela —
não é o mesmo bug reaparecendo, é o mesmo princípio de projeto que ainda não
tinha sido aplicado à segunda dimensão do problema (fonte × canal). Continua
sem confirmação contra servidor real qual canal a v2.3.7 usa de fato — a
correção é robusta a qualquer um.

---

**Sintoma original (2026-09-23, incidente #1):**

**Sintoma (2026-09-23, bloqueava o dono em produção, 1ª mensagem real
enviada):** status trava em "Enviada" (nunca "Entregue"), resposta do lead
nunca aparece, e **opt-out por "SAIR" não descadastra** (detectado só na
mensagem que chega). Tudo que a Evolution manda de volta entra por webhook —
nada estava entrando. `EVOLUTION_WEBHOOK_BASE_URL` correta, URL registrada
na instância correta (com `instanceKey`), rota viva (`/api/v1/health` 200,
chamada externa sem `apikey` devolveu 404 — comportamento correto e
documentado).

**Causa raiz (hipótese do dono, NÃO confirmada com certeza absoluta contra a
v2.3.7 real — sem servidor disponível para testar ao vivo, mesma limitação
histórica de todo `packages/messaging`):** na Evolution v2, cada instância
tem a PRÓPRIA `apikey` (mascarada no card da instância, painel da Evolution),
distinta da chave GLOBAL do servidor. O webhook (`resolveExpectedWebhookApiKey`,
Fase 4.B) só validava contra a cadeia `instância → EvolutionServer → chave
GLOBAL decifrada` — se a Evolution assina o webhook com a chave DA INSTÂNCIA,
não havia com o que comparar, e TODO evento morria em `404` fail-closed, em
silêncio (sem log distinguível de "instanceKey errada" vs. "apikey não
bate" — o mesmo 404 pros dois casos, por desenho, para não virar oráculo).

**Correção — aceitar as DUAS credenciais em vez de escolher uma (cobre os
dois casos possíveis, já que não dá para confirmar qual a Evolution usa):**
- Schema: 4 colunas novas em `WhatsAppInstance` (`instanceApiKeyCiphertext`/
  `Iv`/`AuthTag`/`KeyVersion`, todas NULLABLE, migração
  `20260923150000_instance_webhook_apikey`, 100% aditiva) — MESMA cifra
  (AES-256-GCM) e MESMAS colunas-formato de `EvolutionServer.apiKey*`, reusada
  via `lib/evolution-server-crypto.ts` (`decryptEvolutionApiKey` aceita
  qualquer row com esse shape de 4 campos — não precisou de uma segunda
  cifra).
- Captura na criação: `EvolutionClient.createInstance` agora devolve
  `apiKey: string | null` a partir do parsing defensivo de `POST
  /instance/create` (`hash` como objeto `{apikey}`, `hash` como string,
  `token`/`apikey` soltos — `packages/messaging/src/client/wire.ts#
  readInstanceApiKey`, NENHUM formato confirmado contra servidor real).
  `createWhatsAppInstance` cifra e grava se veio algo; `null` não é erro
  (só loga e segue — a instância cai no fallback do servidor).
- Captura para instância JÁ PAREADA (o caso real do dono — não pode
  recriar, perderia a sessão): `packages/db/prisma/sync-instance-api-keys.ts`
  (🔧 2026-09-23, reescrito autossuficiente — a 1ª versão vivia em
  `apps/web/scripts/` e quebrou em produção, ver [[bug-web-image-script-wrong-location]]),
  comando operacional (`node node_modules/tsx/dist/cli.mjs packages/db/
  prisma/sync-instance-api-keys.ts`), chama `GET /instance/fetchInstances`
  via `fetch` puro (LEITURA pura — nunca `connect`/`create`, mesma distinção
  crítica de [[bug-qr-poll-invalidava-codigo]]) e casa por
  `evolutionInstanceName`.
- Webhook: `resolveExpectedWebhookApiKeys` (plural, `lib/services/
  webhook.ts`) devolve um ARRAY com as candidatas resolvíveis (própria da
  instância + do servidor/env), omitindo silenciosamente qualquer fonte que
  falhar (decifra, servidor inativo) sem derrubar a outra. `isWebhookApiKeyAccepted`
  compara `constantTimeEqual` contra CADA candidata via `.map(...).some(Boolean)`
  — nunca há short-circuit que pare na primeira igual (isso vazaria "qual
  fonte é a certa"). A rota (`app/api/webhooks/evolution/[instanceKey]/
  route.ts`) ficou fina: só chama `isWebhookApiKeyAccepted`, e agora loga
  (NUNCA na resposta HTTP, que continua sempre `404` fail-closed nos dois
  casos) qual dos dois motivos causou a recusa — `instanceKey` desconhecida
  vs. `apikey` sem correspondência. Essa distinção só no log é o que faltava
  para o PRÓXIMO incidente deste tipo não ficar invisível de novo.

**Como evitar de novo:** qualquer credencial que o PROVEDOR gera (não nós)
e que pode existir em mais de um "nível" (servidor E instância/recurso)
não deve ser assumida como uma única fonte — aceitar TODAS as fontes
legítimas conhecidas em paralelo é mais robusto que apostar em qual delas
o provedor usa, especialmente quando não há ambiente de teste real
disponível para confirmar (mesma limitação de sempre nesta máquina, ver
[[project-innoprospect]]). E todo endpoint de autenticação fail-closed
com resposta genérica (aqui, sempre 404) PRECISA logar o motivo real da
recusa — a resposta idêntica é correta por design (não virar oráculo), mas
sem log o operador fica cego exatamente quando mais precisa diagnosticar.

**Não pude validar:** nada disto rodou contra uma Evolution real (mesma
limitação de sempre) — em especial, NÃO ficou confirmado qual das duas
chaves (própria da instância ou do servidor) a v2.3.7 realmente usa para
assinar o webhook; a correção é robusta a QUALQUER uma das duas (ou às duas
ao mesmo tempo), mas se nenhuma bater na prática, o próximo passo é olhar o
log novo (`webhook evolution: apikey sem correspondência`) e comparar o
`apikey` recebido de verdade contra as duas chaves manualmente. O parsing de
`hash`/`token` em `wire.ts` e `GET /instance/fetchInstances` também não
foram confirmados contra servidor real — mesma ressalva histórica de todo
`packages/messaging` ([[convention-messaging-evolution-api]]).

Ver também [[convention-evolution-servers-multiserver]] (a Fase 4.B que
introduziu a validação por servidor, agora estendida), [[bug-qr-poll-invalidava-codigo]]
(mesma distinção "leitura pura vs. verbo que reinicia estado" aplicada ao
novo script), [[project-innoprospect]].
