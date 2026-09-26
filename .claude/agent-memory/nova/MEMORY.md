# Memória da Nova — InnoProspect

- [Escopo e decisões travadas](project_innoprospect_escopo.md) — o que é o produto, o que o dono já decidiu (scraping próprio, Evolution API, Next+Prisma) e premissas de escala.
- [Arquitetura v1 e porquês](project_innoprospect_arquitetura.md) — monólito em 2 processos, BullMQ+Redis, contracts Zod, Playwright, fanout IBGE.
- [Armadilhas e invariantes](project_innoprospect_armadilhas.md) — opt-out por telefone antes de cada envio, seletores em 1 arquivo, warmup como limite duro, sucesso silencioso do scraper.
- [Estado real vs. escrito](project_innoprospect_estado_real.md) — peças completas e testadas SEM chamador; correções ao ARQUITETURA.md já aplicadas (v1.1) e o furo de telefone ainda aberto.
- [Envio unitário e o guard](decision_envio_unitario_guard.md) — por que o portão de opt-out nasce no §4.9 e não na campanha; write-ahead, carimbo checkedAt, piso de horário.
- [Lições de plano faseado](lesson_wiring_e_validacao_real.md) — Fase 0 com infra real, nada no plano sem contrato, wiring é a entrega, default degradado seguro.
- [Uso próprio (decisão travada)](decision_uso_proprio.md) — D3 encerrada e D9 aceita; o que "uso próprio" NÃO relaxa (LGPD, auth, anti-ban).
- [Fase 4: campanhas e motor](decision_fase4_motor.md) — cadência é do número, lease sem status `sending`, incerto nunca retentado, alvos no POST.
- [Onde o envio mora (4.F)](decision_onde_o_envio_mora.md) — `packages/sending`, HTTP entre apps descartado, motor nasce pausado, config de campanha só estreita.
- [Fase 6: prospecção autônoma](decision_fase6_prospeccao_autonoma.md) — ângulo calculado vs. frase gerada, medir antes de gerar, escada N0-N4, e por que a IA não é o produto.
