---
name: convention-messaging-evolution-api
description: Convenções e superfície pública do packages/messaging (cliente Evolution API + parser de webhook), Fase 3.2
metadata:
  type: project
---

Entregue 2026-08-01 (item 3.2 do plano faseado, ARQUITETURA §8): `packages/messaging` completo — único
pacote que conhece a Evolution API (mesma regra do `packages/scraper` com o Google Maps). 48 testes
vitest passando, typecheck/lint limpos no monorepo inteiro.

**Superfície pública (`packages/messaging/src/index.ts`):**
- `EvolutionClient` (construído com `{baseUrl, apiKey, timeoutMs?, fetchImpl?}`, ou
  `evolutionConfigFromEnv()` lendo `EVOLUTION_API_URL`/`EVOLUTION_API_KEY`):
  `createInstance`, `connect`, `getConnectionState`, `disconnect` (logout, mantém a instância),
  `deleteInstance`, `setWebhook` (por instância, não global — ARQUITETURA §4.8), `sendText`,
  `checkNumbers` (EXPERIMENTAL, endpoint `/chat/whatsappNumbers` não confirmado — ver PENDÊNCIAS).
- `MessagingError` (`code` fechado: `INSTANCE_DISCONNECTED | INSTANCE_NOT_FOUND | INVALID_NUMBER |
  RATE_LIMITED | AUTH_ERROR | VALIDATION_ERROR | TRANSIENT_ERROR | TIMEOUT | UNKNOWN`, `retryable`
  derivado). Isto é o que o kill switch (ARQUITETURA §6.6) e o futuro dispatch worker devem consumir
  para decidir halt/retry — não reclassificar por conta própria.
- `parseEvolutionWebhookEvent(rawBody: unknown): MessagingWebhookEvent` — NUNCA lança (webhook precisa
  responder 200 rápido mesmo com payload ruim, ARQUITETURA §4.8). União:
  `message_received | message_status | connection_update | qr_updated | ignored`.
  `message_received.isOptOutRequest`/`optOutTrigger` já vêm calculados (reusa `findOptOutTrigger` de
  `@inno/core`, não duplica a lista de gatilhos). `providerMessageId` é a chave de idempotência
  (`data.key.id`/`data.keyId`) — **quem faz o dedupe é a rota** (tem Postgres); o parser só expõe o
  campo de forma estável.
- `constantTimeEqual(a, b)` — comparação em tempo constante para a futura rota validar o header
  `apikey` contra `EVOLUTION_API_KEY` (ARQUITETURA §4.8 exige "tempo constante").

**Decisão de dependência (deliberada):** `packages/messaging` depende de `@inno/contracts` (reusa
`evolutionWebhookEventSchema`/`EVOLUTION_MESSAGE_STATUS_MAP`/`e164Schema` — já é o CONTRATO do shape
bruto do webhook, não duplicar) e `@inno/core` (`findOptOutTrigger`). Ambos são pacotes puros
(zod-only / sem I/O pesado), então isso NÃO viola a regra "não arrastar dependência pesada pro bundle
do Next" (essa regra é sobre Playwright/`@inno/scraper`, não sobre `@inno/contracts`/`@inno/core` —
`@inno/core` já depende de `@inno/contracts` há tempo, ver [[convention-api-routes-fase1]]).

**Retry de transporte — regra que não é óbvia de re-derivar lendo o código correndo:** o cliente HTTP
(`client/http.ts`) só retenta automaticamente `TRANSIENT_ERROR`/`TIMEOUT` (rede/5xx/timeout nosso), e
**nunca** `RATE_LIMITED` (429) mesmo esse sendo `retryable:true` em nível de negócio — retry automático
de transporte contra um 429 conflita com a cadência deliberada do dispatch worker (jitter/backoff fazem
parte do anti-ban, ARQUITETURA §6.1/§6.3, não só de resiliência). `RATE_LIMITED` tem
`MESSAGING_ERROR_POLICY.maxAttempts = 0` de propósito; quem decide quando reenviar é a camada de cima
(dispatch worker, ainda não implementado).

**⚠️ NÃO validado contra um servidor Evolution real** (não havia um rodando no ambiente). Todo o
conhecimento de endpoint/payload está isolado em `client/wire.ts` (equivalente ao `selectors.ts` do
scraper) e os parsers de resposta são defensivos de propósito. Antes de ligar em produção: validar
contra um Evolution API real (a) o shape de `/instance/create` e `/instance/connect` (QR), (b) se
`messageTimestamp` do `messages.upsert` vem em segundos ou ms Unix, (c) o endpoint/shape de
`/chat/whatsappNumbers` (é a parte mais incerta — considerar remover se a doc real divergir muito), (d)
nomes de evento aceitos por `POST /webhook/set` (`DEFAULT_WEBHOOK_EVENTS`).

**Pendência explícita para a próxima rodada:** ainda falta (a) a rota real
`POST /api/webhooks/evolution/:instanceKey` em `apps/web` (valida `:instanceKey`→404 se errado,
`apikey` header com `constantTimeEqual`, chama `parseEvolutionWebhookEvent`, persiste com Prisma —
Cronos está modelando `Message`/`OptOut`/`WhatsAppInstance` em paralelo, ver [[project-innoprospect]]),
e (b) o dispatch worker que usa `EvolutionClient`/`MessagingError.retryable` dentro do loop do §6.1.

Ver também [[bug-vitest-fake-timers-retry-backoff]] (gotcha de teste descoberto ao testar o retry).
