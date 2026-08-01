---
name: lgpd-cascade-vs-historical-counters
description: Padrão para modelar entidades ligadas a Lead quando a eliminação LGPD pode apagar a linha — usar Cascade + contadores agregados históricos, nunca COUNT() puro nem SetNull que retenha dado pessoal.
metadata:
  type: feedback
---

Quando uma tabela filha de `Lead` guarda **dado pessoal snapshotado** (ex.:
`CampaignTarget.phoneE164`) e a entidade pai (`Campaign`) precisa reportar
estatística histórica sobre essa tabela filha, a modelagem correta é:

1. **FK da filha para `Lead` como `onDelete: Cascade`**, não `SetNull` nem
   `Restrict`. `SetNull` reteria o dado pessoal snapshotado na linha órfã —
   o oposto do que um pedido de eliminação LGPD (ARQUITETURA §7.3) exige.
   `Restrict` bloquearia a eliminação enquanto existir qualquer histórico de
   uso, o que na prática é sempre (uma vez que o lead foi contatado).
2. **Contadores agregados ANÔNIMOS no pai**, incrementados pelo worker a
   cada evento relevante (mesmo padrão já usado em `SearchJob.totalTasks/
   doneTasks/leadsFound/leadsNew` desde a Fase 1) — nunca recalculados por
   `COUNT(*)` sobre a tabela filha. Esses contadores são a fonte da verdade
   **histórica** e não retrocedem quando uma linha filha é apagada por
   Cascade. `COUNT(*) GROUP BY status` sobre a tabela filha continua útil,
   mas responde outra pergunta — "o que existe agora" (foto atual), não "o
   que aconteceu no total".
3. Se os eventos formam um funil onde uma linha passa por vários estágios
   (ex.: `CampaignTarget.status`: pending → sent → delivered → read →
   responded), os contadores são **por estágio alcançado**, não partição:
   uma linha que chega a `responded` incrementa `sentCount`,
   `deliveredCount`, `readCount` E `respondedCount` — não só o último. Isso
   garante `sentCount >= deliveredCount >= readCount >= respondedCount`.
4. Estados que são inerentemente "atuais" (ex.: `pending` — quantos ainda
   faltam processar) **não** ganham contador: são sempre lidos ao vivo via
   `COUNT(*) WHERE status = 'pending'`, coberto por índice já existente.

**Por quê:** na Fase 4 (`CampaignTarget`), eu (Cronos) tinha modelado
`CampaignTarget.leadId` como `Cascade` mas sem contadores no `Campaign` —
Atlas apontou que isso faz o histórico de campanha "encolher" retroativamente
toda vez que um lead pede eliminação meses depois de já ter recebido a
mensagem (ex.: "enviou 500" viraria "480" sem nenhuma explicação visível).
A correção (contadores agregados) resolve LGPD, histórico honesto e
performance (tela de progresso por polling, sem `COUNT` a cada leitura) ao
mesmo tempo — ver `Campaign.totalTargets/sentCount/.../skippedCount` em
`packages/db/prisma/schema.prisma`.

**Como aplicar:** qualquer entidade nova que (a) referencia `Lead` com dado
snapshotado e (b) tem uma entidade "pai" que reporta estatística agregada
sobre ela, deve seguir este padrão desde o desenho inicial — não esperar
correção. Rever também `Message` (referencia `Lead` com `Cascade` também,
sem contador agregado num "pai" — hoje não há problema porque não existe
uma entidade que soma `Message` por período de forma que precise sobreviver
à eliminação de um lead individual; se isso aparecer, aplicar o mesmo padrão).
