---
name: bug-rsc-client-icon-props
description: Build quebra ao passar um componente (ex. ícone lucide-react) como prop de Server Component para Client Component
metadata:
  type: feedback
---

**Regra:** nunca passe uma referência de componente/função (ex.: `icon: LucideIcon`, `Icon` de
`lucide-react`) como prop de um Server Component para um Client Component. Só JSX já renderizado
(`<Icon />`) ou dados serializáveis (string, número, objeto plano) podem cruzar essa fronteira.

**Por quê:** aconteceu no shell do dashboard do InnoProspect (`components/shell/sidebar.tsx`
importava `NAV_ITEMS` — objetos com `icon: LucideIcon` — e passava `item` inteiro pra
`<NavLink item={item} />`, um Client Component). `next build` falhou no prerender de `/buscas` com
`Error: Functions cannot be passed directly to Client Components...`, apontando um objeto com
`render: function` (a forma interna de um ícone `forwardRef` do lucide-react). O erro só aparece no
`next build` (prerender), não no `next dev`/typecheck — fácil de passar despercebido.

**Como aplicar:** sempre que um componente de navegação/menu misturar ícones vindos de um array de
dados (`NAV_ITEMS`, `TABS`, etc.) com um subcomponente interativo (Link ativo, estado, onClick), marcar
o componente PAI que itera esse array como `'use client'` também — assim ícone e array inteiro ficam
do lado client, sem cruzar a fronteira. Alternativa: resolver o ícone pra JSX (`<item.icon />`) ainda
no Server Component antes de passar adiante — mas marcar o pai como client é mais simples e é o que
fiz em `sidebar.tsx`. Rodar `pnpm build` (não só `dev`/`typecheck`) antes de reportar como concluído
pega esse tipo de erro — `dev` e `tsc` não o revelam.
