---
name: bug-webhook-apikey-instance-vs-global
description: Webhook da Evolution mudo em produção (nenhum retorno aceito) — validação só contra a chave GLOBAL do servidor, mas a v2 dá uma apikey PRÓPRIA por instância; corrigido aceitando as duas
metadata:
  type: project
---

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
