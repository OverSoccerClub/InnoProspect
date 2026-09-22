---
name: bug-mock-get-returns-live-reference
description: Mock GET que devolve a referência viva (não uma cópia) faz o React duplicar dado quando um POST mutável (envio de mensagem) altera o mesmo objeto por baixo do estado
metadata:
  type: feedback
---

**O que aconteceu (envio de mensagem na ficha do lead, 2026-09-22):** o mock
`mockGetLead(id)` fazia `getLeads().find(l => l.id === id)` e devolvia a
referência direta ao objeto guardado no array do módulo. `setLead(await
getLead(id))` no componente guardava essa MESMA referência no estado do
React. Quando o envio de mensagem (`mockSendLeadMessage`) mutava
`lead.messages = [...lead.messages, novaMsg]` nesse objeto (para persistir,
correto), o array já mutado por baixo passou a refletir no `current.messages`
que o componente lia em `handleMessageSent`. Como o componente TAMBÉM fazia
`[...current.messages, response.message]`, a mensagem aparecia duplicada na
timeline — só visível numa captura de tela real, não em teste unitário.

**Causa raiz:** um mock que serve tanto de "banco de dados" (precisa
persistir mutação) quanto de "resposta HTTP" (precisa desacoplar o chamador
do armazenamento) não pode devolver o mesmo objeto para os dois papéis. Uma
API real nunca tem esse problema — JSON sempre cria uma cópia. Um mock que
devolve a referência viva finge essa garantia e quebra silenciosamente assim
que dois fluxos (GET inicial + POST que muta) tocam o mesmo registro.

**Como aplicar em mocks futuros neste projeto:** toda função `mockGetX`
"pública" (a que simula a resposta HTTP) deve devolver uma cópia rasa
(`{ ...record, arrayField: [...record.arrayField] }`), nunca a referência do
array interno. Se uma função de escrita (`mockSendX`, `mockCreateX`) precisa
mutar o registro persistente, crie um getter interno separado
(`getXRecord`) que devolve a referência viva, só usado por quem precisa
gravar — nunca exportado. Ver `apps/web/src/mocks/leads.ts`
(`getLeadRecord` vs. `mockGetLead`) como referência do padrão.
