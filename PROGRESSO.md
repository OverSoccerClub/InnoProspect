# PROGRESSO — InnoProspect

Estado do projeto entre sessões. **Leia antes de planejar qualquer coisa.**

Última revisão completa: **2026-09-23** (auditoria do Órion + inventário de
testes da Íris + parecer de arquitetura da Nova, consolidados pelo Atlas).

Este arquivo descreve o que **é**, não o que se pretendia. Se ele divergir do
código, o código vence e este arquivo está com defeito — corrija-o na hora.
Ele já esteve errado antes: até 23/09 ainda dizia "nada em produção, nunca
coletou um lead", três dias depois de o sistema estar coletando.

---

## ⚠️ Estado atual em uma linha

**Em produção e operando.** O ciclo busca → coleta → leads → template → envio
manual funciona ponta a ponta contra dado real. O que falta não é fazer
funcionar; é **volume** (campanhas) e **saber quando quebra** (alertas).

---

## O que está provado em produção

- Coleta real do Google Maps: ~260 leads com telefone, endereço, categoria e
  avaliação, em buscas por nicho × município.
- Login, painel, listagem com filtros/paginação/exportação CSV, ficha do lead,
  templates com spintax, instâncias de WhatsApp, descadastro público.
- Fila BullMQ + worker consumindo, com retry, backoff e **auto-pausa** em
  suspeita de bloqueio ou mudança de layout.
- Migrações aplicadas, seed de 27 UFs e ~5.570 municípios do IBGE.

## Provado em 23/09/2026 — o ciclo de mensagem fecha

**Mensagem fria enviada para um lead real, entregue, e resposta chegando de
volta ao sistema.** Isso encerra a condição principal da objeção da Nova à
Fase 4 (ver `ARQUITETURA.md §8`). A última perna foi confirmada em **24/09**:
**responder "SAIR" criou o registro de descadastro**. O portão está fechado —
o motor pode ser construído.

Custou três incidentes em sequência, todos na mesma integração, e vale ler os
três juntos porque o padrão é mais útil que cada um:

1. **QR ilegível** — a tela pedia código novo a cada 2s contra um endpoint que
   reinicia o pareamento; o código morria antes de dar tempo de escanear.
2. **Credencial em dois NÍVEIS** — a Evolution tem chave global do servidor
   *e* chave por instância. Só a primeira era conhecida.
3. **Credencial em dois CANAIS** — a mesma chave pode vir no cabeçalho *ou* no
   corpo do evento. Só o cabeçalho era lido, e o campo do corpo nem estava
   declarado no schema: era descartado antes de qualquer comparação.

**O que tornou os três solucionáveis foi uma decisão pequena:** fazer a
recusa do webhook registrar o MOTIVO no log (mantendo a resposta HTTP
genérica, para não virar oráculo). Antes disso o sintoma era "nada acontece",
que não dá pista de onde procurar. Regra que fica: autenticação fail-closed
com resposta genérica precisa de log que diga o motivo real.

## Consertado em 24/09/2026 — a tela deixa de jurar que o número está conectado

Bug reportado pelo dono: número desconectado continuava aparecendo como
**Conectado**. A causa não era um `if` errado — era a **ausência de alguém que
voltasse a perguntar**. A leitura de status só gravava no banco na transição
PARA `connected`; o único caminho que tirava uma instância desse estado era o
webhook `connection.update`. Webhook é, por definição, um caminho que pode
perder evento — e perdeu.

O que mudou, e por que importa além deste bug:

- A transação completa de conexão (status + kill switch de campanhas +
  alerta) saiu do webhook para **um corpo único**
  (`apps/web/src/lib/services/instance-connection.ts`). O comentário antigo
  que justificava não reconciliar estava certo no medo e errado no alvo: o
  risco nunca foi "ler de novo", foi ter uma **segunda implementação** da
  transição. Agora o evento que chega e a pergunta que fazemos executam o
  mesmo código.
- `WhatsAppInstance.statusCheckedAt` responde "**desde quando** eu sei disso"
  — nunca "quando mudou". A listagem reconcilia sozinha as instâncias
  `connected` com leitura mais velha que 60s, em paralelo e com timeout; se a
  Evolution estiver fora do ar, **o campo não avança** e a tela diz isso.
- Direção segura é assimétrica de propósito: subir para `connected` sempre
  vale; derrubar só quando a Evolution diz `disconnected` explícito e o banco
  achava `connected`. `connecting` reflete o estado sem haltar campanha
  (é a Evolution reconectando sozinha); `qr_pending` não se toca.
- "Verificar agora" devolve `unconfirmed`: quantas instâncias **não** deram
  para confirmar. A rota responde `200` mesmo com a Evolution inacessível —
  sem esse contador, "não deu erro" e "eu confirmei" seriam a mesma resposta,
  e o botão daria sucesso silencioso. É também o único jeito de expressar
  sucesso **parcial** (3 de 4).

**Regra que fica:** estado espelhado de sistema externo que só é atualizado
por evento empurrado precisa de um caminho que **volte a perguntar** — e de um
campo que diga desde quando a resposta é válida. Sem o segundo, a
reconciliação troca uma mentira por outra mais discreta.

Pendente de olho humano: a geometria do selo de frescor no card de instância
(390px). Não medida em navegador — o token do harness de demonstração venceu e
não há E2E no repositório.

## Construído em 25/09/2026 — a Fase 4 fecha em código

O motor de disparo existe. Em ordem, e a ordem foi deliberada:

- **`@inno/sending`** — o caminho de envio saiu do `apps/web` para um pacote
  que os dois processos importam. `grep` de `.sendText(` em todo o repositório
  fora de teste: **uma** ocorrência. O invariante "nada entre a leitura de
  opt-out e o guard" sobreviveu à mudança de casa — foi ele, aliás, que
  definiu onde o pacote começa e termina.
- **O freio, antes do acelerador.** Pausa global persistida, com semântica
  **invertida de propósito**: ausência da chave = PAUSADO. Redis limpo,
  deploy novo, restart — tudo devolve o sistema ao estado seguro, nunca ao
  estado disparando.
- **Quatro peças puras no core** (`resolveSendPolicy`, `localDateKey`,
  `resolveCampaignWindow`, `pickInstanceWeighted`). A terceira implementa o
  invariante **A32**: configuração de campanha só **estreita** limite de
  segurança, nunca alarga. Três campos de campanha estavam gravados, exibidos
  na tela e lidos por ninguém na hora de enviar — o motor é o primeiro
  consumidor deles.
- **O tick** — claim por lease com `SKIP LOCKED` (sem status `sending`),
  write-ahead protegido pelo índice único que amarra a mensagem ao alvo,
  tradução exaustiva **em tipo** do veredito do guard, halts e conclusão de
  campanha.
- **Os periódicos** — `warmup-roll` (sem ele o `warmupDay` nunca avança e todo
  número fica preso em 20/dia para sempre), a fatia do `health-check` que
  **para**, e o `regressWarmupDay`, escrito e **sem chamador desde a Fase 3**,
  finalmente ligado.
- **A tela do freio**, que a 4.F.3 prometia e não tinha entregue — o Atlas
  aceitou aquela fase sem conferir esse pedaço, e a Íris achou auditando.

**A decisão que mais importa, e o porquê dela:** timeout da Evolution não é
falha, é *"pode ter chegado"*. Então o alvo vira falha **terminal** e nunca é
retentado, e a cota **não** volta. Reagendar é a única forma de mandar a mesma
abordagem duas vezes para a mesma pessoa; devolver cota que talvez saiu é
furar o aquecimento sem ninguém ver. Como isso abre a porta para uma Evolution
agonizante queimar cota às cegas, há um contador separado: 3 incertos seguidos
tiram o número da rotação, 5 param a campanha.

**Decisão de canal, do dono (25/09):** manter a Evolution (não-oficial) em vez
de migrar para a API oficial. Consequência que precisa estar escrita: a API
oficial exige opt-in do destinatário, e prospecção fria em número coletado do
Maps é exatamente o que ela proíbe. Logo, **as mitigações deste motor
substituem a proteção que a API oficial daria** — aquecimento, jitter,
micro-pausa, janela, cooldown, descadastro e kill switch não são capricho de
engenharia. Uma delas pela metade é o número do dono sendo banido.

**O que os 862 testes NÃO provam** (auditoria da Íris, `ACEITE-FASE-4.md`):
claim concorrente, a violação do índice único como garantia anti-duplicata e a
atomicidade das transações estão provados **na forma**, contra banco falso.
Nada rodou contra Postgres, Redis ou Evolution reais. O aceite de verdade é o
roteiro daquele arquivo, executado com dois números.

## O que existe mas nunca foi exercitado de verdade

- **Restore de backup.** Configurado, nunca restaurado.
- **`prisma migrate deploy` em CI.** O `ci.yml` diz isso em comentário: a
  `DATABASE_URL` de lá é placeholder.

## O que não existe

- ~~Fase 4 — campanhas e motor de disparo.~~ **Construída em 25/09** (ver a
  seção acima). O que continua não existindo dela: nada de código. O que falta
  é **execução**: o aceite com Evolution real (`ACEITE-FASE-4.md`) e a revisão
  do Órion (4.H).
- **Alertas ligados.** `ALERT_WEBHOOK_URL` está vazia: o módulo de alerta está
  escrito e testado, e morto por falta de uma variável. Pior: `apps/web` não
  emite alerta nenhum — instância caindo, Evolution fora e campanha parada são
  todos silenciosos.
- **`DELETE /leads/:id`**, retenção de `RawCapture`, gestão de usuários com
  tela, reset de senha por e-mail.

---

## Riscos conhecidos, em ordem

1. 🔴 **Ninguém é avisado quando quebra — e a condição que tornava isso
   tolerável ACABOU.** Este item dizia, até 24/09, que o silêncio era
   aceitável "enquanto nada age sozinho, e deixa de ser no minuto em que o
   motor de disparo existir". O motor existe desde 25/09. O sistema agora
   manda mensagem sozinho, degrada instância sozinho e **para campanha
   sozinho** — e `ALERT_WEBHOOK_URL` continua vazia, então todos esses eventos
   acontecem sem ninguém ficar sabendo. É a menor tarefa em aberto do projeto
   e a de maior retorno; passou a ser o risco número um por mérito próprio,
   não por falta de concorrência.
2. **`RawCapture` acumula sem prazo.** O schema documenta um `retention.job`
   que nunca foi escrito. Recomendação da Nova: **dropar a tabela** (zero
   referências no código; ela foi desenhada para depurar exatamente a falha de
   extração que aconteceu esta semana e não estava lá quando foi necessária).
   Se mantida, a escrita e o job de retenção entram na mesma entrega.
3. **`X-Forwarded-For` confiado sem confirmar o proxy do EasyPanel.** Se o
   proxy não sobrescrever o header, o rate limit de login e o das rotas
   públicas viram teatro. Conferência de 10 minutos, não código.
4. **Fanout de busca sem teste** (`apps/web/src/lib/services/searches.ts`, 283
   linhas, zero cobertura) e **camada HTTP sem teste de contrato**.
5. **`rate-limit.ts` é em memória por processo** — correto com 1 réplica,
   furado com 2. **Nunca escalar o `web` para 2 réplicas.**

---

## Próximos passos, na ordem recomendada

### Bloco 0 — Medir e provar (sem código)
1. **Ler a taxa de celular** no painel, filtrando por uma busca posterior ao
   commit `3da386d` (antes dele o telefone faltava por bug, não por ausência).
   Abaixo de 25% reordena tudo: coleta de detalhe vira prioridade e a Fase 4
   espera.
2. **Fechar o ciclo real de envio:** mensagem fria para um número que nunca
   escreveu → `Message` com `providerMessageId` → status vira `delivered`
   (prova que o webhook volta) → responder "SAIR" e ver o opt-out aparecer.
3. **Ligar `ALERT_WEBHOOK_URL`.** Melhor retorno por esforço do projeto.

### Bloco 1 — Tornar a falha audível e a base recuperável
Restore testado · monitor externo batendo em `/api/v1/health` · alerta
estendido ao `apps/web` · `--selftest` do worker no CI e como healthcheck do
container · assertion de sanidade por **taxa de preenchimento**, não só por
contagem.

### Bloco 2 — Cadência no caminho que já funciona (4.A + 4.B + 4.C)
Antes do motor, de propósito: o portão de ritmo estreia com volume 1 e um
humano olhando, e o motor o herda exercitado. Também conserta um risco que já
existe hoje — não há freio nenhum no envio manual.

### Bloco 3 — Campanha sem motor (4.D + 4.E)
Entrega valor mesmo se o motor nunca sair: montar público, ver as exclusões
discriminadas por motivo, disparar com cadência.

### Bloco 4 — O motor (4.F ✅ → 4.G → 4.H ✅)
**4.F está construída** (25/09, ver a seção do marco). Restam as duas pernas
que não são código:
- **4.G** — executar `ACEITE-FASE-4.md` com Evolution real e 2 números. Um dos
  6 itens é 🔴 critério de bloqueio de release (opt-out honrado durante a
  execução). Dois itens exigem acesso a shell/rede: forçar timeout precisa de
  um proxy com atraso entre o worker e UMA instância de teste — o timeout do
  cliente HTTP é fixo no código, não há variável que o exponha.
- ~~**4.H** — revisão do Órion.~~ **Fechada em 26/09: 0 `critical`, 0 `high`,
  1 `medium`.** Veredito: *a Fase 4 pode ser liberada para disparar contra
  leads reais.* O que ele confirmou por conta própria, e não por confiar no
  relato: o portão único sem segunda implementação nem caminho de bypass; a
  sequência protegida (opt-out → guard → write-ahead → `sendText`) com
  **nenhum `await`** entre a leitura de opt-out e o guard; a constraint única
  como garantia anti-duplicata, exercitada pelo único caminho de escrita; o
  freio fail-closed com gate de papel real; nenhum segredo em log nos caminhos
  novos; e o descadastro honrado em dupla camada (no `start` e em runtime).
  Confirmou também que o conserto do `nextSendAllowedAt` (Fase 4.C)
  sobreviveu à chegada do segundo escritor concorrente — exatamente o cenário
  que ele havia previsto como crítico quando o motor existisse.

  **O achado `medium`, com gatilho datado:** a checagem "este lead já
  respondeu hoje?" (`webhook.ts#recordInstanceResponseIfFirstToday`) é um
  read-then-write sem lock nem constraint, em Read Committed. Duas mensagens
  do mesmo lead chegando quase juntas podem contar 2 em vez de 1. **Não
  bloqueia o go-live**: hoje `respondedCount` só alimenta um card de tela, e
  nenhuma decisão de negócio (guard, kill switch, warmup) o lê. **Mas precisa
  ser consertado ANTES da heurística de taxa de resposta (§6.2, Fase 5/6)**,
  que é justamente quem vai passar a ler esse número para decidir se uma
  instância está saudável. Contador inflado ali degrada a decisão.
  Receita já existe no mesmo arquivo: `registerOptOutFromInbound` resolve a
  mesma classe de corrida com constraint única + captura de `P2002`.

Só então a primeira campanha real, com **20-30 alvos em um número**, não 50 em
dois.

### Bloco 5 — Camada de tendência (Fase 5, `ARQUITETURA.md §8.9`)
Ideia do dono (23/09): usar o Google Trends para escolher **em que UF**
prospectar, em vez de decidir no escuro. O sinal escolhe onde e que perfil,
nunca quem — alta busca por "criação de sites" no CE significa mirar empresas
**sem site** no CE, não empresas que fazem sites (essas são concorrentes).

Invariante: **tendência é conselho, nunca engrenagem** — se o Trends quebrar, a
coleta segue idêntica. Entrega mínima: expor os filtros que já existem e ninguém
vê (`hasWebsite`, `phoneType`, `minRating`), somar o filtro de nº de avaliações
que falta, e só então o ranking por UF.

Validar antes de construir: uma busca escolhida pelo Trends contra uma escolhida
no escuro, comparando fechamento.

### Bloco 6 — Abordagem gerada por IA (Fase 6, `ARQUITETURA.md §8.10`)
Ideia do dono (23/09). Correção de premissa registrada lá: **IA não reduz
banimento por si** — variação de texto é a alavanca mais fraca das três, e o
spintax já cobre. O ganho é indireto e maior: mensagem ancorada no dado do lead
é respondida, e conversa respondida é o oposto de spam.

O risco que domina a fase é **alucinação**, não estilo: detalhe inventado numa
abordagem fria é pior que mensagem genérica. Mitigação estrutural — só campos
coletados na entrada, validadores duros na saída.

Invariantes: **IA é conselho, nunca engrenagem** (falhou, cai no spintax) e
geração **na montagem da campanha, nunca no envio** (auditoria antes de sair).
Começa pelo assistente na ficha do lead, não pelo lote.

### Depois
`DELETE /leads/:id` · configurações re-escopadas para diagnóstico operacional ·
testes de `searches.ts` e da camada HTTP.

---

## Decisões em aberto (dependem do dono)

1. Para onde apontar o `ALERT_WEBHOOK_URL` (Slack, Google Chat, outro).
2. `RawCapture`: dropar ou ligar com retenção junto.
3. Quantos números de WhatsApp entram na rotação (afeta a Fase 4).
4. Qual a taxa de celular medida — é o portão do Bloco 0.

**Fechada, não reabrir:** o produto é de **uso próprio**, sem multi-tenancy e
sem cobrança (decidido em 22/09).

---

## Rodar localmente para avaliar (sem banco)

Não há Postgres nem Redis nesta máquina. O modo de avaliação visual usa mocks:
`NEXT_PUBLIC_USE_MOCKS=true`, com um cookie de sessão assinado localmente. O
gate de mock exige também `inno_mock_session=1`.

⚠️ **Nunca suba um segundo `next dev`/`next build` em `apps/web`** — o `.next`
é compartilhado por diretório, e isso já derrubou o ambiente duas vezes.

---

## Invariantes — não reabrir sem motivo forte

- **Fonte:** scraping próprio. **Canal:** Evolution API. **Stack:** Next 15 + TS
  + Prisma + Postgres.
- **Descadastro é por telefone** e checado imediatamente antes de cada envio. O
  guard **lança** se a checagem tiver mais de 5s: é impossível cachear.
- **Um único ponto de chamada ao `sendText`** em produção
  (`apps/web/src/lib/services/messages.ts`). Mais de um é um segundo caminho sem
  portão.
- **`sendText` nunca é retentado automaticamente.** Retry de transporte é decisão
  por operação: retentar um envio pode duplicar a mensagem no WhatsApp do lead.
  Timeout é resultado **incerto** ("Não confirmada" na tela), não falha.
- **Seletores do Maps em um arquivo; Evolution API só em `packages/messaging`.**
- **Re-scraping nunca sobrescreve dado humano** (`buildMachineUpdate` lança).
- **Contadores incrementados, nunca `COUNT(*)`.**
- **`halted` ≠ `paused`. Pausa por mudança de layout só sai por decisão humana.**
- **Modo degradado é difícil de ativar, nunca o padrão** (`USE_MOCKS` é opt-in).
- **CSP de produção sem `unsafe-eval`**; a liberação existe só em `NODE_ENV=development`.
- **Rate limit de login conta só falhas**; sucesso zera o e-mail, nunca o IP.
- **Nome de fila do BullMQ não pode conter `:`** — derruba o worker no boot.
- **`offNiche` é relativo à busca de ORIGEM do lead**, nunca à que o recoletou.

## Armadilhas já pagas (não repetir)

- **`DateTime` do Prisma é `TIMESTAMP` sem fuso, gravado em UTC.** SQL cru por dia
  de São Paulo exige `AT TIME ZONE` duplo. Mock de `$queryRaw` prova forma, nunca fuso.
- **CI verde não é portão do artefato de produção.** Os cinco incidentes de
  22-23/09 passaram por typecheck, lint, testes e `next build` — nenhum deles
  olha para a imagem que sobe. Todo processo empacotado precisa de auto-teste
  dentro da própria imagem.
- **Espelho de sistema externo atualizado só por evento empurrado mente para
  sempre quando um evento se perde.** Precisa de reconciliação E de um campo
  de "confirmado quando" — ver o conserto de 24/09.
- **Sanidade medida só por volume não pega falha de completude.** As assertions
  não dispararam quando 260 leads vieram só com o nome.
- **Script operacional precisa ser entrada do bundle.** A imagem do worker não
  tem `pnpm`, nem `tsx`, nem `src/`. Instrução de uso é `node dist/...`.
- **Versão do Playwright no `package.json` e a tag da imagem base andam juntas**
  — há guarda de build que reprova se divergirem.
- **`Locator.isVisible({timeout})` do Playwright ignora o timeout.** Métodos de
  snapshot não esperam; ações esperam.
- Bugs que só aparecem em `next build`: componente como prop de Server→Client;
  middleware Edge + Prisma; imports `.js` sem `transpilePackages`.
- **O middleware intercepta qualquer rota nova de `app/`** — asset novo entra na
  exceção do matcher E se confirma com `curl -D -`.
- `COPY` de pacote do workspace esquecido no Dockerfile não quebra o `pnpm install`;
  há guarda nos dois Dockerfiles. `apps/web/public/.gitkeep` precisa existir.
- pnpm em Docker exige `--shamefully-hoist`.
- `node node_modules/.bin/tsx` não funciona (é shell script).
- E-mail do admin gravado em minúsculas.
- `next build` falha no Windows no passo `standalone` (EPERM de symlink): é o SO.
- `git grep` só busca arquivos versionados; arquivo novo precisa de busca no disco.
