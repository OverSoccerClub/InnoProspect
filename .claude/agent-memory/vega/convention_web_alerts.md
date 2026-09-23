---
name: convention-web-alerts
description: Módulo de alerta webhook do lado web (apps/web/src/lib/alerts.ts) — 4 eventos, dedupe por código só em evolution_api_error, nunca repassa mensagem crua da Evolution
metadata:
  type: project
---

Entregue na Onda 3 (2026-09-23): até então só `apps/worker` avisava alguém fora do painel (ver
[[convention-worker-alerts]]). Instância de WhatsApp caindo, Evolution API fora do ar, falhas
consecutivas de envio e campanha parada — todos aconteciam inteiramente em `apps/web` e eram
silenciosos.

**Módulo:** `apps/web/src/lib/alerts.ts` — DUPLICADO de propósito de `apps/worker/src/observability/
alerts.ts` (`apps/web` não pode importar `apps/worker`, regra de dependência do monorepo). Mesma env
(`ALERT_WEBHOOK_URL`, COMPARTILHADA entre os dois processos — não é uma variável nova por serviço),
mesmo contrato de payload (`text` pronto + campos estruturados), nunca lança, timeout de 5s.

**4 tipos de evento, `AlertEvent`:**
- `instance_disconnected` — instância cai (webhook `connection.update` OU falha de envio com
  `disconnectInstance: true`). NÃO dispara no disconnect MANUAL (`POST .../disconnect`) — o operador já
  sabe o que fez, resposta da rota já devolve `pausedCampaigns`.
- `instance_degraded` — 5 falhas consecutivas de envio (mesmo threshold que já existia,
  `CONSECUTIVE_FAILURE_DEGRADE_THRESHOLD` em `messages.ts`).
- `campaign_halted` — kill switch (`haltCampaignsSoleInstanceDisconnected`), dispara SEMPRE que
  `affected.length > 0`, mesmo no disconnect manual (diferente do `instance_disconnected` acima —
  decisão deliberada: campanha parada é grave o bastante para alertar mesmo quando o operador causou,
  porque ele pode não saber DE CABEÇA quais campanhas dependiam só daquela instância).
- `evolution_api_error` — qualquer `MessagingError` de uma chamada à Evolution, EXCETO
  `INVALID_NUMBER` (é problema do número do LEAD, não da API, e seu `message` ecoa o telefone — ver
  `evolution-client.ts`).

**Regra central de segurança: NUNCA repassar `MessagingError.message`/`.cause` cru no alerta.** Algumas
respostas de erro da Evolution ecoam de volta dado da requisição (telefone em `INVALID_NUMBER`,
possivelmente outros 400/422). Todo alerta usa `code` (vocabulário fechado `MessagingErrorCode`) +
mensagem PRÓPRIA escrita por nós. Mesma lógica para `campaign_halted`: o alerta nunca usa o
`haltReason` cru gravado no banco (que em 1 dos 3 call sites incorpora `errorMessage` da Evolution) —
usa um texto genérico fixo.

**Deduplicação — só `evolution_api_error` tem uma janela (15min, em memória, chaveada por `code`,
dentro do próprio módulo).** Os outros 3 tipos são transição-gated pelo CHAMADOR (mesmo padrão do
worker): `webhook.ts#handleConnectionUpdate` só alerta se `instance.status` (carregado ANTES do
webhook) ainda não era `disconnected`/`banned`; `messages.ts#recordSendFailure` só alerta
`instance_degraded` no exato ciclo em que `isDegraded` passa de `false` para `true`, e
`instance_disconnected` só se `previousStatus !== 'disconnected'` (defesa de 2ª linha — na prática o
G7 do guard já bloqueia com 409 antes de uma 2ª tentativa SEQUENCIAL chegar aqui; a checagem cobre a
corrida entre 2 requisições concorrentes, não elimina totalmente); `campaign-targets.ts` já filtra por
`affected.length > 0`. `evolution_api_error` é diferente porque não tem estado prévio no banco que sirva
de "isto já está aberto" — cada requisição falhando é um evento novo, por isso a janela.

**Limitação aceita, documentada no próprio módulo:** dedupe em memória do processo, mesma limitação de
`lib/rate-limit.ts` — não sobrevive a restart, não é compartilhado entre réplicas. Aceitável hoje
porque o EasyPanel roda 1 réplica de `web` (mesma justificativa já usada em `rate-limit.ts`).

**Testes:** `apps/web/src/lib/alerts.test.ts` (12 testes, espelha `alerts.test.ts` do worker + os
cenários de dedupe/código diferente/janela expirando). Cada call site testado no arquivo de teste do
próprio serviço (`webhook.test.ts`, `messages.test.ts`, `campaign-targets.test.ts`) via
`vi.mock('@/lib/alerts', ...)`.

Ver também [[convention-worker-alerts]] (o gêmeo do worker) e [[project-innoprospect]].
