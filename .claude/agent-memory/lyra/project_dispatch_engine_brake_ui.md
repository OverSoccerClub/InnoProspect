---
name: project-dispatch-engine-brake-ui
description: Tela de pausar/retomar o motor de disparo (Fase 4.F.3) — decisões de UX sobre assimetria pausar/retomar, semântica invertida do status, e separação motor x worker. Consultar antes de tocar em /configuracoes/motor-disparo ou components/dispatch/*.
metadata:
  type: project
---

A rota (`GET/POST /api/v1/dispatch/queue`, `POST .../resume`) existia desde
antes; a tela não. Construída em 2026-09-25 depois de a Íris achar, na
auditoria de aceite da Fase 4, que o critério "o operador pausa e retoma pela
tela" nunca tinha sido cumprido — só existia via requisição HTTP manual.

**Decisões de UX, com o motivo:**

- **Um botão só por vez, nunca dois lado a lado.** Quando `running`: só
  "Pausar agora" (`variant="outline"`, sem `ConfirmDialog`, um clique). Quando
  `paused`: só "Retomar o motor" (abre `ConfirmDialog`, `confirmVariant="default"`
  — não `destructive`, mesmo padrão de `QueueHealthBanner`). O dono pediu
  explicitamente para resistir à simetria visual de dois botões iguais — eles
  não pesam igual (pausar reduz risco, retomar assume risco).
- **`paused` nunca é `warning`/`destructive` no badge** (`EngineStatusBadge`
  usa `variant="secondary"`, neutro). O motor NASCE pausado — é o estado
  inicial normal de todo deploy limpo, não um incidente. Isto é o oposto do
  `QueueHealthBanner` do scraper, onde `paused` É um alarme (pausa automática
  de segurança). As duas telas ficam a poucos cliques uma da outra em
  `/configuracoes` — **não reaproveitar o banner do scraper aqui às cegas**,
  a semântica de "pausado" é literalmente invertida entre as duas filas.
- **Heartbeat do worker é um sinal SEPARADO do status do motor**
  (`lib/dispatch-heartbeat.ts`, `WorkerHeartbeat`). O backend grava o
  heartbeat mesmo com o motor pausado (de propósito, ARQUITETURA §6.8.9) —
  então a tela pode e deve mostrar as duas coisas juntas: "pausado + worker
  vivo" (normal) e "ligado + worker sem sinal" (perigoso: o flag diz que
  está disparando, mas nada sai). Este segundo caso ganhou um `Alert
  variant="warning"` dedicado dentro de `DispatchEngineCard` — não é o mesmo
  peso visual de "worker sem sinal" sozinho.
- **Limiar do heartbeat vem da matemática do TTL do Redis do lado do worker**
  (tick a cada 15s, chave com `EX 45`), não de um número arbitrário — ver
  comentário completo em `lib/dispatch-heartbeat.ts`. `lastTickAt === null` é
  ambíguo entre "nunca rodou" e "morreu há >45s" (a própria chave expira), e a
  tela não tenta fingir que sabe distinguir.
- **Gate de admin é por prop (`isAdmin`), não a página inteira** — mesmo
  padrão de `WhatsappPageClient` ([[project_whatsapp_status_reconciliation_ui]]).
  Diferente de `configuracoes/usuarios`/`servidores-evolution`: aqui o `GET`
  é liberado para QUALQUER operador autenticado (ver comentário na rota) —
  "o motor está ligado?" não é informação administrativa, é operacional. Só
  as ações de pausar/retomar são admin-only.
- **Sem captura de motivo de pausa.** Conferido: `POST /api/v1/dispatch/queue`
  não aceita corpo nenhum, e `clearDispatchEnabledMeta` não registra
  ator/motivo. Diferente de `resumeDispatchQueue`, que registra `enabledBy`.
  Isso é uma lacuna real de auditoria ("por que isso está pausado?" não tem
  resposta na API hoje) — reportada como pendência para o Vega, não inventada
  no frontend.

**Sem contrato em `@inno/contracts`** para este endpoint ainda — segui o
padrão de `types/scraper-queue.ts` (tipo local espelhando
`lib/services/dispatch.ts` campo a campo, com TODO de migração).
