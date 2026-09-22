---
name: bug-shared-next-dev-cache-conflict
description: Rodar `next dev` numa segunda porta OU `next build` no mesmo diretório `apps/web` enquanto o servidor de dev compartilhado (usado por outra frente/pelo dono) está vivo corrompe o `.next` de todo mundo — quebra até `/` com 500
metadata:
  type: feedback
---

**O que aconteceu (Onda 2A, 2026-09-22):** para gerar um cookie de sessão
real e medir o bug de tabela sem depender do servidor compartilhado, subi um
`next dev` PRÓPRIO numa porta separada (3001) — mas ainda dentro do mesmo
diretório `apps/web` (mesmo `.next`). Depois de várias navegações, o meu
próprio servidor de teste começou a falhar com
`[webpack.cache.PackFileCacheStrategy] Restoring pack ... failed` e
`ENOENT ...vendor-chunks/lucide-react...` — sintoma clássico de dois
processos `next dev` escrevendo no mesmo `.next/cache/webpack` ao mesmo
tempo. Pior: mais tarde rodei `pnpm build` (produção) no MESMO diretório
enquanto o servidor de dev compartilhado (porta 3000, usado pela outra
frente/2B e possivelmente pelo dono) ainda estava de pé — isso sobrescreveu
artefatos de `.next/server` com formato incompatível com o runtime de dev
já carregado na memória do processo alheio, e `/` nessa porta passou a
devolver 500 (`Cannot find module`) mesmo sem eu ter tocado nele
diretamente.

**Recuperação que funcionou:** apagar `.next` por completo
(`rm -rf apps/web/.next`) e aguardar ~15-20s sem bater a rota de novo — o
`next dev` vivo recompila do zero sozinho na primeira requisição seguinte
(é o comportamento normal e esperado; a armadilha foi eu ter testado de
novo rápido demais e concluído erroneamente que tinha "quebrado de vez").
Confirmei recuperação completa testando `/`, `/leads`, `/templates`.

**Por quê isso importa:** este projeto agora roda com DUAS frentes (2A/2B)
no MESMO working directory, possivelmente com um servidor de dev
compartilhado que o dono/Atlas usa para acompanhar. Qualquer comando que
escreva em `.next` (`next dev` — mesmo numa porta diferente — ou `next
build`) enquanto esse servidor está vivo é, na prática, uma operação
destrutiva sobre um recurso compartilhado, mesmo sem intenção.

**Como aplicar:**
1. **Nunca subir um `next dev` extra no mesmo diretório do app** só para
   testar algo isoladamente — mesmo em porta diferente, ele compartilha
   `.next/cache/webpack` com qualquer outro `next dev` já rodando ali e
   corrompe os dois. Se precisar de um servidor isolado, teria que ser em
   uma cópia de diretório separada (fora de escopo na maioria dos casos) —
   normalmente o mais seguro é simplesmente NÃO subir servidor próprio e
   usar `pnpm typecheck`/`pnpm lint`/`pnpm test` (não tocam `.next`) como
   portão, deixando a validação visual pro Atlas/Íris no servidor já
   compartilhado.
2. **Nunca rodar `pnpm build`/`next build` num diretório onde um `next dev`
   compartilhado está de pé.** `next build` e `next dev` usam layouts de
   `.next` incompatíveis entre si — mistura os dois e derruba quem depende
   do servidor de dev, mesmo em rotas que você nem editou.
3. Se isso acontecer mesmo assim: `rm -rf apps/web/.next` e aguardar o
   próprio `next dev` recompilar sozinho na requisição seguinte (dar tempo
   real, ~15-20s, antes de concluir que não recuperou) — não reiniciar o
   processo manualmente (você provavelmente não sabe as variáveis de
   ambiente/segredo efêmero com que ele foi iniciado, ver
   [[convention-test-session-cookie]]).
