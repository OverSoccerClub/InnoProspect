---
name: project-campaign-screens-fase-4e
description: Decisões da Fase 4.E (telas de campanha) — prévia de público sem endpoint de dry-run, resumo de criação via sessionStorage, disparo manual por alvo (sem motor)
metadata:
  type: project
---

Construí `/campanhas`, `/campanhas/nova` e `/campanhas/[id]` contra
`packages/contracts/src/campaign.contract.ts` (não a prosa do ARQUITETURA.md
— ver [[convention_contract_ts_over_arquitetura_prose]]). Três decisões que
valem re-explicar se a próxima rodada tocar campanhas:

**1. Prévia de audiência sem `POST /campaigns/preview` (não existe no
contrato).** O requisito do dono ("800 → 430, ver o corte ANTES de criar")
foi resolvido com `lib/campaign-audience.ts` (puro, testável) chamado
client-side contra os leads já carregados — `lib/api/campaigns.ts#
previewCampaignAudience()` devolve `null` fora de `USE_MOCKS` (não tem como
funcionar sem endpoint real), e a UI trata `null` como "prévia indisponível
aqui", nunca como erro. `alreadyTargeted` (6º motivo de exclusão) só é
calculado de verdade dentro do mock (`mocks/campaigns.ts#
excludeAlreadyTargeted`), porque depende de conhecer as outras campanhas —
a função pura NUNCA sabe disso, sempre devolve 0 nesse campo.

**2. `CampaignDetail`/`CampaignSummary` NUNCA re-expõem `audience.excluded`**
depois da criação — esse bloco só existe na resposta `201` de `POST
/campaigns`. Resolvido com `lib/campaign-creation-cache.ts`: a resposta da
criação é salva no `sessionStorage` (client-side, não é contrato de
backend) e lida UMA vez na página de detalhe, mostrando um card "Resumo da
criação" dispensável. Se um dia `GET /campaigns/:id` passar a devolver
`audience`, este cache fica redundante mas não quebra nada (é
best-effort).

**3. Disparo é MANUAL, alvo a alvo.** `POST /campaigns/:id/targets/:id/send`
(publicado pelo Vega no meio desta rodada, junto com `alreadyTargeted`) é o
único jeito de uma campanha `running` sair da fila — não existe motor
(Fase 4.F). `components/campaigns/campaign-targets-table.tsx` mostra um
botão "Enviar agora" por alvo `pending`, só quando `campaign.status ===
'running'`. A tela avisa isso em dois lugares: no formulário de criação
(antes do clique) e na página de detalhe quando há alvos pendentes numa
campanha rodando (para quem volta dias depois e esqueceu).

**Pendências conscientes (fora do escopo desta rodada):**
- `PATCH /campaigns/:id` existe no contrato (editar rascunho) — nenhuma tela
  consome. Precisaria de um form de edição reaproveitando os mesmos
  componentes da criação, pré-preenchido.
- `GET /campaigns/:id/targets` e `GET /campaigns` são cursor-based
  ("carregar mais"), não paginação numerada — diferente de `/leads`, que
  usa `page`/`pageSize`. Confirmado no próprio ARQUITETURA §4.5.7. Ver
  [[convention_check_contracts_before_mocking]].
