---
name: bug-dois-parsers-spintax-divergentes
description: Web tinha seu próprio tokenizer de spintax duplicando @inno/core — nesting falso-positivo em `{a|b {{nome}}}` e preview podia divergir do envio real. Fundido em cima do core.
metadata:
  type: project
---

**Causa raiz:** `apps/web/src/lib/spintax.ts` reimplementava sua PRÓPRIA
varredura de chaves `{`/`}` (função `tokenize`) em vez de usar
`@inno/core#parseSpintax`/`resolveSpintax` (a engine real, usada por
`lib/services/templates.ts` e `messages.ts`/`sendLeadMessage`). O tokenizer do
web fazia `body.indexOf('}', i+1)` — parava na PRIMEIRA `}` que encontrasse,
inclusive a primeira das duas de um `{{variável}}`. Resultado: `{Sucesso!|Sucesso
para a {{nome}}!}` (spintax com uma variável dentro de uma opção — caso
totalmente válido e aceito pelo motor de envio) era recusado como "aninhado" na
tela, E o preview reconstruía as opções TRUNCADAS (`options` cortadas na `}` de
`{{`, resto sobrando como texto literal) — ou seja, o preview podia mostrar um
texto diferente do que o envio real produziria. Duas implementações do mesmo
parser sempre voltam a divergir no primeiro ajuste (mesma lição de
[[convention-reconciliacao-status-instancia]] e das 3 cópias de `todayDateKey`
em [[convention-send-policy-local-date-key-fase4f2]]) — a correção nunca é
"consertar as duas pra concordarem hoje", é ter uma engine só.

**Correção:** `apps/web/src/lib/spintax.ts` agora é só camada de apresentação
sobre `@inno/core`:
- `checkSpintaxSyntax` → chama `parseSpintax` do core e traduz o `code`
  (`NESTED_SPINTAX`/`UNCLOSED_BRACE`/`UNEXPECTED_CLOSING_BRACE`/`EMPTY_OPTION`)
  para uma frase em PT-BR amigável — a REGRA vem do core, só a REDAÇÃO é local.
  `EMPTY_OPTION` é checagem NOVA que o web nunca tinha (`{a||b}`), ganho de
  bônus da fusão.
- `hasSpintax`/`countVariations`/`extractKnownVariables` → wrappers finos sobre
  `coreHasSpintax`/`countSpintaxVariations`/`coreExtractKnownVariables`.
- `findUnknownVariables`/`extractVariables` → via `validateTemplateVariables`/
  `extractVariableTokens` do core.
- `renderSample(s)`/`renderWithSeed` → agora chamam literalmente
  `renderTemplate` → `resolveSpintax` (mesma ordem e funções que
  `lib/services/messages.ts` usa pro envio real) em vez de resolver
  variável+spintax num tokenizer próprio. Isso é o que garante "preview ==
  envio", não só "preview aceita o mesmo que o envio aceitaria".
- `KNOWN_VARIABLES` deixou de ser uma lista própria e passou a ser
  `TEMPLATE_ALLOWED_VARIABLES` (`@inno/contracts`) — mais uma fonte única
  eliminada (não era o bug relatado, mas era a mesma classe de risco).

**Armadilha ao fundir (não repita):** `resolveSpintax` do core **lança**
`SpintaxSyntaxError` em sintaxe inválida — correto para o envio real (nunca
deveria receber um template inválido, já bloqueado na criação). Mas o preview
local (`TemplatePreview`) roda a CADA TECLA, inclusive com o corpo num estado
intermediário normal de digitação (`{opção a` sem fechar ainda). Chamar
`resolveSpintax` direto ali quebraria a tela com exceção não tratada no meio
de uma digitação normal — regressão que eu mesmo introduzi na primeira versão
da fusão e só peguei porque escrevi o teste
`'nunca lança durante um estado intermediário de digitação'` antes de fechar.
Corrigido com `resolveSpintaxForPreview` (`apps/web/src/lib/spintax.ts`): tenta
`resolveSpintax`, em `SpintaxSyntaxError` cai pro texto com variáveis já
substituídas mas sem sortear a variação (nunca lança, nunca esconde erro real
de quem chama `checkSpintaxSyntax` na validação de verdade).

**Gap encontrado, NÃO corrigido (fora do escopo desta rodada, avisado ao
Atlas):** `{{variável` sem fechamento (`}}` faltando) não é erro para
`@inno/core` nem antes nem depois desta fusão — `parseSpintax`/`renderTemplate`
tratam como bloco opaco/token que não casa e deixam a chave crua vazar pro
texto final. O web sempre teve (e continua tendo, só em `checkSpintaxSyntax`,
função `findUnclosedVariableBrace`) uma checagem própria pra isso — INTENCIONAL,
mas assimétrica: a TELA bloqueia salvar algo que o SERVIDOR aceitaria. Não é o
mesmo bug (não há divergência de preview vs. envio, é a tela sendo mais
estrita), mas é a mesma classe de risco achada aqui. Se algum dia alguém
mandar `{{nome` sem fechar por fora da tela (import em massa, migração,
seed), o servidor aceita e o texto quebrado vai pro WhatsApp de verdade.
