---
name: bug-navigate-isvisible-no-real-wait
description: Incidente LAYOUT_CHANGED de 2026-09 em packages/scraper/src/engine/navigate.ts — Locator.isVisible({timeout}) do Playwright não espera, é ignorado; a correção real foi polling explícito, não um seletor novo.
metadata:
  type: project
---

**Causa raiz (comprovada ao vivo, não deduzida):** em `packages/scraper/src/engine/navigate.ts`,
`tryClickConsent`/`findFirstVisible`/`detectBlocked` chamavam `locator.isVisible({ timeout: N })`
esperando que isso significasse "espere até N ms o elemento aparecer". **Não significa.** A própria
declaração de tipos do Playwright 1.62 marca esse `timeout` como `@deprecated — This option is
ignored... does not wait for the element to become visible and returns immediately`
(`node_modules/.../playwright-core/types/types.d.ts`, método `Locator.isVisible`). Reproduzi ao vivo
contra o Google Maps real (headless, query "clinica odontologica em Natal, RN"): `domcontentloaded`
dispara com o body **praticamente vazio** (innerText length=1) — é uma SPA pesada — e o
`div[role="feed"]` só existe no DOM ~2s depois, sem NENHUM consent/captcha na página. Como todos os
checks rodavam em ~1200ms totais (soma de `await`s, não de espera real), o feed nunca tinha chance de
aparecer e o código lançava `LAYOUT_CHANGED` (fatal, pausa a fila para sempre) por um problema que não
era de layout nenhum.

**Correção:** não usar `isVisible({timeout})` como se esperasse. `findFirstVisible` virou um check
"estado ATUAL, sem espera" (removi o `{timeout}` morto de todo lugar — ele mentia sobre o
comportamento). A espera real agora é um poll explícito: `classifyOnce(page)` (1 tick: olha URL
bloqueada, tenta clicar consent, olha captcha/rate-limit no DOM, olha o feed — tudo síncrono/instantâneo)
chamado em loop por `waitForClassification(page, {timeoutMs, pollIntervalMs})`, que dá `sleep` de verdade
(`errors.ts#sleep`) entre tentativas até `timeoutMs` (default 12s, novo `NavigateOptions.feedTimeoutMs`).
`Locator.click({timeout})` e `Locator.innerText({timeout})`, ao contrário de `isVisible`, TÊM espera real
(actionability wait) — não sofrem do mesmo bug, não precisei tocar neles.

**Como evitar recorrência:** ao usar Playwright, nunca assumir que passar `{timeout}` faz um método
esperar — cada método documenta separadamente se honra isso (`click`/`waitFor`/ações em geral: sim;
`isVisible`/`isEnabled`/`isChecked` "snapshot" methods: não, é estado instantâneo por design). Se
precisar esperar uma condição que só existe via método snapshot, fazer polling explícito com `sleep`
real entre tentativas — não confiar no parâmetro `timeout` do snapshot.

**Enquanto isso, também tratados (endurecimento, não causa raiz comprovada):**
- `SELECTORS.consentButton` ganhou mais variantes pt-BR de ACEITAR ("Concordo", "Aceito") — nunca
  "Rejeitar tudo". Não observei consent na reprodução real, então isso é defensivo, não a causa provada.
- Novo `SELECTORS.blockedUrlPaths` (`/sorry/index`, `/sorry`) — `classifyOnce` checa a URL além do DOM,
  porque o redirect para a página de bloqueio do Google pode chegar antes do corpo terminar de renderizar.
  `/sorry` com iframe de recaptcha → `CAPTCHA_DETECTED`; sem captcha interativo → `RATE_LIMITED`. Nenhum
  dos dois vira mais `LAYOUT_CHANGED`.
- `LAYOUT_CHANGED` agora carrega URL final + trecho curto (~220 chars, `body.innerText` colapsado) na
  própria `message` — que já flui direto pro alerta webhook e pro `SearchTask.errorMessage`
  (`apps/worker/src/jobs/scrape-search.job.ts`), então quem vê o alerta já sabe "o que a página era" sem
  precisar ir atrás do `captureIncident` (`packages/scraper/src/sanity/incident.ts`, que continua
  intocado — screenshot+HTML completos em disco, isso já existia e está certo).

**Teste de regressão:** `packages/scraper/src/engine/navigate.test.ts` — Page falso baseado em cheerio
(mesmo padrão de `extract-card.test.ts`, fixtures em `sanity/fixtures/maps-*.html`), sem bater no Google.
Um teste em particular prova a causa raiz de forma direta: feed que só passa a "existir" a partir do 3º
tick do poll não é classificado como layout mudado — o bug antigo pararia (erradamente) no 1º tick.

Ver também [[project-innoprospect]].
