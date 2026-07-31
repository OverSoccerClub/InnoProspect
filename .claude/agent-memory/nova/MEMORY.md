# Memória da Nova — InnoProspect

- [Escopo e decisões travadas](project_innoprospect_escopo.md) — o que é o produto, o que o dono já decidiu (scraping próprio, Evolution API, Next+Prisma) e premissas de escala.
- [Arquitetura v1 e porquês](project_innoprospect_arquitetura.md) — monólito em 2 processos, BullMQ+Redis, contracts Zod, Playwright, fanout IBGE.
- [Armadilhas e invariantes](project_innoprospect_armadilhas.md) — opt-out por telefone antes de cada envio, seletores em 1 arquivo, warmup como limite duro, sucesso silencioso do scraper.
