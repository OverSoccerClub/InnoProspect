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

## O que existe mas nunca foi exercitado de verdade

- **Restore de backup.** Configurado, nunca restaurado.
- **`prisma migrate deploy` em CI.** O `ci.yml` diz isso em comentário: a
  `DATABASE_URL` de lá é placeholder.

## O que não existe

- **Fase 4 — campanhas e motor de disparo.** Contrato pronto
  (`campaign.contract.ts`, 244 linhas) e `campaign-targets.ts` já em produção,
  mas o schema de cadência (3 colunas em `WhatsAppInstance`, 2 em
  `CampaignInstance`) e o motor não existem.
- **Alertas ligados.** `ALERT_WEBHOOK_URL` está vazia: o módulo de alerta está
  escrito e testado, e morto por falta de uma variável. Pior: `apps/web` não
  emite alerta nenhum — instância caindo, Evolution fora e campanha parada são
  todos silenciosos.
- **`DELETE /leads/:id`**, retenção de `RawCapture`, gestão de usuários com
  tela, reset de senha por e-mail.

---

## Riscos conhecidos, em ordem

1. **Ninguém é avisado quando quebra.** Todo incidente desta semana foi
   descoberto pelo dono olhando log ou tela. Isso é aceitável enquanto nada
   age sozinho — e deixa de ser no minuto em que o motor de disparo existir.
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

### Bloco 4 — O motor (4.F → 4.G → 4.H)
Primeira campanha real com **20-30 alvos em um número**, não 50 em dois.

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
