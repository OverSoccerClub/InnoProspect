---
name: convention-error-envelope-details-vs-meta
description: No InnoProspect, dado estruturado de erro de regra de negócio (resetsAt, nextWindowOpensAt, optedOutAt) viaja em details[] (path=chave semântica, message=valor cru), não num campo meta separado
metadata:
  type: project
---

**O que aconteceu (envio de mensagem, 2026-09-22):** ARQUITETURA §4.9.7 diz
que erros como `DAILY_LIMIT_REACHED`/`QUIET_HOURS`/`OPTED_OUT` "incluem meta
útil em `details[]`" — frase ambígua. Modelei como campo `meta` separado no
envelope de erro (`ApiRequestError.meta`), assumindo que `details[]` era só
para erro de campo (validação), já que o próprio §4.0 diz isso. Quando o
Vega terminou a rota real (`lib/services/messages.ts#throwForBlockedVerdict`),
confirmei que **não existe campo `meta`** — o valor real (`resetsAt` etc.)
vai dentro de `details: [{ path: 'resetsAt', message: '<ISO>' }]`,
reaproveitando a mesma forma `{path, message}` só que com `path` sendo uma
chave semântica em vez de nome de campo de formulário.

**Por quê:** o envelope de erro (`packages/contracts/src/common.ts`,
`apiErrorSchema`) só tem `code`/`reason`/`message`/`details`/`requestId` —
aditivo desde sempre, sem `meta`. `details[]` é reaproveitado para dois usos
diferentes (erro de campo E dado pontual de regra de negócio); o campo
`path` é quem diferencia a intenção, não a presença de um campo novo.

**Como aplicar:** ao ler um erro de regra de negócio que carregue dado
estruturado (data de reset, próxima janela, quando foi o opt-out), procurar
em `err.details?.find(d => d.path === '<chave>')?.message` — nunca inventar
`err.meta`. Ver `apps/web/src/components/leads/message-composer.tsx`
(`findDetail`) e `apps/web/src/mocks/leads.ts` (`mockConflict` com
`details`) como referência. [[bug-mock-get-returns-live-reference]]
