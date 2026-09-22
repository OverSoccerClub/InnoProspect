/**
 * ⚠️  ARQUIVO CRÍTICO — ÚNICO ponto de acoplamento com o DOM do Google Maps.
 * Se o scraper quebrar, o conserto começa (e quase sempre termina) AQUI.
 * Cada seletor tem alternativas em ordem de preferência: o extrator usa a
 * primeira que casar.
 *
 * ⚠️ REGRA DURA (ARQUITETURA §5.5): nenhum seletor CSS/XPath/texto do Google
 * Maps pode existir em NENHUM outro arquivo deste pacote. `extract-card.ts`
 * e `navigate.ts` só consomem `SELECTORS` — eles NUNCA têm uma string de
 * seletor escrita inline. Órion reprova qualquer PR que violar isso.
 *
 * Ao alterar: atualize a fixture em `../sanity/fixtures/` e rode
 * `pnpm --filter @inno/scraper test`.
 *
 * Nota sobre os dois "sabores" de seletor aqui:
 *   - `card.*` são consumidos por `extract-card.ts` via um parser de HTML
 *     puro (cheerio) para permitir teste 100% offline com fixture — por
 *     isso a alternativa PREFERIDA de cada campo é CSS padrão. Alternativas
 *     que usam sintaxe exclusiva do Playwright (`:has-text(...)`) só
 *     funcionam no motor ao vivo; no parser de fixture elas são puladas
 *     (erro tratado) e a busca segue para a próxima alternativa — nunca
 *     remova a alternativa CSS pura só porque a de `:has-text` parece mais
 *     robusta, ou os testes de fixture perdem cobertura.
 *   - `resultsFeed`, `resultCard`, `consentButton`, `endOfList`,
 *     `captchaIndicators`, `blockedIndicatorText` são usados só por
 *     `navigate.ts`, direto na página viva via Playwright — podem usar
 *     sintaxe exclusiva do Playwright sem restrição.
 *
 * Última verificação: 2026-07-30
 */
export const SELECTORS = {
  resultsFeed: ['div[role="feed"]', '#pane div[role="main"]'],
  resultCard: ['div[role="feed"] > div > div[jsaction]', 'a.hfpxzc'],
  card: {
    name: ['.qBF1Pd', 'div.fontHeadlineSmall', 'a.hfpxzc[aria-label]'],
    rating: ['span.MW4etd', 'span[role="img"][aria-label*="estrela"]'],
    reviewCount: ['span.UY7F9', 'span[aria-label*="avaliaç"]'],
    category: ['div.W4Efsd > div > span:first-child'],
    address: ['div.W4Efsd:last-child > div:last-child > span:last-child'],
    phone: ['span.UsdlK', 'div.W4Efsd span:has-text("(")'],
    website: ['a[data-value="Website"]', 'a[aria-label*="Visitar site"]'],
    link: ['a.hfpxzc'],
  },
  /**
   * Botão de ACEITAR do interstitial de consentimento (nunca "Rejeitar
   * tudo" — isso mudaria o comportamento, não só destravaria a navegação).
   * Variantes pt-BR observadas + fallback em inglês (região/conta podem
   * negociar idioma diferente do esperado).
   */
  consentButton: [
    'button[aria-label*="Aceitar tudo"]',
    'button[aria-label*="Concordo"]',
    'button[aria-label*="Aceito"]',
    'button[aria-label*="Accept all"]',
    'button[aria-label*="I agree"]',
    'form[action*="consent"] button[aria-label*="Aceitar"]',
    'form[action*="consent"] button',
  ],
  endOfList: ['span.HlvSq', 'p.fontBodyMedium:has-text("chegou ao fim")'],

  /**
   * Indícios de bloqueio/anti-bot na página (ARQUITETURA §5.6/§5.7) — usados
   * por `navigate.ts` para classificar `CAPTCHA_DETECTED`/`RATE_LIMITED` em
   * vez de deixar a navegação simplesmente estourar timeout sem explicação.
   */
  captchaIndicators: ['iframe[src*="recaptcha"]', 'form#captcha-form', 'div#captcha'],
  blockedIndicatorText: [/unusual traffic/i, /tr[aá]fego incomum/i, /automated queries/i],

  /**
   * Caminhos de URL da página de bloqueio/captcha do Google (ex.:
   * `/sorry/index`). Checar a URL além do DOM importa porque o redirect
   * para `/sorry` às vezes chega ANTES do corpo da página terminar de
   * renderizar — o sinal na URL é mais rápido e mais confiável que esperar
   * o texto/iframe aparecer.
   */
  blockedUrlPaths: ['/sorry/index', '/sorry'],
} as const;
