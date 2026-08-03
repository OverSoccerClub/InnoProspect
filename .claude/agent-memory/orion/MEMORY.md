# Memória do Órion — InnoProspect

- [Baseline de segurança do InnoProspect](innoprospect_security_baseline.md) — padrão de defesa em profundidade (api-handler re-checa auth), modelo "autenticado=tudo" é decisão consciente, LGPD §7.2 (origem) já implementado, logging limpo.
- [Itens pendentes do go-live (2026-07-31, atualizado 2026-08-03)](innoprospect_pending_gologive_items.md) — Next.js e login JÁ CORRIGIDOS; headers de segurança e PLAYWRIGHT_BROWSERS_PATH ainda pendentes.
- [Auditoria Fase 3 — WhatsApp/opt-out/webhook (2026-08-03)](innoprospect_fase3_whatsapp_optout_webhook.md) — sem dispatch worker ainda (anti-ban não tem o que proteger), opt-out público bem desenhado, sem rate limit real no servidor (UI já trata mas backend não emite), sem SSRF, sem vazamento de EVOLUTION_API_KEY, pnpm audit limpo de código próprio.
