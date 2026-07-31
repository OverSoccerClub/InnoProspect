---
name: convention-mock-api-layer
description: Padrão usado no InnoProspect para consumir uma API que ainda não existe (mock local trocável por 1 flag)
metadata:
  type: project
---

Quando as rotas reais de `/api/v1/*` ainda não existem (Vega implementando em paralelo), uso este
padrão em vez de MSW:

1. `apps/web/src/lib/config.ts` exporta `USE_MOCKS` (lido de `NEXT_PUBLIC_USE_MOCKS`, default `true`
   enquanto a API não existir).
2. `apps/web/src/mocks/*.ts` guarda os dados e a lógica de fixture (determinística, com
   `mulberry32` como gerador seedado — mocks estáveis entre reloads, não `Math.random()` puro).
3. `apps/web/src/lib/api/*.ts` (um arquivo por domínio: `locations.ts`, `searches.ts`, `leads.ts`) é o
   único lugar que decide mock vs. real: `if (USE_MOCKS) return mockX(...); return apiGet(...)`.
   Componentes **nunca** importam de `mocks/` diretamente, só de `lib/api/*`.
4. `apps/web/src/lib/fetcher.ts` é o client HTTP tipado que entende o envelope de erro padrão
   (`ApiRequestError` com `.code`, `.details`, `.requestId` — ver ARQUITETURA.md §4.0).

**Por quê:** troca mock→real vira uma linha só (`NEXT_PUBLIC_USE_MOCKS=false`), sem tocar em nenhum
componente — Atlas/Vega pediram exatamente isso no handoff da Fase 1.

**Como aplicar:** ao entregar uma tela nova que dependa de um endpoint que ainda não existe, repetir
esse padrão (mock fixture + módulo `lib/api/<domínio>.ts`) em vez de MSW ou de chamar `fetch` direto
no componente. Simular latência com `mockDelay()` pra forçar os estados de loading a aparecerem de
verdade durante o desenvolvimento.

Componentes de UI: não usei o CLI do shadcn/ui (não tem acesso interativo ao registry aqui) — recriei
os primitivos à mão em `apps/web/src/components/ui/` seguindo a convenção shadcn (cva + `cn()` de
`clsx`+`tailwind-merge`, Radix só onde compensa: `Dialog`, `Label`, `Slot`). Pra `Select` e `Checkbox`
usei elementos nativos estilizados de propósito, não Radix — mais acessível/robusto de fábrica em
listas longas (até ~600 municípios) e evita dependência extra sem ganho real nesse caso.
