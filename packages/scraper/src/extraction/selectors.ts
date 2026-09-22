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
 * ──────────────────────────────────────────────────────────────────────────
 * Verificação 2026-09-22 (incidente: lead gravado com nome+município e TODO
 * o resto vazio — telefone, endereço, site, avaliação, categoria) — feita
 * contra o Maps real, 1 busca ("material de construção em Parnamirim, RN"),
 * 7 cards de resultado inspecionados. Achados:
 *   1. `resultCard` batia também no carrossel de filtros no topo da lista
 *      (`div.fp2VUc[jsaction=...]`, que também é filho direto de
 *      `div[role="feed"] > div`) — um "card" fantasma sem nome/telefone/
 *      nada, antes de qualquer card real. Trocado para `div[role="article"]`
 *      (ARIA, não é seletor de texto/classe do Maps — é papel de
 *      acessibilidade, mais estável) — só os 7 cards reais casam.
 *   2. `card.address` não tinha NENHUMA alternativa que ainda casasse: a
 *      estrutura mudou (endereço saiu do último bloco, que agora só tem
 *      horário+telefone, e foi para o MESMO bloco da categoria). Era a causa
 *      raiz comprovada do endereço vazio.
 *   3. `card.category` casava, mas no elemento ERRADO — o seletor antigo
 *      (`div.W4Efsd > div > span:first-child`) também bate por acidente no
 *      bloco de NOTA/estrelas (que tem a mesma forma `div.W4Efsd > div >
 *      span`), e como esse bloco vem ANTES da categoria no DOM, `.first()`
 *      pegava a nota, não a categoria. Corrigido ancorando na estrutura que
 *      SÓ o bloco categoria+endereço tem (div.W4Efsd aninhado dentro de
 *      outro div.W4Efsd — nem o bloco de nota nem o de horário/telefone têm
 *      esse aninhamento duplo).
 *   4. `card.phone` (`span.UsdlK`) continua correto — presente em 7/7 cards
 *      da amostra. Telefone SAI DIRETO DA LISTA, não exige abrir a ficha do
 *      negócio (nenhuma navegação extra por lead é necessária).
 *   5. `card.rating` continua correto (`span.MW4etd`), mas o aria-label do
 *      wrapper (`span[role="img"][aria-label*="estrela"]`, ex.: "5,0
 *      estrelas") é mais estável — promovido a alternativa preferida.
 *   6. `card.reviewCount` (contagem de avaliações, "(123)") NÃO apareceu em
 *      NENHUM dos 7 cards desta amostra — não é mais exibido na lista para
 *      esse nicho (pode ter sido removido da UI, ou só aparecer em nichos
 *      com volume de avaliação maior, ex. restaurantes — não verificado).
 *      Mantido como best-effort; ausência não deve ser tratada como bug.
 *   7. `card.website` (link "Visitar site") também NÃO apareceu em nenhum
 *      card da lista nem no painel após o clique (ver item 8) — mantido
 *      como best-effort/aspiracional, sem confirmação de que ainda existe
 *      em algum lugar do card.
 *   8. Tentativa de abrir a ficha (clicar no card) para checar se algum
 *      campo só existe lá: SEM LOGIN, o Maps mostra uma "visualização
 *      limitada" (banner "Fazer login" na própria lista, resultado plafonado
 *      em ~7-8 cards) e o clique não trocou o painel para a ficha do
 *      negócio — o painel principal continuou mostrando a LISTA. Não foi
 *      possível confirmar o conteúdo real da ficha nesta rodada. Como
 *      telefone/nota/categoria/endereço já vêm da lista (itens 2-5), isso
 *      não bloqueia a correção — mas também significa que "abrir a ficha
 *      por lead" não é uma opção testada/disponível hoje sem login, então
 *      nem foi considerada como redesenho da coleta.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Última verificação: 2026-09-22
 */
export const SELECTORS = {
  resultsFeed: ['div[role="feed"]', '#pane div[role="main"]'],
  /**
   * `div[role="article"]` é o card real (papel ARIA — Google mantém isso
   * para leitores de tela, é mais estável que classe ofuscada). Descendente
   * (não filho direto) porque há um `<div>` de wrapper entre o feed e o
   * card. `div.Nv2PK` é a classe observada em 2026-09-22 (fallback se o
   * role mudar); `a.hfpxzc` é o último recurso — só a âncora do card, sem
   * os outros campos (nome ainda sai, o resto não).
   */
  resultCard: ['div[role="feed"] div[role="article"]', 'div.Nv2PK', 'a.hfpxzc'],
  card: {
    name: ['a.hfpxzc[aria-label]', 'div.fontHeadlineSmall', '.qBF1Pd'],
    /** aria-label ("N,N estrelas") primeiro — mais estável que a classe do número. */
    rating: ['span[role="img"][aria-label*="estrela"]', 'span.MW4etd'],
    /**
     * Best-effort — NÃO observado em nenhum card real na verificação de
     * 2026-09-22 (ver nota grande no topo, item 6). Ausência não é bug.
     */
    reviewCount: ['span.UY7F9', 'span[aria-label*="avaliaç"]'],
    /**
     * Categoria e endereço curto vivem no MESMO bloco: um `div.W4Efsd`
     * aninhado dentro de outro `div.W4Efsd`. Esse aninhamento duplo só
     * ocorre aqui (nem o bloco de nota, nem o de horário/telefone têm um
     * `div.W4Efsd` filho) — âncora estrutural mais confiável do que
     * depender da ORDEM entre os 3 blocos irmãos, que já mudou uma vez
     * (2026-09-22: endereço saiu do bloco do telefone e foi para o da
     * categoria). Primeiro `span` filho = categoria.
     */
    category: ['div.W4Efsd div.W4Efsd > span:first-child'],
    /**
     * Último `span` filho do mesmo bloco = separador "·" + endereço — mas
     * só quando há MAIS de um `span` filho (`:not(:only-child)`); se houver
     * só categoria (sem endereço publicado), o único filho não deve ser
     * lido como endereço. Dentro dele, `span:last-child` pula o separador
     * "·" (que vem sempre primeiro) e pega só o texto do endereço. Robusto
     * ao número de "· badge ·" no meio (ex.: ícone de acessibilidade) —
     * testado com 0 e 1 badge intermediário na amostra real.
     */
    address: ['div.W4Efsd div.W4Efsd > span:last-child:not(:only-child) > span:last-child'],
    /**
     * Confirmado em 7/7 cards de uma busca real em 2026-09-22 — sai direto
     * da lista, sem precisar abrir a ficha do negócio (ver nota grande no
     * topo, item 8). `:has-text` é fallback só para o motor vivo
     * (Playwright); no parser de fixture (cheerio) é ignorado/pulado.
     */
    phone: ['span.UsdlK', 'div.W4Efsd span:has-text("(")'],
    /** Best-effort/aspiracional — não observado em nenhum card real nem na tentativa de ficha (ver item 7/8). */
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
