---
name: bug-middleware-blocks-metadata-icon-routes
description: middleware.ts só isenta favicon.ico do matcher — as rotas de metadata do App Router (app/icon.svg, app/apple-icon.png) caem na checagem de sessão e voltam 307 para /login, inclusive na landing pública
metadata:
  type: feedback
---

**Achado (2026-09-22, rodada "layout premium" onda 1, ao adicionar
`app/icon.svg`/`app/apple-icon.png` — convenção de metadata do App Router
pedida pelo Atlas):** medi com `curl -D -` antes de declarar pronto (hábito
de [[bug-dev-csp-blocks-hydration]]) e as duas rotas devolviam **307 para
`/login`**, não a imagem. Causa: `middleware.ts` (Vega/Órion, fora do meu
escopo) só exclui `favicon.ico` explicitamente no `matcher`:

```
matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
```

`icon.svg`/`apple-icon.png` (e qualquer outra rota de metadata do App
Router — `opengraph-image`, `sitemap.xml`, `robots.txt`, se algum dia
existirem) não estão na lista de exceção, então o middleware trata a
requisição da imagem como se fosse uma página do dashboard: sem sessão real
→ redirect pro login. Isso quebra o ícone **em qualquer página, inclusive a
landing pública** (`/`), porque a checagem é por PATH da requisição do
asset, não pela página que o referencia.

**Eu não corrigi** — `middleware.ts` é território do Vega
(`project-innoprospect.md`), e a instrução desta rodada foi explícita: não
tocar em lógica de auth/middleware. Reportei como bloqueio no handoff. Fix
sugerido (uma linha, baixo risco, não é lógica de autenticação — é só
adicionar as duas rotas estáticas à exceção já existente):

```
matcher: ['/((?!_next/static|_next/image|favicon.ico|icon\\.svg|apple-icon\\.png).*)']
```

**Como aplicar:** antes de declarar qualquer asset novo em `app/`
(ícone, manifest, opengraph-image) como "pronto", testar com `curl -D -`
contra o servidor local — não confiar que "está no lugar certo pela
convenção do Next" é suficiente neste projeto, porque o middleware
intercepta TUDO por padrão e a lista de exceção é curada à mão.
