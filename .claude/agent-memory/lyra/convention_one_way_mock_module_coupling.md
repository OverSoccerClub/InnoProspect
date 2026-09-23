---
name: convention-one-way-mock-module-coupling
description: Como dois módulos mocks/*.ts que precisam saber um do outro (ex. instâncias WhatsApp x servidores Evolution) evitam import circular
metadata:
  type: project
---

Quando um mock precisa refletir estado de ENTIDADE RELACIONADA que mora em
outro arquivo de `mocks/*.ts` (ex.: `mocks/whatsapp.ts` precisa validar/contar
`evolutionServerId` contra `mocks/evolution-servers.ts`), a dependência tem
que ser DELIBERADAMENTE de mão única: o módulo "dependente" (aqui,
`whatsapp.ts`, que referencia um servidor por id) importa funções do módulo
"independente" (`evolution-servers.ts`), nunca o contrário.

`evolution-servers.ts` expõe só o necessário para isso:
- `mockRequireActiveEvolutionServer(id)` — espelha a checagem real do
  backend (404 se não existir, 409 `SERVER_INACTIVE` se desativado) antes de
  aceitar a referência.
- `mockNoteInstanceCreatedOnServer(id)` / `mockNoteInstanceRemovedFromServer(id)`
  — mutadores estreitos que só incrementam/decrementam um contador; o estado
  em si (`instancesCount`) nunca é lido/escrito diretamente por
  `whatsapp.ts`.

**Por quê:** a alternativa óbvia (cada módulo importar funções do outro para
recalcular contagens dos dois lados) cria um ciclo de import ESM entre dois
arquivos com estado mutável em módulo (`let servers/instances = null`) — em
teoria os ciclos funcionam se o uso só acontece dentro de corpos de função
(nunca no top-level), mas não vale o risco de depender de ordem de
inicialização em bundlers diferentes (webpack dev vs. Vitest) só para não
escrever 4 linhas de mutador estreito.

**Como aplicar:** ao adicionar um 3º mock relacionado (ex.: campanhas
referenciando instâncias), decidir ANTES qual módulo é "independente" (dono
do estado consultado) e qual é "dependente" (só referencia por id) — o
dependente importa, o independente nunca importa de volta. Ver
`apps/web/src/mocks/evolution-servers.ts` (independente) e
`apps/web/src/mocks/whatsapp.ts` (dependente, chama
`mockRequireActiveEvolutionServer`/`mockNoteInstanceCreatedOnServer`/
`mockNoteInstanceRemovedFromServer` nos pontos de criação/exclusão).
