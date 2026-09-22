# PROGRESSO — InnoProspect

Sistema de prospecção B2B: filtra empresas por **setor/nicho + UF**, coleta os
contatos no Google Maps e aborda os leads por **WhatsApp**, com descadastro e
anti-ban.

- **Repositório:** github.com/OverSoccerClub/InnoProspect
- **Produção:** EasyPanel (projeto `inno-prospect`)
- **Documentos:** `ARQUITETURA.md` (v1.1) · `DEPLOY.md` · `DESIGN-SYSTEM.md` ·
  `REVISAO-ARQUITETURA.md` · `REVISAO-QA.md`
- **Última atualização:** 2026-09-22

---

## ⚠️ Estado atual em uma linha

O código evoluiu muito, mas **nada disso está no GitHub nem em produção**: o push
está bloqueado (credencial do GitHub expirada nesta máquina; `git status -sb`
mostra quantos commits estão à frente do remoto) e a produção devolve **404 em todas as rotas** desde pelo menos
2026-09-22. O sistema **nunca coletou um lead real nem enviou uma mensagem real**.

---

## Por área

| Área | Situação |
|---|---|
| Landing pública com hero, painel premium, identidade visual | ✅ Pronto (v3) |
| Coleta (busca por nicho/UF, scraper, fila, sanidade, pausa, heartbeat) | ✅ Escrito e testado · ❌ nunca rodou de verdade |
| Lista e ficha de leads | ✅ Pronto |
| WhatsApp: conectar número, templates, descadastro público | ✅ Pronto |
| **Envio de mensagem individual** (contrato §4.9) | ✅ Pronto (2026-09-22) · ❌ nunca rodou contra Evolution real |
| **Conversa na ficha do lead** | ✅ Pronto |
| Alertas por webhook, limite de tentativas no login | ✅ Pronto |
| **Campanhas e motor de disparo em massa** | ❌ Não existe |
| Gestão de usuários, recuperação de senha, configurações | ❌ Não existe |
| LGPD: retenção e exclusão a pedido | ❌ Não existe |

**Testes:** 340 (core 130, web 108, messaging 49, scraper 35, worker 11,
contracts 7). `pnpm test` na raiz roda tudo.

---

## Commits de 2026-09-22 (todos só locais)

| Commit | O quê |
|---|---|
| `6eae2d1` | Landing pública com hero e painel com abertura |
| `167ac18` | Painel premium v2 + `GET /api/v1/dashboard/summary` + correção de fuso no SQL |
| `49fe809` | Layout v3 + CSP com `unsafe-eval` só em dev |
| `217724e` | Índices do painel |
| `1c8c086` | Alertas por webhook + limite de login + `DEPLOY.md` com `OPTOUT_TOKEN_SECRET` |
| `838bdbd` | **Primeiro envio de WhatsApp** + conversa na ficha do lead |

---

## Próximos passos, em ordem

### 1. Destravar (ações do dono, sem código)
1. **Push:** `git -C C:\Projetos\Web\InnoProspect push origin main` (abre o login
   do GitHub; depois disso os próximos pushes voltam a funcionar).
2. **Produção:** o domínio do `frontend` devolve 404 vazio em tudo, o que indica
   o proxy do EasyPanel sem serviço atendendo (serviço parado, domínio trocado ou
   deploy que não subiu). Conferir no painel.
3. **Redis:** no último diagnóstico o `web` não conectava. O `/api/v1/health`
   agora mostra em `checks.redis.target` para onde tentou conectar.
4. **Worker** (`inno-prospect-backend`) nunca subiu.
5. **Variáveis novas no EasyPanel**, antes do primeiro envio real:
   `OPTOUT_TOKEN_SECRET` (**obrigatória**: sem ela o descadastro público recusa
   todos os links) e `APP_COMPANY_NAME` no `frontend`; `ALERT_WEBHOOK_URL`
   (opcional) no `worker`. Ver `DEPLOY.md`.
6. **Backup** ativado e **restore testado** (`infra/backup/README.md`).

### 2. Primeira busca real
"clínica odontológica" em Campinas-SP. Medir **% com telefone** e **% de
celular**: os cortes do `ARQUITETURA.md §8.3` decidem se `scrape-detail` vira
requisito.

### 3. Primeiro envio real
Um envio manual pela ficha do lead, conferindo na Evolution real o que só foi
testado com mock (formato do QR, `messageTimestamp`, códigos de erro).

### 4. Fase 4: campanhas e motor de disparo
Público, template, números e janela; `dispatch-tick` com
`FOR UPDATE SKIP LOCKED`; aquecimento; rotação; jitter; kill switch. **Herda o
guard de envio** que já está em produção no envio unitário.
**Pendência do Órion para esta fase:** o endpoint unitário não tem jitter nem
limite por lead/instância; comparar com o ritmo do motor.

### 5. Depois
Exportar CSV · ações em massa · gestão de usuários · recuperação de senha ·
configurações · LGPD (retenção, exclusão) · testes de ponta a ponta · polimento
das telas de Buscas.

---

## Decisões em aberto (dependem do dono)

1. **Uso próprio ou venda para clientes?** A mais estrutural. Se for vendido,
   entra um bloco inteiro: conta por cliente com dados isolados, planos e
   cobrança. Afeta o banco e a gestão de usuários, que por isso está esperando.
2. **Horário de envio:** piso 08:00–20:00, sem domingo (§4.9.6), configurável só
   para **estreitar**.
3. **Quantos números de WhatsApp.**
4. **Descadastro na 1ª mensagem:** "responda SAIR" ou link público.
5. **Canal de contato da landing** (nenhum foi inventado).
6. **Serviço de e-mail** (necessário para recuperação de senha).
7. **HTTPS no painel do EasyPanel** (acessado por IP, sem criptografia).

---

## Rodar localmente para avaliar (sem banco)

Há um servidor de demonstração configurado em `.claude/launch.json` (fora do git),
com `NEXT_PUBLIC_USE_MOCKS=true`. Mostra **dados de exemplo**. Como não há banco,
o login pela tela não funciona: o Atlas gera uma sessão local com um segredo
descartável e a coloca no navegador do app (procedimento da Lyra em
`.claude/agent-memory/lyra/convention_test_session_cookie.md`).

⚠️ Com o servidor de dev ligado, `pnpm typecheck` na raiz e o build falham no
Windows (o `next dev` trava o binário do Prisma). Desligue o servidor antes da
validação completa.

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

## Armadilhas já pagas (não repetir)

- **`DateTime` do Prisma é `TIMESTAMP` sem fuso, gravado em UTC.** SQL cru por dia
  de São Paulo exige `AT TIME ZONE` duplo. Mock de `$queryRaw` prova forma, nunca fuso.
- Bugs que só aparecem em `next build`: componente como prop de Server→Client;
  middleware Edge + Prisma; imports `.js` sem `transpilePackages`.
- `COPY` de pacote do workspace esquecido no Dockerfile não quebra o `pnpm install`;
  há guarda nos dois Dockerfiles. `apps/web/public/.gitkeep` precisa existir.
- pnpm em Docker exige `--shamefully-hoist`.
- `node node_modules/.bin/tsx` não funciona (é shell script). Localmente o Node 24
  executa `.ts` direto.
- E-mail do admin gravado em minúsculas.
- `next build` falha no Windows no passo `standalone` (EPERM de symlink): é o SO.
- `git grep` só busca arquivos versionados; arquivo novo precisa de busca no disco.
