# ACEITE-FASE-4 — roteiro executável do motor de disparo

> Autora: Íris (QA). Escrito para o dono executar sozinho, com Evolution real
> e 2 instâncias — a mesma régua que `DEPLOY.md` usa para quem clica na
> interface, não para quem já tem o código na cabeça. Referência normativa:
> `ARQUITETURA.md §8` (Fase 4.F, "Aceite da fase") e `§6.8` (especificação do
> tick). Se este documento e o `ARQUITETURA.md` discordarem em algum detalhe,
> o `ARQUITETURA.md` manda — volte lá.
>
> ⚠️ **O que eu NÃO fiz:** rodar isto. Esta máquina não tem Postgres, Redis
> nem Evolution — é limitação antiga do projeto, registrada desde a Fase 0.
> Os 815 testes automatizados do repositório passam (`pnpm test`, confirmado
> nesta rodada), mas provam a **lógica de decisão** contra bancos falsos, não
> o comportamento contra infraestrutura real. Este roteiro é o que fecha essa
> lacuna — e só fecha quando alguém de fato o executar e anotar o resultado
> de cada item, não quando ele existir escrito (§8.0 regra 1 do próprio
> `ARQUITETURA.md`).
>
> ⚠️ **Gap encontrado nesta auditoria, antes de qualquer item:** a Fase 4.F.3
> prometia rotas **e tela** para pausar/retomar o motor (`GET/POST
> /api/v1/dispatch/queue`). As rotas existem
> (`apps/web/src/app/api/v1/dispatch/queue/route.ts`,
> `.../resume/route.ts`) — a tela não. Não há nenhum componente de UI que as
> consuma (o `QueueHealthBanner` que existe no dashboard é só do **scraper**,
> `/api/v1/scraper/queue`). Na prática, hoje, **pausar/retomar o motor exige
> chamar a API na mão** (curl/Postman/Insomnia com sessão de admin) —
> exatamente o que o `§6.8.9` diz que o dono não deveria precisar fazer ("do
> celular, sem terminal"). Isto não bloqueia testar o **comportamento** do
> motor (os itens abaixo funcionam via API), mas é uma dívida real que
> **alguém tem que decidir se fecha antes do motor ir para produção com
> ninguém olhando** — registrei como pendência no meu veredito.

---

## 0. Preparação (fazer uma vez, antes do item 1)

- [ ] **Ambiente:** Evolution API real, 2 instâncias de WhatsApp conectadas
  (números de teste, não números de produção) — `warmupDay` alto em ambas
  (ex.: force `dailyLimitOverride` generoso ou espere alguns dias de uso) para
  não confundir "parou por warmup" com "parou por bug" durante o teste.
- [ ] **Campanha:** monte pela tela (`/campaigns/novo` ou equivalente) uma
  campanha de **50 alvos**, com as 2 instâncias, texto com spintax
  (`{opção a|opção b}`, mínimo de 10 variações — a tela recusa com menos se
  >50 alvos, ARQUITETURA §6.4).
- [ ] **`ALERT_WEBHOOK_URL` está desligado neste ambiente** (confirmado com o
  Vulcano/`.env`). Isso significa que os alertas `high`/`critical` dos itens
  abaixo **não vão chegar em canal nenhum** — a única forma de confirmar que
  o alerta *seria* disparado é olhar o **log do worker** (aba "Logs" do
  serviço `worker` no EasyPanel) procurando a linha `dispatch-tick:` com o
  `kind` do alerta. Cada item abaixo diz qual `kind` procurar.
- [ ] **Console psql** (ou cliente gráfico) contra o `DATABASE_URL` de
  produção, READ-ONLY na maior parte do roteiro — só os itens 3, 5 e 6
  precisam de uma ação de escrita/infra fora da tela.
- [ ] Anote a **data de hoje em `America/Sao_Paulo`** (ex. `2026-09-25`) —
  as queries de cota usam essa data como literal, porque
  `InstanceDailyStat.date` já é gravado como meia-noite UTC do dia civil de
  SP (não precisa converter fuso na query, só usar a data certa).
- [ ] **Ligar o motor pela API** (não existe botão — ver gap acima):
  ```bash
  curl -X POST https://SEU_DOMINIO/api/v1/dispatch/queue \
    -H "Cookie: <sessão de admin>" \
    -d '{}'
  ```
  Confirme com `GET` na mesma URL: resposta deve trazer algo como
  `{ "status": "running", "lastTickAt": "<poucos segundos atrás>" }`.

### 0.bis — Confirme que o motor nasce PAUSADO (checagem extra, fora da lista de 6, mas o dono pediu)

Isto só pode ser verificado num **deploy limpo** (Redis vazio) — se você já
ligou o motor no passo anterior, isto vale para a **próxima vez** que o
Redis for resetado (ex.: recriação do serviço Redis no EasyPanel) ou no
primeiro deploy em produção.

- **O que fazer:** logo depois do Redis subir vazio (antes de qualquer
  `POST /api/v1/dispatch/queue`), chame `GET /api/v1/dispatch/queue`.
- **Passa se:** a resposta traz `status: "paused"` (ou equivalente —
  confirme o campo exato lendo `apps/web/src/lib/services/dispatch.ts` se a
  resposta não bater com isto) **mesmo sem ninguém nunca ter chamado
  `/resume`**. Uma campanha `running` na tela **não dispara nenhum envio**
  até alguém pausar→retomar manualmente uma vez.
- **Falha se:** o motor aparecer `running`/enviando sem ação humana depois de
  um Redis limpo. Isso é o inverso exato do que `§6.8.9` exige — reprovação
  imediata, sem depender dos itens 1-6.

---

## 1. Cota e janela (campanha de 50 alvos, 2 números, respeita cota e janela)

**O que preparar:** a campanha do passo 0, dentro do horário comercial
(09:00-18:00 SP, seg-sex — ou o horário que você configurou na campanha,
desde que dentro do piso 08:00-20:00). Deixe rodando pelo menos até esgotar
os 50 alvos ou até o fim do expediente, o que vier primeiro.

**O que observar:**
- **Na tela** (`/whatsapp`, `InstanceCard` de cada instância): o card mostra
  "hoje: N enviadas / M restantes" (`instance.today.sent`/`remaining`).
  Acompanhe as duas instâncias.
- **No banco**, ao final (ou a qualquer momento), a cota de HOJE de cada
  instância:
  ```sql
  SELECT i.name, i."warmupDay", i."dailyLimitOverride",
         s."sentCount", s."failedCount"
  FROM whatsapp_instances i
  LEFT JOIN instance_daily_stats s
    ON s."instanceId" = i.id AND s.date = '2026-09-25'  -- troque pela data de hoje em SP
  WHERE i.id IN ('<id-instancia-1>', '<id-instancia-2>');
  ```
- **Nenhum envio fora da janela:** confira o horário de `createdAt` de cada
  `Message` enviada por esta campanha:
  ```sql
  SELECT m."createdAt", m.status
  FROM messages m
  JOIN campaign_targets t ON t.id = m."campaignTargetId"
  WHERE t."campaignId" = '<id-campanha>'
  ORDER BY m."createdAt";
  ```
  Todo `createdAt` (convertido para `America/Sao_Paulo`) tem que cair dentro
  da janela configurada, nunca no sábado/domingo (isso não é configurável —
  `ARQUITETURA §10`, `DISPATCH_ALLOW_SATURDAY` foi removida de propósito em
  24/09/2026).

**Passa se:** `sentCount` de cada instância nunca excede
`effectiveDailyLimit(warmupDay, dailyLimitOverride)` (a tabela do §6.2 — dia
1-2 → 20, dia 3-4 → 40, etc., ou o override se houver e for **menor**), e
nenhum `Message.createdAt` cai fora da janela.

**Falha se:** qualquer instância passar do teto do dia, ou aparecer um envio
fora do horário/dia configurado.

---

## 2. Intervalos não-constantes + micro-pausa observável

**O que preparar:** a mesma campanha rodando (item 1). Precisa de volume
suficiente para a micro-pausa aparecer — o limiar é sorteado entre 18-25
envios (§6.3), então com só 1 instância recebendo a maior parte da cota isto
pode não disparar dentro de 50 alvos; rodar com as 2 instâncias ativas ajuda
pouco aqui porque a micro-pausa é **por instância**, não por campanha. Se 50
alvos não bastarem para ver a micro-pausa, isto é esperado — registre "não
observado, volume insuficiente" em vez de forçar.

**O que observar:**
```sql
SELECT m."createdAt"
FROM messages m
JOIN campaign_targets t ON t.id = m."campaignTargetId"
WHERE t."campaignId" = '<id-campanha>' AND m.status IN ('sent','failed')
ORDER BY m."createdAt";
```
Calcule os intervalos entre linhas consecutivas **da mesma instância**
(`m."instanceId"`).

**Passa se:**
- Os intervalos **não são todos iguais** (nem próximos de um valor fixo) —
  devem variar entre ~45s e ~180s, concentrados perto de ~70s (log-normal,
  não uniforme).
- Pelo menos **um** intervalo bem maior que os outros (5-12min) — a
  micro-pausa. Se não aparecer por volume insuficiente, ver nota acima.

**Falha se:** os intervalos forem visivelmente constantes (ex.: sempre ~60s
±1s) — sinal de que o jitter não está sendo aplicado de verdade.

---

## 3. Desconectar um número no meio → `halted` (não `paused`)

**O que fazer:** com a campanha rodando e enviando pelas 2 instâncias,
desconecte **uma** delas de propósito — o jeito mais realista é abrir o
WhatsApp no celular da instância e usar "Desconectar todos os dispositivos"
(simula banimento/queda real, não um clique na nossa própria tela). Se
preferir um caminho mais controlado, use o botão "Desconectar" do
`InstanceCard` na tela `/whatsapp` — mas isso passa pelo endpoint manual
(`POST /whatsapp/instances/:id/disconnect`), não pelo webhook, então prova
metade do caminho (o kill switch por si), não o webhook `connection.update`
em si.

Se a campanha tinha **as duas** instâncias ativas, ela só vai para `halted`
quando **nenhuma** sobrar conectada — desconecte a outra também se quiser
forçar isso rápido, ou espere a única sobrevivente ficar sem cota do dia (aí
o motor não teria como enviar mesmo com uma "conectada" e sem quota — isso
NÃO é halt, é o item 1 de novo; não confunda os dois).

**O que observar:**
- **Na tela** (`/campaigns/<id>`, `campaign-detail-view.tsx`): aparece o
  alerta vermelho com `haltReason` legível e o botão "Revisar e retomar".
- **No banco:**
  ```sql
  SELECT status, "haltReason" FROM campaigns WHERE id = '<id-campanha>';
  ```
  `status` tem que ser `'halted'`, nunca `'paused'` — são estados diferentes
  de propósito (`§6.5`).
- **Tentar retomar sem reconhecer o incidente:** chame
  `POST /api/v1/campaigns/<id>/resume` **sem** o campo `acknowledgeHalt: true`
  no corpo (ou pelo botão da tela sem marcar a confirmação, se ela existir).
- **Log do worker:** procure `dispatch-tick: campanha HALTADA` com o
  `haltReason`.

**Passa se:** `status` vira `halted` (não `paused`); o resume **sem**
`acknowledgeHalt: true` é **recusado** (a API devolve erro, a campanha
continua `halted`); o resume **com** `acknowledgeHalt: true` funciona e a
campanha retoma de onde parou (não reenvia os já enviados).

**Falha se:** a campanha for para `paused` em vez de `halted`, ou se o
resume sem reconhecimento for aceito.

---

## 4. 🔴 Opt-out registrado durante a execução é honrado no envio seguinte — CRITÉRIO DE BLOQUEIO DE RELEASE

Este é o item que decide se a fase fecha. Se falhar, **não fecha**, mesmo
que todo o resto esteja perfeito.

**O que fazer:** com a campanha rodando e **ainda tendo alvos `pending`**,
escolha um alvo que **ainda não foi processado** (veja no banco:
`SELECT id, "leadId", "phoneE164" FROM campaign_targets WHERE "campaignId" =
'<id-campanha>' AND status = 'pending' ORDER BY "scheduledFor" LIMIT 5;`) e
registre um opt-out para o telefone dele **antes** que o motor chegue a ele:
- Pela tela (se existir ação "marcar como opt-out" na lista de leads), ou
- `POST /api/v1/optouts` com `{ "phoneE164": "<o telefone escolhido>" }`.

**O que observar:**
```sql
SELECT id, status, "skipReason" FROM campaign_targets WHERE id = '<id-do-alvo>';
```

**Passa se:**
- **Imediatamente** (na mesma operação do opt-out, não no próximo tick): o
  alvo já vira `status='skipped'`, `skipReason='opted_out'` — isto é efeito
  retroativo direto da rota de opt-out (`§6.7` item 4), nem precisa o motor
  rodar de novo.
- Confirme também que, se o motor **já** estava processando aquele alvo
  quando o opt-out foi criado (corrida rara), o guard (`evaluateSendGuard`)
  bloqueia igual — a consulta de opt-out é feita **a cada envio**, nunca em
  cache (`§6.7` item 1). Não há como forçar essa corrida de propósito sem
  instrumentação; se você não conseguir provocá-la, não é reprovação — é só
  um cenário que o teste automatizado (`messages.test.ts`/
  `dispatch-tick.job.test.ts`) já cobre por fora.
- Nenhuma mensagem chega no telefone que você acabou de opt-out.

**Falha se:** o alvo continuar `pending` depois do opt-out, ou (pior) uma
mensagem chegar no telefone depois do opt-out registrado. Se isto acontecer,
**pare o motor imediatamente** (pausa global) antes de investigar.

---

## 5. Retomada sem duplicar (matar o worker no meio do disparo, subir de novo)

O código já tem um teste automatizado que simula EXATAMENTE esta janela de
corrida de forma determinística
(`apps/worker/src/jobs/dispatch-tick.job.test.ts`, describe "retomada sem
duplicar") — contra um banco falso. O que este item prova que aquele teste
não pode: que a mesma garantia (`Message.campaignTargetId @unique`,
`packages/db/prisma/schema.prisma:1062`) segura de verdade contra o
Postgres real, com uma transação real fazendo rollback de verdade, e que
nenhuma segunda mensagem chega no **celular real** de teste.

**A dificuldade:** a janela exata onde matar o worker é **entre** o
write-ahead (grava `Message(status='queued')`, ARQUITETURA §4.9.5) e a
resposta do `sendText` — no caminho normal isso dura frações de segundo
(tempo de rede até a Evolution). Matar "no olho" quase certamente erra a
janela (mata antes, sem `Message` nenhuma gravada — não prova nada; ou mata
depois, com a mensagem já enviada — também não prova nada).

**Como alargar a janela de propósito (recomendado):**
1. Escolha **uma** das duas instâncias de teste e, só para ela, torne a
   Evolution um pouco lenta — reaproveite exatamente a técnica do item 6
   abaixo (proxy com delay), mas com um delay **menor** (5s é suficiente, não
   precisa dos ~15s que forçam timeout). Isso não é gambiarra: é a mesma
   ferramenta, só com o dial em outro ponto.
2. Com a campanha enviando por essa instância, fique de olho no banco (um
   `watch` de terminal ajuda):
   ```sql
   SELECT id, status, "providerMessageId" FROM messages
   WHERE "campaignTargetId" = '<id-do-proximo-alvo-esperado>';
   ```
3. No instante em que a linha aparecer com `status='queued'` e
   `providerMessageId IS NULL` — **essa é a janela** — mate o processo do
   worker com `docker kill` (não `docker stop`: stop tenta um shutdown
   gracioso que pode esperar o `sendText` terminar, o que é o oposto do que
   você quer aqui).
4. Suba o worker de novo (`docker start`, ou deixe o orquestrador do
   EasyPanel reiniciar).
5. Espere o `DISPATCH_LEASE_S` (120s por padrão) expirar e o motor reclamar
   o alvo.

**O que observar depois:**
```sql
SELECT id, status, "skipReason", attempt FROM campaign_targets WHERE id = '<id-do-alvo>';
SELECT id, status, "providerMessageId" FROM messages WHERE "campaignTargetId" = '<id-do-alvo>';
```

**Passa se:**
- **Nenhuma segunda mensagem chega no celular de teste** — este é o único
  critério que o item realmente exige, e é o único que importa de verdade.
- O log do worker mostra, na retomada, uma tentativa que **não** chama
  `sendText` de novo para este alvo (pode aparecer como um erro
  logado — isso é esperado, ver nota abaixo — só não pode haver um segundo
  `sendText`).

**O que você provavelmente vai ver, e não é reprovação:** a `Message`
original fica **presa em `status='queued'` para sempre** (nunca resolve para
`sent`/`failed`), e o `CampaignTarget` eventualmente vira
`status='failed'`, `skipReason='max_attempts'` depois de
`DISPATCH_MAX_ATTEMPTS` (3) tentativas de reclamar o mesmo alvo — cada uma
batendo no índice único e sendo descartada. Isto é uma dívida técnica **já
aceita e documentada** antes deste motor existir (`ARQUITETURA.md §9.2`,
dívida **D8**, herdada do envio manual desde a Fase 3) — a mensagem "fica
visível, presa em `queued`" é o preço aceito para nunca duplicar. Não é o
motor reimplementando nada errado; é o mesmo comportamento do envio manual,
herdado sem reescrita (que é exatamente o que `§6.8.0` exige). Só **anote**
quantas tentativas levou até resolver, para comparar com a expectativa
(`DISPATCH_MAX_ATTEMPTS × DISPATCH_LEASE_S` ≈ 6 minutos com os defaults).

**Falha se:** uma segunda mensagem chegar no celular de teste. Só isso.

---

## 6. Incerto não vira mensagem dobrada (Evolution lenta, timeout forçado)

**Não existe hoje um jeito com um único clique/env para isto** — procurei no
código (`packages/messaging/src/client/http.ts`, timeout default 15s,
hardcoded, sem variável de ambiente que o exponha para o caminho de envio de
produção) e não há um `EVOLUTION_TIMEOUT_MS` nem equivalente que dê para
baixar antes do teste. A forma limpa que encontrei — sem derrubar a
Evolution, como pedido — precisa de uma peça extra de infraestrutura:

**Método recomendado — proxy com delay, sem tocar na Evolution:**
1. Suba um proxy TCP/HTTP trivial (ex. `toxiproxy`, ou até um script Node de
   3 linhas com `http-proxy` + `setTimeout`) na mesma rede Docker da
   Evolution, configurado para encaminhar para a Evolution real depois de
   esperar **~16-20 segundos** (acima do timeout de 15s do cliente).
2. Aponte **uma única** instância de teste para esse proxy: no banco,
   `EvolutionServer.baseUrl` daquela instância (ou crie um `EvolutionServer`
   novo apontando pro proxy e mova só a instância de teste para ele) —
   **não** mexa na instância que está sendo usada para os outros itens, para
   não misturar os testes.
3. Rode a campanha nessa instância. O `sendText` vai estourar o timeout de
   15s → `MessagingError('TIMEOUT', ...)` → `EVOLUTION_ERROR_EFFECT.TIMEOUT`
   classifica como `outcome: 'uncertain'` (`packages/sending/src/outcome.ts`).
4. Desfaça o apontamento (volte `baseUrl` para a Evolution real) e derrube o
   proxy ao terminar — não deixe essa peça de teste esquecida em produção.

**Se não quiser montar o proxy:** não há alternativa limpa. Desconectar a
internet do container da Evolution ou pará-la de propósito **derruba** o
serviço — isso testa o gatilho **diferente** ("Evolution fora do ar", §6.6,
que também está implementado, mas é OUTRO item, não este). Cortar
especificamente as respostas *sem* derrubar o processo exige controle de
rede (proxy, ou `tc netem`/regra de firewall que **descarte** pacotes de
saída do worker para o IP:porta da Evolution por alguns segundos, sem
bloquear o resto do tráfego) — ambos exigem acesso ao host/rede que o dono
provavelmente não tem pela UI do EasyPanel; isto é trabalho do Vulcano se o
dono não tiver esse acesso.

**O que observar:**
```sql
SELECT ct.status, ct."skipReason", i."consecutiveUncertain", i.status AS instancia_status
FROM campaign_targets ct
JOIN whatsapp_instances i ON i.id = '<id-instancia-lenta>'
WHERE ct.id = '<id-do-alvo>';

SELECT s."sentCount", s."failedCount" FROM instance_daily_stats s
WHERE s."instanceId" = '<id-instancia-lenta>' AND s.date = '2026-09-25';
```
E o log do worker, procurando (conforme repetir o teste 3x, 5x):
`dispatch-tick: instância fora da rotação neste ciclo` (3º incerto) e
`dispatch-tick: campanha HALTADA` com "incerto repetido" (5º incerto).

**Passa se:**
- Alvo termina `status='failed'`, `skipReason='EVOLUTION_SEND_UNCERTAIN'`
  (nunca volta a `pending`, nunca é retentado).
- `sentCount` do dia **não** volta atrás (a cota queimada permanece
  queimada — comparar antes/depois do incerto).
- Repetindo 3x seguidas na mesma instância: ela some da elegibilidade neste
  ciclo (próximo alvo dessa campanha vai para a outra instância, se houver).
- Repetindo 5x seguidas: a campanha vai para `halted` com `haltReason`
  contendo "incerto repetido".
- Nenhuma mensagem duplicada chega no celular — mesmo raciocínio do item 5:
  se o `sendText` chegou a sair antes do timeout do NOSSO lado (a Evolution
  processou mas a resposta demorou), o motor não vai saber e **não** vai
  reenviar. Isso é o comportamento correto, não um bug.

**Falha se:** o alvo voltar para `pending` e ser reenviado (duplicação), ou
se a cota voltar depois do incerto (furo de warmup), ou se os patamares
3/5 não dispararem.

---

## Registro do resultado

Para cada item 1-6 (+ 0.bis), anote: **passou / falhou / não observado
(motivo)**, data/hora, e qualquer log relevante. Devolva isto ao Atlas —
é o que fecha (ou reabre) a Fase 4.F no `PROGRESSO.md`. O item 4 é o único
que, sozinho, decide o fechamento da fase.
