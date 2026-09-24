---
name: project_whatsapp_status_reconciliation_ui
description: UI do incidente "instância desconectada mas a tela mostrava conectada" — selo de frescor, botão Verificar agora, onde entrou e onde deliberadamente não entrou
metadata:
  type: project
---

Incidente do dono (2026-09-24): "mesmo o número estando desconectado o
sistema ainda fica mostrando como se ele estivesse conectado". Causa raiz era
de backend (webhook `connection.update` podia se perder e nada voltava a
perguntar — ver memória do Vega, `convention_reconciliacao_status_instancia`).
O contrato ganhou `WhatsAppInstanceItem.statusCheckedAt: string | null`
(`null` = nunca confirmado desde que a coluna existe) e
`POST /api/v1/whatsapp/instances/reconcile` (admin, reconciliação FORÇADA,
mesmo shape de `GET /whatsapp/instances`).

**O que a Lyra construiu por cima:**

- `lib/whatsapp-freshness.ts` — `getStatusFreshnessLevel(statusCheckedAt, now)`
  pura, limiar `STATUS_FRESHNESS_STALE_MS = 5min` (bem mais generoso que os
  60s do backend — aquele controla FREQUÊNCIA de reconciliação automática,
  este controla quando o OPERADOR deve desconfiar). Testada em
  `whatsapp-freshness.test.ts`.
- `components/whatsapp/status-freshness.tsx` — selo "Confirmado há X" /
  "Nunca confirmado", **nunca** vermelho/destructive (pedido explícito do
  dono: é "não sei", não "quebrou"). Só fica com peso visual (`warning`,
  `font-medium`) quando `isConnected` E está `stale`/`unknown` — é a
  combinação perigosa do incidente. Ver [[convention_use_now_self_aging_relative_time]]
  pro motivo de não congelar o texto.
- Botão "Verificar agora" — só para `session.user.role === 'admin'`, entra em
  `app/(dashboard)/whatsapp/page.tsx` (Server Component, `auth()`) → prop
  `isAdmin` → `components/whatsapp/whatsapp-page-client.tsx`. **Diferente**
  do padrão existente em `configuracoes/usuarios`/`configuracoes/servidores-
  evolution` (que gateia a PÁGINA INTEIRA): aqui só uma ação é admin-only, a
  lista de instâncias continua visível a todo papel — por isso o gate é
  granular (prop booleana), não a tela toda.
- Resultado da reconciliação forçada SUBSTITUI os dados na tela direto (state
  local sincronizado com o polling, sobrescrito pela resposta do POST) — não
  espera o próximo ciclo de 15s do `usePolling`. Falha (502, Evolution fora
  do ar) NUNCA troca os dados — só mostra `Alert variant="warning"` dizendo
  que não foi possível confirmar, mantendo o último estado conhecido visível.
- Dashboard (`system-health-card.tsx`): linha "WhatsApp" rebaixa pra `warn`
  (nunca `error`) quando há CONECTADAS com confirmação `stale`/`unknown`.
  Texto do resumo é deliberadamente CURTO ("N não confirmada(s)", sem tempo
  relativo) — o card é um resumo de relance, o "há quanto tempo" de cada
  instância já vive em `/whatsapp`; o detalhe completo está no `title` do
  `<span>` (hover).

**Onde decidi NÃO entrar** (e por quê, para não repetir a pergunta depois):
`campaign-instance-picker.tsx` (checklist já denso com 2 badges por linha +
cota) e `message-composer.tsx` (é um `<option>` de `<select>` — nem cabe
markup rico). Ambos já mostram `InstanceStatusBadge`/texto de status; achei
que frescor ali era ruído, não sinal — quem quer confiabilidade da conexão
antes de agir vai a `/whatsapp`.

Mock (`mocks/whatsapp.ts`) ganhou 4 instâncias com frescor variado de
propósito: `wa_1` fresca (15s), `wa_2` `connected` + `null` (o cenário exato
do incidente), `wa_3` `disconnected` há 90min (velho mas não perigoso),
`wa_4` `connected` há 7min (passou o limiar). `mockReconcileInstances` sempre
tem sucesso (não simula 502) — o caminho de erro é comportamento do backend
real, testado do lado do Vega.
