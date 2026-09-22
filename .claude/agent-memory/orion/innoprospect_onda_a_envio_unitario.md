---
name: innoprospect-onda-a-envio-unitario
description: Auditoria da Onda A do InnoProspect (2026-09-22) — primeiro caminho real de envio de WhatsApp (POST /leads/:id/messages, §4.9). Veredito sobre o conflito guard-vs-write-ahead, achados por severidade, e o que confirmar na Fase 4 (dispatch worker).
metadata:
  type: project
---

Auditoria de 2026-09-22, foco no primeiro call site de produção de `sendText` (Onda A: envio
unitário `POST /api/v1/leads/:id/messages`, ARQUITETURA §4.9). Ver [[innoprospect-fase3-whatsapp-optout-webhook]]
para o estado anterior (quando ainda não existia caminho de envio nenhum) e
[[innoprospect-security-baseline]] para o padrão geral do projeto.

**Veredito: o envio pode ir para produção.** Confirmado `grep -rn "sendText(" apps/ packages/` →
exatamente UM call site de produção (`apps/web/src/lib/services/messages.ts:428`). Nenhum caminho
encontrado que envie sem passar por `evaluateSendGuard` (sem early return, sem retry externo ao
guard — os retries de `EvolutionClient` são de TRANSPORTE, dentro da mesma chamada de `sendText`,
nunca uma segunda invocação da função). G10 (aviso de opt-out + nome da empresa) é verificado sobre
o TEXTO FINAL já renderizado, então `body` livre não contorna: se o texto final não tiver o aviso, o
G10 bloqueia igual, tanto para template quanto para texto digitado à mão.

**O veredito sobre o conflito §4.9.3 vs §4.9.5 (write-ahead entre guard e sendText): NÃO é
reprovação — é uma leitura aceitável, mas o texto da ARQUITETURA precisa ser corrigido.**
Razões:
1. A transação de write-ahead (`Message(queued)` + `InstanceDailyStat.sentCount++`) não RELÊ nem
   reusa opt-out — é uma escrita independente, não uma segunda decisão baseada em dado potencialmente
   stale. O invariante que protege de verdade (decisão de opt-out fresca) continua íntegro: o `SELECT`
   por `phoneE164` acontece imediatamente antes de `evaluateSendGuard`, sem `await` entre os dois
   (confirmado lendo `messages.ts` linha 376-400), e o carimbo `checkedAt` é verificado pelo próprio
   `evaluateSendGuard` (`StaleOptOutCheckError`, 5s).
2. Zero I/O entre decisão e rede é impossível para QUALQUER implementação real — `sendText` em si é
   I/O com latência não-nula. A pergunta certa não é "há I/O no meio?" (sempre vai haver, é a própria
   chamada de rede), é "esse I/O intermediário reabre a pergunta que o guard já respondeu?". Não
   reabre: a transação de write-ahead é sobre cota/reserva, não sobre opt-out.
3. §4.9.5 (a seção mais detalhada, com o diagrama) já SANCIONA explicitamente esta transação como a
   única I/O permitida entre G11 e `sendText` ("nenhum outro I/O entre G11 e esta linha" — a seta do
   diagrama está entre a transação 1 e o `sendText`, não entre G11 e a transação). A frase resumo de
   §4.9.3 ("sem nenhum await de I/O entre os dois além da renderização do texto") é a que está
   desatualizada/imprecisa e contradiz §4.9.5 — corrigir §4.9.3 para: "nenhuma LEITURA adicional (em
   particular, nenhuma segunda consulta de opt-out) entre o guard e o `sendText`; a ÚNICA escrita
   permitida no intervalo é a transação de write-ahead do §4.9.5, que precisa ser rápida e não pode
   reabrir a decisão".
4. Latência comparativa: os dois caminhos que criam `OptOut` (reply "SAIR" via webhook assíncrono da
   Evolution, ou `/descadastro/:token` público — outra requisição HTTP inteira) têm latência mínima
   realista MUITO maior (rede da operadora + webhook + processamento) que uma transação Postgres
   local de 2 escritas. O write-ahead não amplia de forma relevante uma janela que já existe por
   natureza do problema (qualquer sistema de disparo em tempo real tem esse gap).

**Gap residual real, não bloqueante (Médio):** não há limite superior para o intervalo entre
`guardNow` (o `now` usado na decisão) e o instante real da chamada a `sendText` — só o `checkedAt`
(SELECT→decisão) tem o teto de 5s; o intervalo decisão→rede não é medido nem re-verificado. Se a
transação de write-ahead ficar anormalmente lenta (lock contention, réplica sobrecarregada), a janela
cresce sem qualquer proteção equivalente. Recomendação para Vega: ou (a) medir o tempo logo antes do
`sendText` e reconsultar opt-out se passou de um limiar pequeno (ex. 3-5s), ou (b) colocar um
`statement_timeout`/timeout de transação curto na transação 1, para falhar fechado em vez de alargar
silenciosamente a janela. Não é urgente dado o padrão observado (transação local, 2 escritas).

**Achado Médio adicional — retry de TIMEOUT não é idempotente do lado da Evolution.**
`packages/messaging/src/client/http.ts#evolutionRequest` retenta até 2x em `TIMEOUT`/`TRANSIENT_ERROR`
(nosso client não recebeu resposta a tempo). Se a primeira tentativa **chegou** a processar o envio
do lado da Evolution mas a resposta se perdeu/demorou, o retry pode causar envio DUPLICADO de verdade
no WhatsApp do lead (nosso banco só registra 1 `Message`, mas 2 mensagens reais podem ter saído) —
sem idempotency key enviada à Evolution. Baixo risco prático (rede interna, timeout de 15s), mas é a
primeira vez que isso é exercitado em produção (antes não havia call site real). Sugestão não
bloqueante: se a Evolution API aceitar algum campo de idempotência no `sendText`, usar; senão,
documentar como risco aceito.

**Achado Médio — endpoint unitário pode ser roteirizado para simular disparo em massa.** Rate limit
é só por USUÁRIO (`manual-send:<userId>`, `MANUAL_SEND_RATE_PER_MIN`, default 10/min) — não por lead
nem por instância, e sem jitter algum (isso é proposital, §4.9.1: "volume 1, humano no clique"). Nada
tecnicamente impede um script autenticado de chamar o endpoint no ritmo máximo permitido contra
leads distintos, o que aproxima do comportamento de uma campanha sem os controles de cadência que a
Fase 4 vai trazer. Fica limitado pela cota diária por instância (G8) e pelo piso de horário (G5) —
não é um bypass de proteção hoje ativa, é uma lacuna a monitorar quando a Fase 4 (dispatch worker com
jitter) existir e alguém puder comparar os dois caminhos.

**Confirmado limpo (sem achado novo):**
- Headers de segurança **AGORA EXISTEM** em `apps/web/next.config.ts` (CSP, X-Frame-Options,
  X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS, frame-ancestors) — **RESOLVE o
  pendente #3 de [[innoprospect-pending-gologive-items]]**, registrado como PENDENTE desde
  2026-07-31. `script-src` sem `unsafe-eval` em produção confirmado lendo a lógica
  (`process.env.NODE_ENV === 'development' ? ... : ...`), não só a afirmação do Vega. Resta
  `'unsafe-inline'` em `script-src`/`style-src` (CSP sem nonce, decisão documentada, melhoria futura
  — não é achado novo).
- Login: rate limit por e-mail (5/15min) e por IP (20/15min) só conta FALHAS, zera e-mail no
  sucesso e nunca zera IP, timing attack preservado (`DUMMY_PASSWORD_HASH`), bloqueio indistinguível
  de senha errada para o cliente (resposta genérica nos dois casos, detalhe só no log). Implementação
  bate com o que a memória já esperava.
- `clientIpFromRequest`/`clientIp` confiam em `X-Forwarded-For` sem validar se o proxy do EasyPanel
  de fato o sobrescreve — **mesma ressalva já documentada pelo próprio Vega no código-fonte**, não
  validado nesta máquina (sem ambiente de produção). Continua PENDENTE DE CONFIRMAÇÃO em produção,
  não é novo.
- Sem XSS: `message.body` renderizado como texto React puro (`lead-conversation.tsx:66`), nenhum
  `dangerouslySetInnerHTML` tocando dado de mensagem/lead (o único uso do projeto é
  `theme-script.tsx`, script estático sem dado de usuário).
- `error.reason`/`details` não vazam nada sensível: os `details:[{path,message}]` reaproveitados para
  meta (`resetsAt`/`nextWindowOpensAt`/`optedOutAt`) são só timestamps ISO, não dado de terceiro.
  Erros 500 continuam com mensagem genérica fixa, nunca stack/detalhe do Prisma.
- `alerts.ts` (novo, worker) só cobre eventos da fila de scraping (sanidade/pausa/retomada) — SEM
  telefone/nome de lead no payload, URL fixa de env (sem SSRF). Webhook do WhatsApp continua um
  módulo diferente, sem alerta ainda.
- G10 não é contornável trocando `body` livre por `templateId` nem vice-versa: a checagem roda sobre
  o texto FINAL já resolvido (pós-spintax), então nem uma variação de spintax sem o aviso escapa —
  se `evaluateSendGuard` recebe esse texto, bloqueia igual.

Ver também [[innoprospect-security-baseline]] e [[innoprospect-pending-gologive-items]].
