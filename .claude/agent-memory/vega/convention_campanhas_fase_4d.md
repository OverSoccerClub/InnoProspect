---
name: convention-campanhas-fase-4d
description: Fase 4.D — API de campanha sem motor (POST/GET/PATCH/DELETE/ações + disparo manual por alvo). Contrato completo, decisões de escopo (sem preview), reuso do guard único de envio, e o que ficou provado vs. não.
metadata:
  type: project
---

Entregue 2026-09-24 (Fase 4.D, ARQUITETURA §4.5/§6.8). Antes desta rodada NÃO
existia nenhuma rota de campanha (confirmado por busca antes de começar) —
`packages/contracts/src/campaign.contract.ts` e o schema (`Campaign`/
`CampaignInstance`/`CampaignTarget`, Cronos) já estavam prontos, inclusive
`CampaignInstance.sentCount/failedCount` (o pedido do §4.5.8 já tinha sido
atendido antes de eu olhar — não precisei pedir nada ao Cronos nesta rodada).

**Arquivo principal:** `apps/web/src/lib/services/campaigns.ts`. Rotas em
`apps/web/src/app/api/v1/campaigns/**` — `route.ts` (GET/POST), `[id]/
route.ts` (GET/PATCH/DELETE), `[id]/[action]/route.ts` (start/pause/resume/
cancel, mesmo padrão de `whatsapp/instances/[id]/[action]`), `[id]/targets/
route.ts` (GET), `[id]/targets/[targetId]/send/route.ts` (POST, disparo
manual). **Sem `requireRole`** em nenhuma rota de campanha — decisão
registrada: campanha é ferramenta de trabalho do operador do dia a dia (como
`leads`/`templates`), não infraestrutura administrada só por admin (diferente
de `whatsapp/instances`/`users`/`evolution-servers`, ver
[[convention-admin-role-and-user-crud]]).

**Gaps do contrato preenchidos nesta rodada (Nova/Cronos não tinham escrito
ainda — mesmo padrão de `reason` em `common.ts`, "implementar sem o campo
deixaria buraco documentado"):**
- `campaignAudienceExcludedSchema.alreadyTargeted` (6º motivo de exclusão,
  ARQUITETURA §4.5.4 item 6, "🆕 v1.2" na doc mas nunca chegou no Zod).
- `patchCampaignBodySchema`/`patchCampaignResponseSchema` (PATCH inteiro).
- `sendCampaignTargetBodySchema`/`sendCampaignTargetResponseSchema` (o 2º
  reusa `sendLeadMessageResponseSchema` de `whatsapp.contract.ts` — MESMO
  formato do envio unitário da ficha do lead, porque por baixo é a MESMA
  função de serviço).
- `resolveLeadWhere` (`lib/services/leads.ts`) passou de privada para
  **exportada** — é o `where` do `LeadFilter` (documentado como
  compartilhado em 3 lugares: `GET /leads`, `POST /leads/bulk`, `POST
  /campaigns`) — reimplementar seria a MESMA violação que o guard de envio
  proíbe, só que para o filtro de audiência.

**A Lyra estava construindo em paralelo, no MESMO dia, contra o contrato
ANTES desses gaps existirem** — confirmado ao vivo: `apps/web/src/types/
campaign.ts` tinha uma nota "`alreadyTargeted`/PATCH/preview ainda não
existem, gap reportado para o Atlas". Ela reagiu em tempo real durante esta
sessão (atualizou `types/campaign.ts` para consumir os 3 nomes que eu
publiquei, exatamente com os nomes que eu escolhi — `PatchCampaignBody`,
`SendCampaignTargetBody`, `SendCampaignTargetResponse`). `apps/web/src/lib/
campaign-audience.ts` (dela, preview client-side) quebrou o `typecheck` na
hora que eu adicionei `alreadyTargeted` ao schema — corrigi com o MENOR diff
possível (campo sempre `0` no preview client-side, documentado como
limitação: ela não tem acesso a outras campanhas em memória) — não toquei
`components/**` nem a lógica de cálculo dela além do necessário para o tipo
fechar.

**`POST /campaigns/preview` (§4.5.3) NÃO foi implementado nesta rodada —
decisão deliberada, não esquecimento.** Não havia schema no contrato (só
prosa na ARQUITETURA), o pedido do Atlas não listava `preview` entre os 6
itens, e a Lyra já tinha resolvido o mesmo problema de produto (audiência
recalculada a cada tecla, sem gravar nada) 100% client-side em `lib/
campaign-audience.ts`/`lib/campaign-estimate.ts` — um endpoint de preview
serviria só para fechar o gap do `alreadyTargeted` (que o client não pode
calcular sem dar N+1 no backend). Registrado como PENDÊNCIA, não bug.

**`createCampaign` — materialização no `POST`, não no `start` (A27,
§4.5.2).** `classifyAudience()` roda os 6 motivos de exclusão EM ORDEM
(cada lead conta em um só, o primeiro que casar — é o que sustenta
`totalMatched = eligible + Σ excluded`, testado): `noPhone` → `landline`
(`phoneType !== 'mobile'`, inclui `unknown`, não só `=== 'landline'`) →
`optedOut` → `duplicatePhone` (mantém o `createdAt` mais antigo — candidatos
vêm ordenados asc) → `recentlyContacted` → `alreadyTargeted` (pendente em
OUTRA campanha não terminal). `audience.mode: 'ids'` consulta direto por
`id: {in}`; `mode: 'filter'` reusa `resolveLeadWhere` (ver gap acima).

**`startCampaign` — segunda passagem de exclusão de verdade (§4.5.2/§4.5.9),
provada com teste.** Reavalia opt-out + contato recente sobre os alvos JÁ
materializados, dentro da MESMA transação que congela o
`renderedTemplateSnapshot` e seta `scheduledFor`. Decisão registrada: se a
2ª passagem excluir TODOS os pendentes restantes, a transação **lança**
(`ApiHttpError` dentro do callback do `$transaction` → rollback automático do
Prisma) em vez de eu inventar um estado `completed` fora do contrato — o
contrato de `start` exige literal `status: 'running'`, então "zero pendente
depois da 2ª passagem" tem que virar `409 EMPTY_AUDIENCE` sem nada
persistido, não um sucesso disfarçado.

**Validação de conteúdo no `start` (§4.5.10) roda sobre a PARTE FIXA do
template** — `stripSpintaxGroups()` (função nova, remove `{a|b}` mantendo
`{{var}}`) + `renderTemplate(..., {minha_empresa: APP_COMPANY_NAME})` (as
demais variáveis ficam vazias de propósito — não importa para
`hasOptOutNotice`/`hasCompanyNameMention`). `INSUFFICIENT_TEXT_VARIATION`:
`variações < 10 E alvos(`totalTargets`) > 50`.

**Edição por estado (§4.5.5, A28) — `EDITABLE_FIELDS_BY_STATUS`, tabela 1:1
com a ARQUITETURA.** `running`/`completed`/`cancelled` = conjunto vazio →
`409 CAMPAIGN_NOT_EDITABLE`. Campo fora da lista permitida no estado atual →
`409 FIELD_NOT_EDITABLE_IN_STATE` (um `details[]` por campo recusado).
Reedição de `audience` recalcula do zero só os alvos `pending` (mantém
histórico `sent`/`failed`/`skipped` intocado) — `DELETE`/`INSERT` em lote,
nunca um lead a um lead. **Simplificação registrada, não escondida:**
reagendamento fino de `scheduledFor` fora da janela nova (mencionado na
ARQUITETURA) não foi implementado — só importa para o `dispatch-tick`
(Fase 4.F, não existe ainda); o disparo manual não olha janela por
`scheduledFor`, só o guard (`evaluateSendGuard`) a cada envio.

**Disparo manual (`sendCampaignTargetMessage`) — a peça que mexeu em
`messages.ts`.** Em vez de criar um 2º caminho de guard/rede (proibido pela
ARQUITETURA), estendi `sendLeadMessage` com um 4º parâmetro OPCIONAL
`campaignContext?: CampaignSendContext` (`{targetId, campaignId,
allowedInstanceIds}`, tipo exportado de `messages.ts`). Quando presente:
- `Message.campaignTargetId` é gravado na criação (write-ahead) — antes
  ficava sempre `null` para envio de campanha, quebrando a rastreabilidade
  webhook→alvo.
- Sucesso: `advanceCampaignTargetStatus(tx, targetId, 'sent', {sentAt})` +
  `CampaignInstance.sentCount: {increment:1}`, na MESMA transação 2a.
- Falha confirmada / incerto: o mesmo por `'failed'` + `CampaignInstance.
  failedCount` (ARQUITETURA A25/§6.8.6: incerto NUNCA é retentado, conta
  como falha no funil de campanha também).
- `SEND_WINDOW_EXPIRED` (decisão expirou antes de `sendText`): `Message.
  campaignTargetId` é **desvinculado** (`null`) no `revertExpiredReservation`
  — sem isso, um retry do MESMO alvo estouraria a constraint única
  (`Message.campaignTargetId @unique`), porque o alvo continua `pending` mas
  já teria uma `Message` morta presa a ele.
- `resolveInstanceForSend` ganhou `allowedInstanceIds?` — restringe a
  resolução automática (sem `instanceId` no corpo) ÀS instâncias da
  campanha; se o operador pedir uma instância explícita fora da lista →
  `409 INSTANCE_NOT_IN_CAMPAIGN`.
- Texto vem do `renderedTemplateSnapshot` CONGELADO (nunca do
  `MessageTemplate` vivo), semente do spintax = `target.id` (ARQUITETURA
  §6.4: "mesmo alvo, em retry, recebe o mesmo texto").
- **Nenhum laço automático** — a rota só processa UM alvo por chamada; o
  motor (`dispatch-tick.job`) é a Fase 4.F.
- Rejeições de estado (`CAMPAIGN_NOT_RUNNING`, `TARGET_NOT_PENDING`) são
  novas — não estavam na tabela §4.5.10 (que cobria só as ações de ciclo de
  vida, não o disparo manual, que não existia até esta rodada).

**Testes (`campaigns.test.ts`, 11 novos — total do monorepo 369 no `web`,
546 no total das rodadas anteriores + este):** fake de Prisma dedicado
(mesmo padrão de `messages.test.ts`) + `advanceCampaignTargetStatus` REAL
(não mockado) + `sendLeadMessage` MOCKADO no teste de disparo manual —
decisão deliberada e documentada no cabeçalho do arquivo: o comportamento do
PORTÃO (pace lock incluso) já está provado em `messages.test.ts` (30 testes);
`campaigns.test.ts` prova a FIAÇÃO (delega para o mesmo portão,
`allowedInstanceIds` corretos, rejeição propaga sem tocar o alvo, nunca
chama `sendLeadMessage` se o estado já bloqueia). Cobre os 4 cenários
pedidos: materialização com os 6 motivos, `start` reavaliando opt-out
(incluindo o caso de rollback quando zera tudo), recusa de PATCH com
campanha `running` (+ aceite seletivo em `paused`), e o disparo manual.

**Gotcha de teste (documentado para não repetir):** `campaigns.ts` importa
`@/lib/api-handler`, que importa `./auth` → `next-auth` → `next/server`
(quebra em Vitest puro, mesma causa de
[[bug-nextauth-vitest-server-import]]). Correção: `vi.mock('@/lib/api-
handler', () => apiHandlerMockFactory())` (`@/test/api-handler-mock.ts`, já
existia, usado por `messages.test.ts` — só precisei importar, não criar
nada novo).

**Não pude validar:** nada disto rodou contra Postgres real (mesma
limitação de sempre, sem Postgres nesta máquina) — `pnpm typecheck`/`lint`/
`test` (`web`: 369, `core`: 175, `contracts`: limpo) passaram limpos, mas o
comportamento sob concorrência real (duas requisições de PATCH de audiência
simultâneas, corrida em `campaignTarget.createMany`/`deleteMany`) não foi
exercitado. `POST /campaigns/preview` não existe — Lyra cobre client-side,
Atlas/Nova decidem se vale a pena um endpoint de verdade depois.

Relacionado: [[convention-cadencia-ligada-envio-manual]] (o mesmo padrão de
"reusar `sendLeadMessage`, nunca duplicar o guard", agora estendido a
campanha), [[convention-envio-unitario-send-guard]], [[project-innoprospect]].
