---
name: feedback-playwright-chromium-version-pin
description: Incidente de produção (2026-09-22) — todo scrape falhava com BROWSER_CRASH por divergência entre o playwright do npm e o Chromium da imagem base; causa raiz, correção e guarda de build.
metadata:
  type: feedback
---

## O incidente (2026-09-22)

Toda `SearchTask` falhava em produção (EasyPanel), 3 tentativas, em todos os
municípios: `{"code":"BROWSER_CRASH","attempt":3,...,"err":"Falha ao iniciar
o Chromium"}`. Worker saudável no resto (Postgres, Redis, fila, retry) — só
`chromium.launch()` morria no boot.

**Causa raiz:** `packages/scraper/package.json` pedia `"playwright": "^1.49.1"`
(caret, sem trava). Um `pnpm install` de rotina resolveu `playwright@1.62.1`
no lockfile. `apps/worker/Dockerfile` usa
`mcr.microsoft.com/playwright:v1.49.1-jammy` como base — essa imagem só tem o
Chromium que a **1.49.1** espera em `/ms-playwright`. A 1.62 procura uma
revisão de Chromium que não existe ali → `browserType.launch` falha logo no
`executablePath`.

## Regra: nunca deixar `playwright` (npm) solto com `^` quando a imagem base é `mcr.microsoft.com/playwright:vX.Y.Z-<distro>`

**Por quê:** a imagem `mcr.microsoft.com/playwright:vX.Y.Z-*` embute o
Chromium (e as libs de sistema) DA VERSÃO X.Y.Z exata — não é retrocompatível
nem tolerante a versões próximas do pacote npm `playwright`. Um bump do
lockfile (mesmo sem qualquer intenção de mudar Chromium) quebra o boot do
worker inteiro, silenciosamente, até alguém rodar `pnpm install` sem pensar
nisso.

**Como aplicar:** em `packages/scraper/package.json`, `playwright` deve ser
uma versão EXATA (sem `^`/`~`), IGUAL ao `ARG PLAYWRIGHT_VERSION` de
`apps/worker/Dockerfile` (sem o prefixo `v`). Subir de versão é uma decisão
explícita: editar as DUAS pontas juntas, rodar `pnpm install`, e deixar a
guarda de build confirmar.

**Guarda de build (não confiar só na disciplina humana):** `apps/worker/Dockerfile`,
stage `deps`, logo após o `pnpm install`, tem um `RUN node -e "..."` que lê
`node_modules/playwright/package.json` e compara com `ARG PLAYWRIGHT_VERSION`
(despido do `v`) — falha o build, alto e claro, se divergirem. Mesmo espírito
da guarda de `@inno/*` que já existia no stage `build`. Ver [[infra_deploy_easypanel]]
e [[feedback_worker_ts_workspace_packages_runtime]] para o padrão geral de
guardas de build deste Dockerfile.

**Alternativas consideradas e descartadas:**
- Instalar o Chromium certo no build (`playwright install chromium` com
  `PLAYWRIGHT_BROWSERS_PATH`) sobrevive a bumps do lockfile, mas baixa
  binários pela rede DURANTE o build (novo ponto de falha) e pode não ter as
  libs de sistema (`apt`) que a imagem base só garante para a versão que ela
  já embute — descartado por adicionar risco sem necessidade aqui.
- Subir a tag da imagem base para casar com uma versão maior do playwright —
  só é seguro se a tag existe DE VERDADE no MCR; não dá para confirmar isso
  sem acesso à internet (tentativa de listar tags do MCR veio truncada). Não
  escolher esse caminho sem confirmar a tag antes.

## Diagnóstico lento por log incompleto (item ligado, mesma investigação)

O log do worker (`handleScrapeFailure` em `scrape-search.job.ts`) gravava só
`err.message` (string genérica "Falha ao iniciar o Chromium") e descartava a
`cause` real do erro (a mensagem de baixo nível do Playwright, que apontaria
o caminho exato do executável ausente) — 20min de investigação por causa
disso.

**Causa técnica:** o serializer padrão do pino (`pino-std-serializers`) só
age quando o valor da chave `err` é *error-like* (instância de `Error`). Se
você loga `err: someString`, o serializer devolve a string intocada — a
cadeia `cause` (que o pino encadeia automaticamente via
`messageWithCauses`/`stackWithCauses` quando recebe um `Error` de verdade)
nunca aparece. Não é um problema de configuração do logger — é passar o tipo
errado pro campo `err`.

**Como aplicar:** sempre logar `err: err instanceof Error ? err : new
Error(String(err))` (nunca `err: err.message`) em qualquer catch do worker.
O padrão já existia em outros pontos do mesmo arquivo
(`scrape-search.job.ts` no catch de sanidade, `requeue-orphans.ts`) — só
`handleScrapeFailure` divergia. Checar esse padrão sempre que investigar um
log "genérico demais" no worker antes de desconfiar do Playwright/infra.
