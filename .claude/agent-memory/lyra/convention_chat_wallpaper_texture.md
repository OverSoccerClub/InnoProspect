---
name: convention-chat-wallpaper-texture
description: Como fiz a textura de "papel de parede" da área de conversa (dot-grid CSS puro, sem imagem) e como medi contraste de texto sobre um fundo translúcido/em camadas sem precisar de screenshot pixel-a-pixel
metadata:
  type: convention
---

**Contexto (2026-09-23):** dono pediu moldura de celular pra área de
conversa do lead; argumentei contra (desperdiça largura, cabe menos texto,
"celular dentro de celular" em telas pequenas) e ele topou. O pedido real —
"a caixa de mensagens é um retângulo branco vazio" — virou `.inno-chat-
wallpaper` em `globals.css`: dois `radial-gradient` (pontos) intercalados
por `background-position` (meia-célula) + um `linear-gradient` sólido
(véu), tudo no hue de `--primary`, alpha bem baixo (véu 5%, ponto 7-8%
dependendo do tema). Ver detalhe completo em DESIGN-SYSTEM.md §9.5 e
[[project-lead-conversation-redesign]].

**Como medir contraste de um texto sobre um fundo composto em camadas
(textura + bolha translúcida) sem precisar de screenshot pixel-a-pixel:**
compositing alfa é matemática determinística — não precisa de captura de
tela pra saber a cor final, só precisa fazer a conta certa, na ORDEM certa,
no PIOR caso. Escrevi um conversor OKLCH→sRGB (fórmulas padrão OKLab, ~40
linhas, Node puro) e apliquei a fórmula de composição simples do CSS
(`Cout = alpha*Ctop + (1-alpha)*Cbottom`, em sRGB gamma, não em linear —
é como o navegador compõe `rgba()`/`oklch(.../N%)` por padrão) camada por
camada: base opaca → véu → ponto (pior caso = pixel EM CIMA do ponto, não
no vão) → bolha translúcida por cima → luminância relativa → razão WCAG.
Isso é o MESMO método que o resto do `globals.css` já usa (comentário no
topo do arquivo: "conversor OKLCH→sRGB dedicado, não no olho") — não é uma
invenção nova, é aplicar a prática já estabelecida a um caso com mais
camadas. Depois, ainda tirei screenshot real (réplica estática do CSS +
Chromium via `playwright-core`, sem precisar de `next dev`) só pra
confirmar visualmente que a textura aparece e o texto lê bem nos dois
temas — mas o NÚMERO de contraste veio da conta, não do olho.

**Achado real no caminho: o pior caso não é sempre "o mais escuro/mais
translúcido".** A textura em si (véu+ponto) tem margem enorme mesmo em
alpha alto. O que trava o teto de opacidade é o texto `muted-foreground`
que fica DIRETO sobre a textura (sem bolha por baixo) — ex.: o aviso
"nenhuma resposta chegou ainda". `muted-foreground` já tem contraste bem
mais apertado que `foreground` contra qualquer fundo (~6-7:1 vs. ~15-17:1
nos tokens base, DESIGN-SYSTEM.md §7), então é ELE que define o teto de
opacidade da textura, não o texto branco/escuro principal. Ao ajustar
qualquer textura/overlay novo: sempre procurar o texto de MENOR contraste
que pode ficar em cima dela sem bolha/fundo opaco por baixo — geralmente é
um texto secundário/auxiliar, não o título.

**Bônus (achado, não objetivo original):** esse exercício de medir
contraste em camada revelou 2 bugs pré-existentes (texto `text-destructive`
usado como CORPO de texto sobre fundo `bg-destructive/N%` translúcido —
mesma causa raiz de [[feedback-dual-role-color-tokens]]), independentes da
textura nova: no dark, "Pedido de descadastro" media 3.09:1 e "Não foi
entregue..." media 2.71:1, os dois abaixo do piso 4.5:1, mesmo sem
textura nenhuma atrás. Corrigidos pra `text-foreground` (o ícone/badge ao
lado já carrega a cor semântica, no piso 3:1 onde ela passa). Vale a lição
geral: sempre que for medir contraste de UM elemento por causa de uma
mudança, vale a pena medir os vizinhos que usam o mesmo padrão de cor —
custo marginal baixo, e é assim que se acha bug antes do usuário.
