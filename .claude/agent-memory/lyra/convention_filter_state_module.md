---
name: convention-filter-state-module
description: Padrão para telas de lista com muitos filtros (>6) — módulo puro de estado (fora do componente), painel "Mais filtros" em `<details>`, chips de filtro ativo removíveis, e atalhos como preset de campos existentes. Reusar quando outra lista (campanhas, templates) crescer de filtros.
metadata:
  type: feedback
---

**Regra:** quando uma barra de filtros crescer além de ~6 controles (caso
real: `/leads` foi de 6 pra 13 filtros possíveis num único pedido —
`hasWebsite`/`hasPhone`/`phoneType`/`minRating`/`category`/`tags`/
`createdFrom`/`createdTo`, todos já aceitos pelo `leadFilterSchema` mas nunca
expostos), separar em 3 peças reusáveis:

1. **Módulo puro fora do componente** (`lib/lead-filter-state.ts`, sem
   `'use client'`, testável sem React — mesmo padrão de `lib/pagination.ts`):
   guarda o tipo do estado da UI, o estado vazio, `toApiLeadFilter` (traduz
   estado da UI pro formato que a API espera), `hasAnyLeadFilter`,
   `countAdvancedLeadFilters` (conta só os campos do painel avançado, pro
   badge do gatilho), `describeActiveLeadFilters` (gera os chips — aceita
   lookups OPCIONAIS pra rótulo bonito, ex. nome da cidade em vez do código
   IBGE, sem quebrar se não vierem) e `removeLeadFilterChip` (remove só o que
   aquele chip representa, sabendo que `uf` limpa `cityIbgeCode` porque
   depende dela). Ver `lib/lead-filter-state.test.ts` — 21 testes cobrindo os
   4 primeiros; o componente só faz UI por cima.
2. **Painel "Mais filtros" em `<details>` nativo**, não Popover/Dialog novo —
   reaproveita o padrão já existente em `components/searches/new-search-form.tsx`
   ("Opções avançadas": `<summary>` com `ChevronRight` que gira via
   `group-open:rotate-90`). Evita de propósito introduzir Radix Popover só
   pra isso — sem z-index/overlap pra gerenciar (ver
   [[bug-layered-card-absolute-overlap]]), acessível de fábrica (Enter/Espaço
   nativos), e empurra o conteúdo no fluxo em vez de flutuar por cima.
3. **Linha de chips de filtro ativo, sempre visível, com botão de remover em
   cada um** — não só um "Limpar tudo" condicional. Com 13 filtros possíveis
   e a maioria escondida atrás do painel avançado, "por que essa lista está
   vazia?" fica sem resposta na tela se só existir um booleano
   `hasActiveFilters`. Os chips resolvem isso mostrando exatamente QUAL
   filtro está ativo e onde ele mora (mesmo que escondido no painel
   recolhido), com um X que chama `removeLeadFilterChip` direto — nunca
   precisa abrir o painel pra saber ou pra tirar um filtro esquecido.

**Atalhos (2 no máximo) são preset de campos que já existem**, não um 3º
sistema de filtro: `isActive`/`apply`/`clear` comparam/escrevem os mesmos
campos do estado (ex. "Sem site" = `hasWebsite:'false'`; "Pronto para
WhatsApp" = `hasPhone:'true'` + `phoneType:'mobile'`, porque enviar mensagem
exige telefone móvel — ver checagem em `mocks/leads.ts`/`lib/services/
messages.ts`). Isso significa que marcar o mesmo valor pelo painel avançado
também deixa o atalho "pressionado" — os dois caminhos nunca divergem sobre o
que está ativo.

**Debounce: só campos de texto livre** (`q`, e agora `category`/`tags` em
texto separado por vírgula), nunca o objeto inteiro do estado. Debounciar o
estado inteiro (tentei primeiro, corrigi antes de entregar) atrasa em 300ms
até um clique em `<select>`/pill de status — regressão de responsividade que
não existia antes da rodada com poucos filtros.

**Categoria/tags como texto livre (não multi-select com lista conhecida):**
não existe endpoint de "categorias/tags distintas" (`LeadFacets` só tem
`byStatus`) — inventar um agora seria contrato novo, território do Vega. Ver
PENDÊNCIAS do handoff de 2026-09-23 (falta filtro de nº de avaliações, mesma
lógica: exige contrato novo, não implementado por mim).

**Como aplicar:** próxima lista que crescer de filtros (candidatura óbvia:
`/campanhas` quando a Fase 4 chegar, já que reaproveita o mesmo
`leadFilterSchema` pra `audience.filter`) — copiar a separação em 3 peças, não
o código; o módulo puro pode até generalizar pra um `createFilterStateModule`
genérico se aparecer um 3º caso igual.
