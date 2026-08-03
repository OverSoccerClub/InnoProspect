---
name: convention-check-contracts-before-mocking
description: Antes de escrever tipos locais em types/*.ts, checar se @inno/contracts já publicou o schema real — evita retrabalho e drift
metadata:
  type: feedback
---

**Regra:** antes de criar `types/<domínio>.ts` com `// TODO: trocar por import de @inno/contracts...`,
primeiro rodar `ls packages/contracts/src/` e checar se o `<domínio>.contract.ts` já existe. Se existir,
importar os tipos direto de `@inno/contracts` (é `"exports": {".":"./src/index.ts"}` — TS puro, sem
build step, resolve via workspace symlink) em vez de duplicar à mão.

**Por quê:** na entrega da Fase 3 (Templates/WhatsApp/Opt-outs/descadastro público, 2026-08-01), comecei
a escrever `types/template.ts`, `types/whatsapp.ts`, `types/optout.ts` do zero (mesmo padrão da Fase 1,
quando `packages/contracts` ainda era placeholder vazio). No meio do trabalho descobri, com `git status`,
que o Vega já tinha publicado `template.contract.ts`, `whatsapp.contract.ts` e `optout.contract.ts`
completos e **commitados** — só não tinha me avisado porque estávamos em paralelo. Os schemas batiam
quase 100% com o que eu já tinha escrito lendo o mesmo ARQUITETURA.md, então troquei os três arquivos
`types/*.ts` para reexportar de `@inno/contracts` (com alias de nome pra não precisar tocar em
`lib/api/*`/`mocks/*`/componentes já escritos contra os nomes antigos). Ganho real: elimina o risco de os
dois lados divergirem silenciosamente (ex.: `variablesUsed` no contrato é `TemplateVariable[]`, união
fechada — mais estrito que o `string[]` que eu tinha escrito à mão).

**Como aplicar:** no início de qualquer tarefa de Fase 2+ que envolva um domínio novo, rodar
`ls packages/contracts/src/*.contract.ts` e `git log --oneline -5 -- packages/contracts` ANTES de
declarar tipos locais. Se o contrato já existir: importar direto (com alias se precisar manter nomes
usados no resto do meu código). Se não existir: aí sim repetir o padrão descrito em
[[convention-mock-api-layer]] (tipo local + comentário TODO). Isso é diferente de "nunca escrever tipo
local" — quando o contrato realmente não existe ainda (rota em paralelo, não publicada), o tipo local
continua sendo a escolha certa.
