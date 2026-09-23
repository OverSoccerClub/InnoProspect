---
name: infra-xff-easypanel-verificacao
description: Procedimento (não código) para o dono confirmar se o proxy do EasyPanel sobrescreve X-Forwarded-For — documentado em DEPLOY.md §8.1, entregue 2026-09-23 sem tocar em apps/web/src (fora do meu escopo)
metadata:
  type: project
---

Pendência da auditoria do Órion: `apps/web/src/lib/rate-limit.ts` (`clientIp`/
`clientIpFromRequest`) confia no PRIMEIRO valor de `X-Forwarded-For`. Isso só
é seguro se o proxy do EasyPanel SOBRESCREVER esse cabeçalho (não ANEXAR) —
não confirmado, e eu não tenho acesso ao servidor nem posso tocar em
`apps/web/src/**` (fora do meu escopo nesta entrega).

**Entreguei o procedimento, não o código** — está em `DEPLOY.md §8.1`,
completo com os comandos `curl` exatos. Resumo do que ensinei o dono a fazer
(10 minutos, depois do 1º deploy do `web`, de FORA da VPS):

1. Baseline: 10 requisições limpas a `POST /api/v1/public/optout` (limite
   10/min) — confirma que o rate limit em si funciona (`RATE_LIMITED` na
   11ª).
2. Teste decisivo: a próxima requisição, IGUAL, mas com `-H
   "X-Forwarded-For: 203.0.113.99"` forjado.
   - Ainda vier `RATE_LIMITED` → proxy sobrescreve, defesa confirmada.
   - NÃO vier `RATE_LIMITED` (tratou como IP novo) → vulnerabilidade
     confirmada. Correção sugerida (para quem tiver acesso a
     `rate-limit.ts`): troca `forwarded.split(',')[0]` (primeiro valor,
     fácil de forjar) por `.pop()` (último valor, o hop mais próximo).

Por que `/api/v1/public/optout` e não o login: limite menor (10/min vs.
20/15min), sem sessão, sem risco de travar a própria conta de admin
enquanto testa. O corpo do POST pode ser lixo (`token` inválido) porque o
rate limit roda ANTES da validação do corpo em `apiRoute`.

Ver [[infra_worker_selftest_2026-09]] para o resto desta mesma entrega.
