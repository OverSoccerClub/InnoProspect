---
name: bug-layered-card-absolute-overlap
description: Compor cards "flutuantes" em camadas (estilo Stripe) só com position absolute + offset negativo esconde a sobreposição real até uma screenshot de verdade — reservar o espaço no fluxo normal, não só empilhar por cima
metadata:
  type: feedback
---

**Achado (2026-09-22, mockup do hero da landing, `components/marketing/
product-mockup.tsx`):** a 1ª versão do card flutuante "Busca em andamento"
usava `absolute -left-4 -top-5` por cima da "janela" do app (tabela de
leads). Lendo o JSX parecia razoável — offset pequeno, visual "em camadas".
Só ao tirar screenshot de verdade (Playwright, skill
`medir-antes-de-afirmar`) ficou óbvio que o card cobria o cabeçalho inteiro
("Empresa/Status") da tabela por baixo: `position: absolute` não reserva
espaço nenhum no fluxo, então o "quanto" de sobreposição só se resolve
depois que os dois elementos têm altura real renderizada — impossível prever
com precisão só lendo classes Tailwind.

**Correção:** trocar a estratégia, não só ajustar o número do offset. O
wrapper `relative` ganhou `pt-28` (reserva de espaço real no fluxo normal,
vale em qualquer viewport) e o card ficou posicionado `top-0` dentro dessa
folga — a sobreposição residual no visual final é mínima e cai só na
borda/canto arredondado do card de baixo, nunca no conteúdo. Detalhe da
correção em `apps/web/src/components/marketing/product-mockup.tsx` e
DESIGN-SYSTEM.md §9.1.

**Como aplicar:** toda vez que compor 2+ elementos com sobreposição visual
deliberada (cards flutuantes, badges sobre imagem, elementos "colados" uns
nos outros), reservar o espaço da peça que fica por cima via padding/margin
no **fluxo normal** do container comum, e usar `absolute` só para o
deslocamento fino por cima dessa folga — nunca `absolute` sozinho como único
mecanismo de posicionamento em composições em camadas. E, de qualquer forma,
nunca confiar que "o offset parece pequeno" sem tirar o screenshot — esse
tipo de sobreposição só se prova errado depois de renderizado.
