---
name: bug-lead-activity-type-spelling-mismatch
description: LeadActivity.type é texto livre no contrato — o backend real grava 'opt_out', a UI só reconhecia 'opted_out'; todo opt-out por resposta automática caía no fallback genérico da timeline em produção
metadata:
  type: project
---

**O que aconteceu (2026-09-23, redesenho da ficha de lead depois da 1ª
conversa real em produção):** `packages/contracts/src/lead.contract.ts`
tipa `LeadActivity.type` como `z.string()` solto, de propósito (comentário em
`lead-timeline.tsx` já dizia "o backend registra o tipo como texto livre").
Mas `lib/services/optouts.ts` e `lib/services/webhook.ts` (Vega) sempre
gravaram `type: 'opt_out'`, enquanto toda a UI (`LeadTimeline` ICON/LABEL,
`OptedOutBanner` lookup em `lead-detail.tsx`, `buildOptOutMessageIds` em
`lead-conversation.tsx`) só reconhecia `'opted_out'` — grafia que eu mesma
escolhi nos mocks/tipos desde a 1ª rodada, sem nunca confrontar contra o
código real do Vega. Resultado real: qualquer opt-out por resposta automática
em produção caía no fallback genérico da timeline (ícone neutro, texto cru
"opt_out"), e o `optedOutAt` do banner de opt-out nunca era encontrado.

**Por quê:** duas partes do time escolheram grafias diferentes para o MESMO
evento, e como o campo é `string` solto no contrato (não um enum), o
TypeScript nunca ia pegar essa divergência — só um bug real em produção (ou
ler o código do outro lado linha a linha) revela.

**Como aplicar:** nunca comparar `activity.type === 'opted_out'` direto —
usar `isOptOutActivity(type)` (`types/lead.ts`), que aceita as duas grafias.
Se aparecer outro campo de "texto livre por contrato" (mesmo padrão), o
reflexo correto é grep no código real do Vega (`lib/services/*.ts`) pela
string literal ANTES de fixar o valor esperado na UI — não assumir que o
nome mais "óbvio" é o que o outro lado escreveu. Ver
[[convention-check-contracts-before-mocking]] (mesma família de armadilha,
um nível abaixo do contrato).
