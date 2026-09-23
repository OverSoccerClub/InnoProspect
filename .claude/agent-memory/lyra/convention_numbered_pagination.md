---
name: convention-numbered-pagination
description: Componente e matemática pura para paginação numerada (página + registros por página) — reusar em vez de recriar quando outra lista migrar de cursor
metadata:
  type: feedback
---

**Regra:** quando uma lista precisar de paginação numerada + seletor de
"quantos por página" (não "carregar mais" por cursor), reusar:

- `apps/web/src/lib/pagination.ts` — matemática pura, testada
  (`pagination.test.ts`): `computeTotalPages`, `clampPage` (a última página
  válida quando um filtro reduz o resultado — nunca deixa a UI pedir uma
  página que não existe mais), `buildPageWindow` (janela de números com
  `'ellipsis'` nos saltos), `pageItemRange` (texto "Mostrando 26–50 de 180"),
  `normalizePageSize`.
- `apps/web/src/components/common/pagination.tsx` — o componente `<Pagination>`
  genérico (não é `LeadPagination`): recebe `page/totalPages/pageSize/
  pageSizeOptions/total` + callbacks, e mostra o seletor de tamanho de página
  MESMO quando `totalPages <= 1` (não esconder o controle só porque cabe tudo
  numa página — o usuário quer poder mudar o tamanho de qualquer forma).

**Por quê:** criado na tela de Leads (2026-09-23, pedido do dono: página
numerada + registros por página, substituindo "carregar mais"). O tamanho de
página (`25|50|100`) é um enum fechado que vem de `@inno/contracts`
(`LEAD_PAGE_SIZES`/`LeadPageSize`) — não duplicar esse array numa constante
local nova; se outra lista migrar para página numerada e precisar de outro
conjunto de tamanhos, o componente já aceita `pageSizeOptions` como prop.

**Como aplicar:** antes de escrever paginação numerada do zero numa lista
nova, importar estes dois primeiros. Padrão de UX que foi junto (também
reusável): manter a última página/lista visível, esmaecida
(`opacity-60 pointer-events-none`, `aria-busy`), enquanto uma nova página
carrega — só mostrar o esqueleto cheio na primeira carga da tela
(`hasLoadedOnce = response !== null`). Sem isso, cada clique em "próxima
página" apagava a tabela inteira por um instante, mesmo a busca sendo rápida.
