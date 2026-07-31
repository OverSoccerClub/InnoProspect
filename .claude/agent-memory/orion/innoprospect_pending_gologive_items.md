---
name: innoprospect-pending-gologive-items
description: Itens específicos levantados na auditoria pré-deploy de 2026-07-31 do InnoProspect que precisam ser revalidados nas próximas sessões (versão do Next.js, login quebrado, etc.)
metadata:
  type: project
---

Da auditoria de 2026-07-31 (véspera do primeiro deploy no EasyPanel) — conferir se ainda procede em
sessões futuras, porque são coisas que Vega/Vulcano podem já ter corrigido:

1. **Next.js estava pinado em `15.1.4`** (`apps/web/package.json`, confirmado em `pnpm-lock.yaml`) —
   versão anterior ao patch do CVE-2025-29927 (bypass de `middleware.ts` via header
   `x-middleware-subrequest`; corrigido a partir de 15.2.3). Recomendei upgrade antes do go-live.
   Impacto real era limitado pelo padrão de defesa em profundidade do projeto (ver
   [[innoprospect-security-baseline]]), mas é CVE público, trivial de explorar, e correção é só bump
   de versão — sem motivo para não corrigir. **Conferir se a versão já subiu antes de reabrir esse
   achado.**
2. **Login estava funcionalmente quebrado em produção** (não é vulnerabilidade, é bug que bloqueia
   uso): `apps/web/src/lib/auth-client.ts` fazia `fetch('/api/auth/callback/credentials')` cru, sem
   `csrfToken`, que o Auth.js v5 exige — login sempre falharia com `NEXT_PUBLIC_USE_MOCKS=false` (o
   default de produção do Dockerfile). Já estava documentado como pendência no `PROGRESSO.md` do
   projeto (item 3) antes da minha auditoria — a correção é trocar por
   `signIn('credentials', {...})` do `next-auth/react`. **Confirmar se foi corrigido; sem isso
   ninguém consegue entrar no sistema em produção.**
3. **Faltam headers de segurança** (CSP, X-Frame-Options, Referrer-Policy) — nenhum `headers()` em
   `apps/web/next.config.ts`. Já era dívida conhecida/planejada (ARQUITETURA §9.1, Fase 5.2,
   "Órion + Vega"). Não bloqueava o primeiro deploy da Fase 1 (sem WhatsApp, superfície pequena), mas
   cobrar quando a Fase 5 for revisada.
4. **`PLAYWRIGHT_BROWSERS_PATH` no `apps/worker/Dockerfile`** — o `chown` do usuário não-root
   `pwuser` assume que a env já vem setada pela imagem `mcr.microsoft.com/playwright:v1.49.1-jammy`,
   com fallback `/ms-playwright` se não vier. Vulcano mesmo marcou isso como não validado (sem Docker
   na máquina de dev). Não pude confirmar sem build real — **se o primeiro deploy do worker falhar
   ou o Chromium não rodar, esse é o primeiro lugar a olhar.**
