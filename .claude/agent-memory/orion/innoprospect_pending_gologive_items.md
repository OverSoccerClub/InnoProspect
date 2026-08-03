---
name: innoprospect-pending-gologive-items
description: Itens específicos levantados na auditoria pré-deploy de 2026-07-31 do InnoProspect que precisam ser revalidados nas próximas sessões (versão do Next.js, login quebrado, etc.)
metadata:
  type: project
---

Da auditoria de 2026-07-31 (véspera do primeiro deploy no EasyPanel) — conferir se ainda procede em
sessões futuras, porque são coisas que Vega/Vulcano podem já ter corrigido:

1. ~~Next.js pinado em `15.1.4` (CVE-2025-29927)~~ — **RESOLVIDO**, confirmado em 2026-08-03: `next` está em
   `15.5.22` em `apps/web/package.json` (patch já incluso).
2. ~~Login quebrado em produção (fetch cru sem csrfToken)~~ — **RESOLVIDO**, confirmado em 2026-08-03:
   `apps/web/src/lib/auth-client.ts` já usa `signIn('credentials', { email, password, redirect: false })`
   de `next-auth/react`.
3. **Faltam headers de segurança** (CSP, X-Frame-Options, Referrer-Policy) — nenhum `headers()` em
   `apps/web/next.config.ts`. Reconfirmado AINDA PENDENTE em 2026-08-03 (Fase 3 — WhatsApp/opt-out —
   revisada, nenhum `headers()` adicionado). Era dívida conhecida/planejada (ARQUITETURA §9.1, Fase
   5.2, "Órion + Vega"). Agora que existe a página pública `/descadastro/:token` (sem sessão, alvo real
   de clickjacking) e o dashboard segue sem `X-Frame-Options`, a superfície cresceu — cobrar
   explicitamente quando a Fase 5 for revisada, não deixar rolar para uma "Fase 6".
4. **`PLAYWRIGHT_BROWSERS_PATH` no `apps/worker/Dockerfile`** — ainda não confirmado (sem Docker na
   máquina de dev). Não foi reavaliado na auditoria de 2026-08-03 (fora do escopo, que foi WhatsApp/
   opt-out/webhook) — **se um build real já rodou desde então, reconferir meu status "não validado".**

Ver [[innoprospect-fase3-whatsapp-optout-webhook]] para os achados da auditoria de 2026-08-03
(Fase 3: WhatsApp, opt-out, webhook Evolution).
