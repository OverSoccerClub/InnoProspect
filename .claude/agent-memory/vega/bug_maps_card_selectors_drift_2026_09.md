---
name: bug-maps-card-selectors-drift-2026-09
description: Incidente "lead só com nome+município, resto vazio" de 2026-09-22 — Google mudou a estrutura do card da lista do Maps; endereço não tinha seletor que casasse, categoria casava no elemento errado (nota, não categoria). Evidência real, não suposição.
metadata:
  type: project
---

**Causa raiz (comprovada ao vivo contra o Maps real, 1 busca controlada "material
de construção em Parnamirim, RN", 7 cards inspecionados em 2026-09-22, não
suposição):**

1. `SELECTORS.resultCard` (`div[role="feed"] > div > div[jsaction]`) também batia
   no carrossel de filtros do topo da lista (`div.fp2VUc[jsaction=...]`, que
   estruturalmente é filho no mesmo caminho) — um "card" fantasma sem nenhum
   campo, contado antes dos cards reais.
2. `SELECTORS.card.address` (`div.W4Efsd:last-child > div:last-child >
   span:last-child`) não tinha NENHUMA alternativa que ainda casasse: o Maps
   reestruturou o card — o endereço saiu do último bloco (que agora só tem
   horário+telefone, sem `div` filho) e passou a viver no MESMO bloco da
   categoria (um `div.W4Efsd` aninhado dentro de outro `div.W4Efsd`). Por isso
   endereço vinha SEMPRE vazio, para qualquer lead, não só o do incidente.
3. `SELECTORS.card.category` (`div.W4Efsd > div > span:first-child`) CASAVA,
   mas no elemento ERRADO: o bloco de nota/estrelas tem a mesma forma
   estrutural (`div.W4Efsd > div.AJB7ye > span.e4rVHe`) e vem ANTES da
   categoria no DOM — `.first()` pegava a nota. Corrigido ancorando no
   aninhamento duplo (`div.W4Efsd div.W4Efsd`), que só o bloco
   categoria+endereço tem.
4. Telefone (`span.UsdlK`) e nome (`a.hfpxzc[aria-label]`/`.qBF1Pd`) continuavam
   corretos — confirmado em 7/7 cards reais da amostra.

**O caso específico do lead "Botocenter" (100% vazio, inclusive categoria
mostrando "Sem categoria" e não um valor errado) não foi reproduzido ao vivo**
— pode ser um card de formato distinto (chain/franquia com estrutura reduzida)
não coberto por esta amostra. O que ficou provado é que os seletores de
endereço/categoria estavam genuinamente quebrados/errados independente desse
caso específico, o que já justifica a correção.

**Telefone sai da LISTA, não exige abrir a ficha do negócio** — confirmado
7/7 na amostra real. Tentativa de abrir a ficha (clique no card) FALHOU: sem
login, o Maps mostra "visualização limitada" (banner "Fazer login", resultado
plafonado em ~7-8 cards por busca) e o clique não trocou o painel para a
ficha — o painel principal continuou mostrando a lista. Não dá pra confirmar
o que teria na ficha nesta sessão; não importa para telefone (já vem da
lista), mas é relevante se algum dia cogitarem abrir ficha por lead: hoje,
sem login, não parece funcionar via clique simples — precisaria investigar
mais (talvez a URL `/maps/place/...` direta funcione mesmo sem clique no
card; não testado).

**Correção:** `packages/scraper/src/extraction/selectors.ts` reescrito com
comentário grande datado 2026-09-22 explicando os 8 achados. `resultCard`
agora usa `div[role="feed"] div[role="article"]` (ARIA, não é seletor de
classe/texto — evita a colisão com o carrossel de filtros). `card.rating`
prefere aria-label (`estrela`) sobre a classe. `card.category`/`card.address`
ancoram no aninhamento duplo `div.W4Efsd div.W4Efsd`; endereço usa
`span:last-child:not(:only-child) > span:last-child` pra pular o separador
"·" e não confundir "só categoria" com "tem endereço". `reviewCount`/`website`
mantidos como best-effort/aspiracional — NÃO observados em nenhum card real
nesta amostra (podem existir em outros nichos, ex. restaurantes com muita
avaliação — não verificado).

**Fixtures reescritas com HTML real** (não inventado):
`packages/scraper/src/sanity/fixtures/card-full.html` (card real "Pinheirão
Casa & Construção", inclui o badge de acessibilidade entre categoria e
endereço — testa que o badge não quebra a extração do endereço) e
`card-no-phone.html` (mesma estrutura real, telefone removido manualmente —
não observei nenhuma empresa sem telefone na amostra, então este caso é
"estrutura real, ausência simulada", documentado como tal no próprio
fixture). Casos de reviewCount/website e "categoria sem endereço" (guarda
`:not(:only-child)`) foram testados com HTML sintético inline em
`extract-card.test.ts`, claramente marcado como sintético (não fixture) —
nunca vi esses casos ao vivo.

**Como reproduzir uma investigação assim de novo:** lancei Chromium via
`playwright` (não `playwright-core` isolado — precisa rodar de dentro de
`packages/scraper` pra resolver `node_modules`), 1 navegação real,
`page.content()`/`locator(...).evaluateAll(outerHTML)` pra salvar HTML fora
do repo (scratchpad), analisei estrutura manualmente. Rodei 1 query só
(restrição do dono: "poucas requisições, espaçadas, depurando não
coletando") — o suficiente pra achar os 3 bugs acima com confiança alta.

Ver também [[bug-navigate-isvisible-no-real-wait]] (o incidente anterior no
mesmo arquivo `selectors.ts`/`navigate.ts`, causa raiz diferente — timing, não
seletor) e [[project-innoprospect]].
