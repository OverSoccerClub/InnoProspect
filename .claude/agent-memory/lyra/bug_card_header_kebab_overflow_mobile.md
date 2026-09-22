---
name: bug-card-header-kebab-overflow-mobile
description: Adicionar um botão kebab/DropdownMenu ao lado de badges num CardHeader `flex-row justify-between` sem `flex-wrap` + `flex-1 min-w-0` no título estoura a página inteira em viewports estreitos (390px) — sintoma só aparece medindo, não lendo o CSS
metadata:
  type: feedback
---

**O que aconteceu (Onda 2B, 2026-09-22):** ao mover a ação destrutiva
"Excluir" de `InstanceCard` (WhatsApp) de um botão de texto vermelho solto
pra dentro de um `DropdownMenu` (kebab `MoreVertical`, regra herdada de
`[[bug-rsc-client-icon-props]]`/DropdownMenu), o cluster à direita do
`CardHeader` (badges de status + botão kebab) ganhou mais largura. Em
1440px estava perfeito; só ao medir em 390px (skill `medir-antes-de-afirmar`,
`document.documentElement.scrollWidth` vs `clientWidth`) apareceu que a
página inteira tinha estourado a viewport — o cluster direito era empurrado
pra fora da tela, badges e o próprio botão de excluir ficavam inacessíveis.

**Causa raiz:** `CardHeader` era `flex flex-row items-start justify-between`
(sem `flex-wrap`) com o título num `<div>` só com `min-w-0` (sem
`flex-1`) e o cluster de ações num `<div className="flex shrink-0 ...">`.
Sem `flex-1` explícito, o `flex-basis` do título continua `auto` — ele só
encolhe até seu min-content mesmo tendo `min-w-0` disponível, e como o
cluster é `shrink-0` (não pode encolher) a soma dos dois ultrapassa a
largura do card antes que o navegador force o título a truncar de verdade;
sem `flex-wrap` no pai, o excedente não quebra linha — ele estoura.

**Correção:** duas mudanças no mesmo `CardHeader`:
1. `flex-wrap` no container do header (deixa o cluster de ações cair pra
   uma segunda linha se não couber, em vez de estourar a página).
2. `flex-1` (além do `min-w-0` que já existia) no `<div>` do título — dá a
   ele prioridade de encolhimento real antes de cogitar quebrar linha.

**Como aplicar:** qualquer `CardHeader`/linha flex que combine um título
longo (truncado) com um cluster de ações `shrink-0` (badges, botões, ícone)
precisa das DUAS coisas juntas — `flex-1 min-w-0` no lado que trunca E
`flex-wrap` no pai — nunca só uma das duas. Medir sempre em ~390px depois
de adicionar qualquer botão/ícone novo a um header que já tinha badges,
mesmo que pareça "só mais um ícone pequeno". Ver
[[bug-table-overflow-flex-min-width]] pro mesmo princípio (`min-width`
default do flexbox) aplicado num nível de layout diferente (shell inteiro,
não um card).
