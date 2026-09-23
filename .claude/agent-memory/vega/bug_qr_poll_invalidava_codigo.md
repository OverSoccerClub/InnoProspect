---
name: bug-qr-poll-invalidava-codigo
description: Poll de 2s em GET .../qr regenerava o QR a cada chamada e nunca dava tempo de escanear — bloqueava o primeiro envio real em produção
metadata:
  type: project
---

**Sintoma (2026-09-23, bloqueava o dono em produção):** instância cadastrada, Evolution conectando
("Conectado, 29 ms"), instância aparecia como `Connecting` no painel da Evolution, mas o celular NUNCA
conseguia ler o QR Code — a tela ficava girando indefinidamente.

**Causa raiz:** `GET /whatsapp/instances/:id/qr` chama `EvolutionClient.connect()` →
`GET /instance/connect/:name`, que **(re)inicia o pareamento e emite um QR novo a cada chamada** — não
é idempotente/pura. A tela (`qr-code-dialog.tsx`) fazia poll de 2s NESTE endpoint (pensando estar só
"atualizando o estado"), seguindo à risca a nota da própria `ARQUITETURA.md` §4.6 ("poll de 2s
enquanto o modal estiver aberto") — nota que EU escrevi errado na Fase 3/4.B, junto com o comentário
"buscar direto é funcionalmente equivalente [a cachear]" em `getWhatsAppInstanceQr`. Não é equivalente:
2s é muito menos que o tempo humano de abrir o WhatsApp, navegar até "Aparelhos conectados" e escanear —
o código morria antes disso em toda tentativa.

**Correção:** separar as duas responsabilidades que estavam misturadas no mesmo endpoint:
- `GET .../status` (novo, `getWhatsAppInstanceStatus` em `lib/services/whatsapp-instances.ts`) — chama
  `EvolutionClient.getConnectionState()` (`GET /instance/connectionState/:name`), leitura PURA, sem
  efeito colateral. É ESTE que pode/deve ser sondado com frequência (2s).
- `GET .../qr` — inalterado no back (ainda chama `connect`), mas agora só é chamado pelo front UMA vez
  ao abrir o modal, de novo quando o `expiresInSeconds` da resposta anterior vence, ou sob clique manual
  ("Gerar novo QR agora"). A cadência de renovação vem do `expiresInSeconds` que o PRÓPRIO backend
  devolve (hoje hardcoded 60s em `whatsapp-instances.ts`) — nunca um número fixo re-adivinhado no
  frontend.

A orquestração das duas cadências (status a cada 2s / QR só no vencimento ou manual) foi extraída para
`apps/web/src/lib/qr-connection-controller.ts` — função pura sem React (`createQrConnectionController`),
testável com `vi.useFakeTimers()` sem precisar montar componente (não há RTL neste projeto,
`apps/web/src/components/**` nunca teve teste — ver `vitest.config.ts`, só cobre `*.test.ts`). O
componente `qr-code-dialog.tsx` só liga esse controller a `useState`/`useEffect`.

**Como evitar de novo:**
1. Qualquer endpoint que chame `EvolutionClient.connect()` (ou qualquer verbo Evolution que reinicia
   estado) NUNCA pode ser alvo de poll de intervalo curto e fixo — só "uma vez + no vencimento
   informado pela própria resposta + manual". Sondagem de frequência alta só contra leituras PURAS
   (`getConnectionState`).
2. Doc de contrato (`ARQUITETURA.md` §4.6) é o que o resto da equipe (Lyra, Íris) segue à risca — se a
   nota ali estiver errada, o bug se replica em qualquer reimplementação futura. Corrigi a nota junto
   com o código (agora documenta `.../status` como o endpoint de poll, `.../qr` com o aviso explícito de
   que reinicia o pareamento).
3. Não confiar em "buscar direto é funcionalmente equivalente a cachear" como justificativa de design
   sem testar o EFEITO COLATERAL da chamada, só o dado retornado — a resposta pode ser "equivalente" e a
   chamada ainda ser destrutiva.

Relacionado: [[convention-messaging-evolution-api]], [[convention-web-alerts]].
