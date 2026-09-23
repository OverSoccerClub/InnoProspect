---
name: innoprospect-fase3-whatsapp-optout-webhook
description: Auditoria de segurança da Fase 3 do InnoProspect (2026-08-03) — webhook Evolution, opt-out público, credenciais Evolution, anti-ban, LGPD. Achados por severidade e o que confirmar de novo na próxima rodada (Fase 4 dispatch).
metadata:
  type: project
---

Auditoria de 2026-08-03, focada nas duas rotas públicas novas (`POST
/api/webhooks/evolution/:instanceKey`, `POST /api/v1/public/optout`) e no que veio junto (opt-out,
templates, instâncias WhatsApp). Ver [[innoprospect-security-baseline]] para o padrão geral do
projeto e [[innoprospect-pending-gologive-items]] para o status dos achados da Fase 1.

**Achado estrutural mais importante: NÃO existe worker de disparo ainda.** `apps/worker/src/jobs/`
só tem `scrape-search.job.ts`. Não existem `dispatch-tick.job.ts`, `warmup-roll.job.ts` nem
`retention.job.ts` (todos mencionados na ARQUITETURA como Fase 4/5.3, ainda não implementados).
`EvolutionClient.sendText()` (`packages/messaging`) não é chamado em NENHUM lugar de `apps/web` ou
`apps/worker` — só existe teste unitário. Também não há rota `POST /api/v1/campaigns` (schema de
`Campaign`/`CampaignTarget` existe, API não). **Consequência prática: o sistema não consegue disparar
uma única mensagem de WhatsApp real hoje, então os "portões" anti-ban (§6: opt-out antes do envio,
teto diário, kill switch) não têm o que proteger ainda — não há caminho de código nenhum que envie
mensagem, muito menos um que pule o opt-out.** Quando a Fase 4 (dispatch worker) for implementada,
essa é a PRIMEIRA coisa a auditar: confirmar que o `dispatch-tick.job` consulta `OptOut` por telefone
sem cache, imediatamente antes de cada `sendText`, dentro da mesma janela de decisão.

**Design do opt-out público é sólido.** Token de `/descadastro/:token` é
`base64url(phoneE164) + "." + HMAC-SHA256(phoneE164, OPTOUT_TOKEN_SECRET)` — não forjável sem o
segredo do servidor, telefone visível no token mas isso é intencional (não é segredo, é o próprio
número de quem recebeu o link). `parsePublicOptOutToken`/`verifyOptOutToken`
(`packages/core/src/optout/token.ts`) usam `timingSafeEqual`. Idempotente por desenho (reclique não
gera 409). **Não tem TTL** (HMAC determinístico, sem expiração) — decisão aceitável dado que é um
link de auto-serviço permanente, o pior cenário de reuso é o titular confirmar de novo o próprio
opt-out.

**Gap real (RESOLVIDO, confirmado em 2026-09-23): as duas rotas públicas agora têm rate limit E
limite de corpo.** `apiRoute({ rateLimit, maxBodyBytes })` ganhou os dois parâmetros; `POST
/api/v1/public/optout` (10 req/min por IP, corpo ≤4KB) e `POST /api/webhooks/evolution/:instanceKey`
(300 req/min por IP, corpo ≤1MB) os usam, e o rate limit roda como PRIMEIRO passo do `apiRoute` — antes
de sessão, antes de `req.text()`/`JSON.parse`. O `RATE_LIMITED` que a tela já esperava
(`unsubscribe-view.tsx`) agora É emitido de verdade pelo backend. Ressalva que CONTINUA valendo, não
resolvida: `clientIp`/`clientIpFromRequest` (`lib/rate-limit.ts`) confiam no primeiro valor de
`X-Forwarded-For` sem validar se o proxy do EasyPanel de fato o sobrescreve — se não sobrescrever, um
cliente forja o header e ganha um contador novo por requisição, esvaziando as duas defesas (rate limit
de rota pública E o rate limit de login por IP em `lib/auth.ts`). Ainda "não validado nesta máquina
contra o proxy real" (comentário do próprio código) — item de infra a confirmar com Vulcano antes de
contar com isso como defesa forte. Ver [[innoprospect-2026-09-23-infra-paginacao]].

**Webhook Evolution segue exatamente o contrato descrito no próprio código-fonte**
(`app/api/webhooks/evolution/[instanceKey]/route.ts`, comentário no topo do arquivo): `instanceKey`
errado E `apikey` errado devolvem o MESMO `404` (não `401`), comparação de `apikey` em tempo
constante (`constantTimeEqual`, sem `node:crypto`, em `@inno/messaging`), sempre `200 {received:true}`
mesmo com erro de processamento interno (try/catch em volta de `processEvolutionWebhookEvent`,
loga e segue). Idempotência por `providerMessageId` é `Prisma.Message.providerMessageId @unique` +
`tx.message.upsert` (atômico no nível do banco, sobrevive a concorrência de verdade, não só
lógica de aplicação). Nota menor não bloqueante: o `findUnique(instanceKey)` roda ANTES da checagem
de `apikey` — para `instanceKey` errado o request retorna rápido sem tentar `apikey`, para
`instanceKey` certo + `apikey` errado sempre faz o roundtrip de banco primeiro. Diferença de timing
teoricamente observável, mas irrelevante na prática (`instanceKey` é 256 bits aleatórios,
inviável de força bruta independente de qualquer oráculo de timing).

**Sem SSRF encontrado.** Toda URL que o backend manda pra Evolution API usa `EVOLUTION_API_URL` (env)
como base fixa — nunca dado vindo do webhook ou do usuário. `buildWebhookUrl` usa
`EVOLUTION_WEBHOOK_BASE_URL` (env) + `instanceKey` gerado pelo servidor.

**`EVOLUTION_API_KEY` não vaza**: só usada como header de request (`client/http.ts`), nunca aparece em
mensagem de erro (`classifyStatus` usa só o corpo da resposta da Evolution, não a config), o
`logger.ts` só serializa `name/message/stack` de `Error` (nunca o objeto inteiro/`cause`). `instanceKey`
por instância nunca aparece em nenhum DTO de resposta da API (`WhatsAppInstanceItem`/`Detail`) — fica
só em banco e no client interno.

**LGPD (§7): opt-out (direito de oposição) agora está implementado e funcional** — antes só
existiam os campos de origem (§7.2). Ainda faltam, confirmados como pendentes em 2026-08-03: nenhum
`retention.job.ts` (schema já tem o comentário `/// retention.job apaga fisicamente após 7 dias` em
`RawCapture`, mas o job não existe) e nenhuma "ação de eliminação" (direito de apagar dado do titular)
— ambos documentados como Fase 5.3 na própria ARQUITETURA, não é surpresa, só reconfirmar quando
essa fase for revisada.

**`pnpm audit --prod` rodou com sucesso desta vez** (sem rede bloqueada) — achou só vulnerabilidades
HERDADAS de dependências internas do `next@15.5.22` (não do código do projeto): `sharp` (CVEs
libvips, `<0.35.0`) e `postcss` (`<=8.5.17`, path traversal/XSS via sourcemap). Risco prático baixo
neste projeto: `next/image` não é usado em lugar nenhum (`grep` não achou `next/image` fora do
matcher do middleware), então `sharp` provavelmente nem roda em runtime; `postcss` só atua em build
time, não em runtime servindo CSS de usuário. Classificado como Baixo/dívida aceitável — vale só
acompanhar se o Next.js lançar um patch que resolva as duas transitivamente.

**Nenhuma regressão de defesa em profundidade**: só 3 rotas com `requireAuth:false` em todo
`apps/web/src/app/api` (`/api/v1/health`, `/api/v1/public/optout`, `/api/webhooks/evolution/...`) —
exatamente as esperadas. `DELETE /api/v1/optouts/:id` checa `role==='admin'` dentro do serviço
(`deleteOptOut`), primeira rota do projeto a de fato usar `session.user.role` desde que o modelo
"autenticado=tudo" foi documentado como decisão consciente.

**Nenhum XSS de mensagem inbound**: texto de mensagem do WhatsApp (`event.text`,
`InboundMessageEvent`) não é renderizado em lugar nenhum do dashboard ainda (timeline de lead só
mostra labels fixas + `from/to` de status cost), e o projeto não usa `dangerouslySetInnerHTML` em
lugar nenhum — quando `message.body` passar a ser exibido de fato, o React já escapa por padrão,
mas vale reconfirmar se algum componente futuro usar `dangerouslySetInnerHTML` para renderizar
templates/spintax.
