---
name: convention-altezza-record-primitives
description: Os 4 primitivos "estilo Altezza" (RecordHeader, LabeledField, TabsWithCount, PendingBand) criados em 2026-09-24 — o que cada um resolve, onde já foram aplicados, e por que StatusPill não é um 5º componente novo
metadata:
  type: convention
---

**Pedido do dono (2026-09-24):** duas telas de referência de um CRM
(Altezza Travel) com a instrução "quero nesse estilo, mantendo a nossa
paleta, mas PREMIUM". Extraí 5 padrões concretos e criei 4 primitivos em
`components/common/*` — reusar antes de recriar em qualquer tela nova.

**1. `record-header.tsx` — cabeçalho de registro em colunas rotuladas**
(rótulo pequeno maiúsculo + valor destacado embaixo, várias colunas no
espaço de uma pilha de linhas). Deliberadamente "burro": recebe
`fields: { key, label, value: ReactNode }[]` e não decide cor nenhuma —
`value` é onde compor um badge (`LeadStatusBadge`) quando o campo for um
status, a cor mora sempre no componente de origem. Isso significa ZERO token
de cor novo (só reusa `text-muted-foreground`/`text-foreground`, já
verificados em DESIGN-SYSTEM.md §7) — nenhum contraste para recalcular.
Layout: grid 2 colunas no mobile, `flex flex-wrap` com divisórias
`border-l` no desktop — o `flex-wrap` é obrigatório (mesmo raciocínio de
[[bug-card-header-kebab-overflow-mobile]]: várias colunas de largura
variável sem wrap estoura a página, não só encolhe).

**2. `labeled-field.tsx` — ícone + rótulo + valor**, formaliza o `InfoRow`
que `lead-detail.tsx` já tinha copiado à mão. Ícone sempre neutro
(`text-muted-foreground`), nunca herda cor de status.

**3. `tabs-with-count.tsx` — abas com contador no rótulo**
(`Municípios 12 · Com falha 2`). Feito à mão (roving tabindex, ARIA
role=tablist/tab/tabpanel completo — setas/Home/End), NÃO Radix: diferente
do `DropdownMenu` (portal + foco preso + Popper), abas simples não pagam o
custo de uma dependência nova — mesma régua de "Radix só onde compensa" já
em uso. Pílula de contagem usa só os 2 pares JÁ verificados (`primary`/
`primary-foreground` sólido na aba ativa, `secondary`/`secondary-foreground`
na inativa) — nunca texto colorido sobre fundo tintado (armadilha de
[[feedback-dual-role-color-tokens]]).

**4. `pending-band.tsx` — faixa de pendências ACIONÁVEL** (`1302 Arrival ·
809 Transfer`, cada um com um botão). Regra dura: só renderiza itens com
`count > 0` — nunca mostrar "0 pendências" como se fosse fila real; quando
não há nenhuma, mostra uma linha calma de confirmação (nunca desaparece em
silêncio, nem um card cheio — versão discreta do "sem estado morto" de
[[feedback_dono_quer_premium_de_verdade]]). Cor só no ÍCONE (piso 3:1),
nunca no número. Bug pego ANTES de entregar (nunca chegou a existir em
produção): item `flex-1` sem `min-w-0` explícito — mesma causa raiz de
[[bug-table-overflow-flex-min-width]], corrigido preventivamente comparando
com o padrão já documentado, sem precisar de screenshot pra achar.

**Onde já foram aplicados (2026-09-24):**
- `/leads` (lista): `PendingBand` com 2 sinais REAIS do próprio domínio —
  "sem telefone" (`hasPhone:false`) e "fora do nicho" (`offNiche:true`),
  contagem via `hooks/useLeadPendingSignals.ts` (chama `listLeads` com
  `pageSize: LEAD_PAGE_SIZES[0]` só para ler `.total` — sempre o total real
  do filtro, nunca estimado da página carregada, e sempre INDEPENDENTE do
  filtro que o operador tem aplicado na tela, que é outra coisa). Ação de
  cada item chama `setFilters` com o MESMO atalho que o painel avançado já
  usa — nunca um 3º caminho de filtro.
- `/leads/[id]` (ficha): `RecordHeader` (Status/Telefone/Avaliação/Origem/
  Última atividade) substituiu 4 lugares espalhados da informação. Efeito
  colateral bom: como Telefone/Avaliação saíram do card "Contato" (viraram
  campo do header, evitando duplicar a MESMA informação duas vezes na
  tela), e a Linha do tempo passou a EXCLUIR `message_sent`/
  `message_received`/`message_failed` (já aparecem, muito mais ricos, no
  card Conversa abaixo — mostrar os dois era duplicação real, achada nesta
  rodada, não hipotética).
- `/buscas` (lista): `PendingBand` com 1 sinal — "buscas que falharam"
  (`status:'failed'` no NÍVEL DO JOB, ou seja o job crashou — não confundir
  com `completed_partial`/`completed_empty`, que é "terminou mas o
  resultado foi ruim", ver [[convention-derive-outcome-from-progress-not-status]]).
  Contagem via `hooks/useSearchJobPendingSignals.ts#listSearchJobs({status:'failed'})`,
  lê `res.page.total`. Deliberadamente NÃO tentei somar `completed_partial`/
  `completed_empty` ao sinal — isso exigiria paginar todo o histórico de
  buscas concluídas para derivar o outcome de cada uma client-side, custo
  desproporcional pra esta rodada.
- `/buscas/[id]` (detalhe): `RecordHeader` (Status/Nicho/UF/Progresso/Leads
  encontrados/Leads novos/Criada em) substituiu o `Stat` que o componente
  tinha à mão. `TabsWithCount` com "Municípios"/"Com falha" — a MESMA lista
  de tasks, filtrada client-side, não um 2º endpoint (zero dado novo pedido
  ao Vega).

**`StatusPill` NÃO é um 5º componente novo** — `components/ui/badge.tsx`
(`cva` com variantes `default/secondary/success/warning/destructive/
outline`) já é exatamente isso, usado consistentemente por
`LeadStatusBadge`/`InstanceHealthBadge`/`SearchJobStatusBadge`/
`SearchTaskStatusBadge`/`CampaignStatusBadge` — criar um wrapper novo só
duplicaria a mesma lógica. "Pílulas consistentes" já era verdade antes
desta rodada; o que faltava era header em coluna, abas com contador, e a
fila de pendências acionável.

**Fora desta rodada, motivo real (não falta de tempo só):** Campanhas e
Painel (Visão geral) ficaram sem os primitivos aplicados. Painel: os 3
sinais cross-domínio que fariam sentido numa `PendingBand` ali
(instâncias desconectadas, campanhas paradas, leads sem telefone/fora do
nicho de TODO o sistema) exigiriam ou um novo campo agregado no contrato de
`dashboard.contract.ts` (território do Vega) ou múltiplas chamadas
cross-domínio no client — decisão de arquitetura que não tomei sozinha.
Campanhas: a lista já tem `CampaignStatusBadge`/`CampaignTargetStatusBadge`
prontos (ver [[project_campaign_screens_fase_4e]]), mas o candidato natural
de pendência ("campanhas paradas") depende de `campaign.contract.ts#halted`
que ainda não tem nenhuma tela de ação associada além do badge — aplicar
`PendingBand` ali sem uma ação real por trás seria voltar a "KPI
decorativo", o que o dono pediu explicitamente para evitar.
