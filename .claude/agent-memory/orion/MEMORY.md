# Memória do Órion — InnoProspect

- [Baseline de segurança do InnoProspect](innoprospect_security_baseline.md) — padrão de defesa em profundidade (api-handler re-checa auth), modelo "autenticado=tudo" é decisão consciente, LGPD §7.2 (origem) já implementado, logging limpo.
- [Itens pendentes do go-live (2026-07-31)](innoprospect_pending_gologive_items.md) — Next.js 15.1.4 (CVE-2025-29927), login quebrado sem CSRF, headers de segurança ausentes, PLAYWRIGHT_BROWSERS_PATH não validado. Reconferir status antes de citar como novo achado.
