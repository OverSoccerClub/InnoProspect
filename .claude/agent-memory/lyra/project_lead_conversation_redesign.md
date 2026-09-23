---
name: project-lead-conversation-redesign
description: Redesenho da ficha de lead (2026-09-23) depois da 1ª conversa real em produção — chat como protagonista, polling silencioso de GET /leads/:id, e os achados de "linha do tempo não fiel" que ficaram fora do meu escopo
metadata:
  type: project
---

Pedido direto do dono depois de contatar um lead real pela 1ª vez em
produção: "não mostra a resposta do lead", "linha do tempo não é fiel",
"tela sem cor/vazia", "dava pra responder por aqui?". Os 4 pontos tinham
causas bem diferentes.

**"Não mostra a resposta do lead" era polling ausente, não dado faltando.**
`getLeadDetail` (`lib/services/leads.ts`, Vega) já devolve `messages` das
duas direções corretamente, e `handleInboundMessage` (`lib/services/
webhook.ts`) já persiste o `Message` inbound. O bug real: `LeadDetail`
(`components/leads/lead-detail.tsx`) só buscava o lead UMA VEZ, no mount —
sem poll, sem refetch, nada. O operador mandava a mensagem, o lead
respondia via webhook, e a tela ficava com o snapshot velho até um F5
manual. Corrigido com um `setInterval` de 8s chamando `getLead(id)` de novo
(GET é leitura pura, seguro de repetir) — pulando o tick por completo
enquanto `isSavingStatus` está em voo (evita a troca de status otimista
"voltar" por uma fração de segundo). Decidi NÃO usar o `usePolling` genérico
aqui: ele substituiria o `lead`/`isLoading`/`error` que já existem e que se
entrelaçam com as mutações otimistas de status/mensagem — um `setInterval`
próprio, guardado por refs, ficou mais simples de raciocinar sobre a corrida
com `handleStatusChange`. Indicador visual "Ao vivo" (ponto verde
`motion-safe:animate-ping`) no header do card — mesmo espírito do texto
"atualizando…"/"parado" que `SearchJobProgress` já usava para `isPolling`.

**"Linha do tempo não é fiel" — causa raiz é backend, fora do meu
território, reportado ao Atlas/Vega:** `handleInboundMessage` e
`handleMessageStatus` (`lib/services/webhook.ts`) atualizam `Message`
diretamente mas NUNCA criam `LeadActivity` para `message_received`,
`delivered` ou `read` — só `registerOptOutFromInbound` cria atividade. A UI
(`LeadTimeline`) já sabe render `message_received` (tipo existe no enum
local desde sempre) — só nunca recebe esse evento porque o backend não
grava. Enquanto isso não muda, a timeline só narra o que sai do nosso lado
(envio, mudança de status manual) — a chegada de uma resposta só aparece na
Conversa, nunca na Linha do tempo. Também achei e corrigi (dentro do meu
território, é só leitura defensiva na UI) um bug relacionado de grafia — ver
[[bug-lead-activity-type-spelling-mismatch]].

**"Tela sem cor/vazia" — Conversa + Compositor virou 1 card `elevated` só
(era 2 cards `flat` lado a lado, mesmo peso que Contato/Timeline).** Contato
continua `elevated` (identidade), Timeline ficou `flat` (histórico) — só
Conversa subiu de peso, porque agora é onde o trabalho acontece. Ver
DESIGN-SYSTEM.md §3 pra escala. Bolhas ganharam formato de chat mais
assimétrico (`rounded-2xl` com o canto do remetente `rounded-*-sm`),
separador de dia ("Hoje"/"Ontem"/data, `lib/format.ts#formatDayLabel`, novo)
sticky dentro do scroll, e o container da lista virou `role="log"
aria-live="polite"` — anuncia mensagem nova pra leitor de tela sem precisar
foco manual (achado de acessibilidade genuíno, não só "básico", encaixa bem
com o polling novo).

**"Dava pra responder por aqui?" — o compositor não mudou de lógica, só de
lugar e de indicador.** `MessageComposer` (template+preview+variação,
aviso sem telefone, `SEND_PACE_LOCKED`/`LEAD_CONTACT_COOLDOWN`/
`PACE_LOCK_BYPASSED_FOR_REPLY`) foi movido pro RODAPÉ do mesmo card da
Conversa (não mais um card "Enviar mensagem" separado). 2 achados reais no
meio do caminho:
1. `describeError` nunca tinha um `case` pra `SEND_PACE_LOCKED`/
   `LEAD_CONTACT_COOLDOWN` — caíam no `default` genérico, sem mostrar o
   instante de liberação que `details[]` já carrega (Vega implementou
   `nextSendAllowedAt`/`resetsAt` na Fase 4.C, ver
   `[[convention-cadencia-ligada-envio-manual]]` na memória do Vega — ficou
   pronto no backend, pendente na tela até agora).
2. `isColdFirstContact` local usava `lead.messages.length === 0`; o backend
   usa `lastOutbound === null` (`lib/services/messages.ts`) — divergem no
   caso raro de um lead só com mensagens recebidas e nunca respondidas.
   Corrigido para `!lead.messages.some(m => m.direction === 'outbound')`.
   Usei o mesmo booleano pra um texto explícito no rodapé: "Primeiro
   contato: respeita o intervalo mínimo..." vs. "Resposta a uma conversa em
   aberto: sai sem esperar..." — era o pedido explícito do dono de deixar
   claro quando o envio é livre e quando está no relógio.

**Não verificado ao vivo:** sem `next dev` compartilhado de pé nesta sessão
(não posso subir um próprio, ver
[[bug-shared-next-dev-cache-conflict]]) — `pnpm --filter web
typecheck/lint/test` verdes (321 no pacote web, 645 no monorepo, era 636 +
9 testes novos que eu mesma adicionei), mas o scroll-to-bottom, o separador
de dia sticky, e a bolha em 390px não foram vistos rodando. Pendência
explícita pra Íris.

**Rodada 2 (2026-09-23) — depois da 1ª conversa real chegar em produção:**
moldura de celular pedida e descartada (argumentei, dono topou — desperdiça
largura, cabe menos texto, "celular dentro de celular" em telas pequenas).
O pedido real ("retângulo branco vazio") virou textura CSS pura
(`.inno-chat-wallpaper`) + altura FIXA compartilhada entre vazio/populado
(antes era `min-h`/`max-h` elástico) — detalhe completo em
[[convention-chat-wallpaper-texture]] e DESIGN-SYSTEM.md §9.5. No caminho,
achei e corrigi 2 bugs de contraste PRÉ-EXISTENTES (não causados pela
textura, só pioravam com ela) no mesmo arquivo — mesma causa raiz de
[[feedback-dual-role-color-tokens]]. `pnpm test` no monorepo: 667/667,
igual ao número que o dono deu como baseline — sem regressão de contagem.
