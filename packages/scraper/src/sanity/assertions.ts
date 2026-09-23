/**
 * sanity/assertions.ts — assertions A1-A4 de detecção de scraper quebrado
 * (ARQUITETURA §5.7). Puras: recebem os dados já coletados (pelo worker, a
 * partir do Postgres) e devolvem um veredito — quem persiste
 * `ScraperHealthEvent`, pausa a fila e dispara alerta é o worker (próxima
 * rodada), não este módulo.
 *
 * "O modo de falha mais perigoso não é o erro — é o sucesso silencioso."
 */

export type SanitySeverity = 'high' | 'critical';

export type SanityCheckResult =
  | { triggered: false }
  | {
      triggered: true;
      code: string;
      severity: SanitySeverity;
      message: string;
      metric: number;
      threshold: number;
      /** `true` quando a ação automática é pausar a fila `scrape-search` (ARQUITETURA §5.7). */
      pauseQueue: boolean;
    };

const NOT_TRIGGERED: SanityCheckResult = { triggered: false };

// ─────────────────────────────────────────────────────────────────────────
// A1 — Zero-streak
// ─────────────────────────────────────────────────────────────────────────

export type TaskResultForZeroStreak = {
  resultCount: number;
  cityPopulation: number;
};

export type ZeroStreakOptions = {
  /** Só conta municípios acima disso — um distrito de 3.000 hab. com 0 resultado é normal, não bug. */
  minPopulation: number;
  streakLength: number;
};

export const DEFAULT_ZERO_STREAK_OPTIONS: ZeroStreakOptions = { minPopulation: 20_000, streakLength: 5 };

/**
 * A1 — as últimas `streakLength` tasks concluídas (em municípios com
 * população > `minPopulation`) retornaram `resultCount === 0`. `recentTasks`
 * deve vir em ordem cronológica (mais antiga primeiro); só os elementos
 * elegíveis (população suficiente) contam para a sequência.
 */
export function checkZeroStreak(
  recentTasks: readonly TaskResultForZeroStreak[],
  options: ZeroStreakOptions = DEFAULT_ZERO_STREAK_OPTIONS,
): SanityCheckResult {
  const eligible = recentTasks.filter((t) => t.cityPopulation > options.minPopulation);
  const window = eligible.slice(-options.streakLength);
  if (window.length < options.streakLength) return NOT_TRIGGERED;

  const allZero = window.every((t) => t.resultCount === 0);
  if (!allZero) return NOT_TRIGGERED;

  return {
    triggered: true,
    code: 'ZERO_STREAK',
    severity: 'critical',
    message: `As últimas ${options.streakLength} buscas em municípios com mais de ${options.minPopulation.toLocaleString('pt-BR')} habitantes retornaram 0 resultados — scraper provavelmente quebrado.`,
    metric: 0,
    threshold: options.streakLength,
    pauseQueue: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// A2 — Fill-rate de nome
// ─────────────────────────────────────────────────────────────────────────

export type NameFillRateOptions = { windowSize: number; minFillRate: number };
export const DEFAULT_NAME_FILL_RATE_OPTIONS: NameFillRateOptions = { windowSize: 50, minFillRate: 0.95 };

/** A2 — em janela de `windowSize` leads capturados, `< minFillRate` têm `name` não vazio. */
export function checkNameFillRate(
  recentLeadNames: readonly (string | null | undefined)[],
  options: NameFillRateOptions = DEFAULT_NAME_FILL_RATE_OPTIONS,
): SanityCheckResult {
  const window = recentLeadNames.slice(-options.windowSize);
  if (window.length < options.windowSize) return NOT_TRIGGERED;

  const filled = window.filter((name) => Boolean(name && name.trim().length > 0)).length;
  const fillRate = filled / window.length;
  if (fillRate >= options.minFillRate) return NOT_TRIGGERED;

  return {
    triggered: true,
    code: 'NAME_FILL_RATE_LOW',
    severity: 'critical',
    message: `Fill-rate de nome caiu para ${(fillRate * 100).toFixed(1)}% (esperado >= ${(options.minFillRate * 100).toFixed(0)}%) — seletor de nome provavelmente quebrou.`,
    metric: fillRate,
    threshold: options.minFillRate,
    pauseQueue: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// A3 — Fill-rate de telefone
// ─────────────────────────────────────────────────────────────────────────

export type PhoneFillRateOptions = {
  /**
   * Amostra mínima para o piso absoluto valer. Poucos leads é ruído, não
   * incidente — 1 empresa sem telefone entre 3 coletados não significa
   * seletor quebrado. 20 é arbitrário mas conservador: é menor que a janela
   * cheia de 50 leads usada pelo chamador (`apps/worker/observability/
   * sanity.ts`), então o piso já vale bem antes da janela de 50 se completar.
   */
  minSampleSize: number;
  /**
   * Piso absoluto de fill-rate — abaixo disso é incidente mesmo SEM
   * histórico de 7 dias (sistema novo tem média=0, que antes fazia A3 nunca
   * disparar — exatamente o ponto cego do incidente de 2026-09: um lead sem
   * telefone algum não acionava nada porque não havia média para comparar).
   * 20% foi escolhido observando que, numa amostra real de 7 negócios
   * (nicho "material de construção"), 7/7 tinham telefone — a maioria dos
   * nichos comerciais no Maps publica telefone. 20% dá margem para nichos
   * legitimamente menos propensos a publicar telefone (ex.: órgãos
   * públicos, grandes redes que preferem direcionar para site/app) sem
   * soar alarme falso, mas ainda pega o caso "quase nenhum tem telefone" —
   * que é justamente o sintoma do incidente relatado (um lead 100% vazio).
   * Ajustável com mais dados reais de produção — não é um número final.
   */
  absoluteFloor: number;
};

export const DEFAULT_PHONE_FILL_RATE_OPTIONS: PhoneFillRateOptions = {
  minSampleSize: 20,
  absoluteFloor: 0.2,
};

/**
 * A3 — duas checagens independentes (qualquer uma dispara):
 *   1. Piso absoluto: `current.fillRate` abaixo de `absoluteFloor`, com
 *      amostra >= `minSampleSize` — vale mesmo sem média de 7 dias (sistema
 *      novo) e mesmo que a própria média de 7 dias já esteja contaminada
 *      pelo mesmo bug (comparação relativa sozinha não pegaria isso).
 *   2. Relativa (comportamento original): `current.fillRate` cai abaixo de
 *      50% da média móvel de 7 dias — só roda se houver média (`> 0`).
 * NÃO pausa a fila em nenhum dos dois casos (pode ser característica do
 * nicho, não bug) — só alerta.
 */
export function checkPhoneFillRate(
  current: { fillRate: number; sampleSize: number },
  sevenDayAverageFillRate: number,
  options: PhoneFillRateOptions = DEFAULT_PHONE_FILL_RATE_OPTIONS,
): SanityCheckResult {
  if (current.sampleSize >= options.minSampleSize && current.fillRate < options.absoluteFloor) {
    return {
      triggered: true,
      code: 'PHONE_FILL_RATE_LOW',
      severity: 'high',
      message: `Fill-rate de telefone (${(current.fillRate * 100).toFixed(1)}%) está abaixo do piso absoluto de ${(options.absoluteFloor * 100).toFixed(0)}% (amostra: ${current.sampleSize} leads) — incidente mesmo sem histórico de 7 dias.`,
      metric: current.fillRate,
      threshold: options.absoluteFloor,
      pauseQueue: false,
    };
  }

  if (sevenDayAverageFillRate <= 0) return NOT_TRIGGERED;

  const threshold = sevenDayAverageFillRate * 0.5;
  if (current.fillRate >= threshold) return NOT_TRIGGERED;

  return {
    triggered: true,
    code: 'PHONE_FILL_RATE_LOW',
    severity: 'high',
    message: `Fill-rate de telefone (${(current.fillRate * 100).toFixed(1)}%) caiu abaixo de 50% da média móvel de 7 dias (${(sevenDayAverageFillRate * 100).toFixed(1)}%).`,
    metric: current.fillRate,
    threshold,
    pauseQueue: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// A5 — Fill-rate de ENRIQUECIMENTO (todos os campos vazios ao mesmo tempo)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Um lead conta como "só com o nome" quando NENHUM destes 4 campos veio
 * preenchido. Deliberadamente NÃO inclui `rating`/`reviewCount`/coordenadas:
 * um estabelecimento novo sem avaliação nenhuma é normal (o Maps mostra
 * `rating: null` o tempo todo para negócios recém-cadastrados), então
 * incluir esses campos geraria alarme falso num cenário saudável. Endereço e
 * categoria, ao contrário, são praticamente universais em qualquer card do
 * Google Maps — é o que sustenta o piso baixo do `maxNameOnlyRate` abaixo
 * sem soar alarme falso.
 */
export type LeadEnrichmentSample = {
  hasAddress: boolean;
  hasPhone: boolean;
  hasCategory: boolean;
  hasWebsite: boolean;
};

export type EnrichmentFillRateOptions = {
  /**
   * Mesma razão de `PhoneFillRateOptions.minSampleSize` (A3): poucos leads é
   * ruído, não incidente. 20, mesmo valor de A3 — não há motivo para janelas
   * de tamanho diferente medindo o mesmo lote de leads recém-coletados.
   */
  minSampleSize: number;
  /**
   * Piso ACIMA de zero, não um teto rígido em 0% — dá margem para um card
   * genuinamente anômalo do Maps (ex.: um pin sem ficha completa) sem
   * disparar por 1 lead ruim em 50. 30% é conservador na direção oposta:
   * o incidente relatado (2026-09-23, ~260 leads só com o nome) foi
   * essencialmente 100% de `nameOnlyRate` na janela — MUITO acima deste
   * piso. A referência de "quase todo card tem endereço+categoria" vem da
   * mesma amostra real usada para justificar o piso de telefone da A3 (ver
   * `DEFAULT_PHONE_FILL_RATE_OPTIONS`): 7/7 negócios de "material de
   * construção" tinham endereço E categoria capturados, então mesmo um
   * nicho que legitimamente não publica telefone/site ainda teria
   * `nameOnlyRate` próximo de 0% por esta métrica (ela só conta como
   * "vazio" quando address, phone, category E website falham TODOS ao
   * mesmo tempo — não é o caso de um nicho sem site/telefone, que ainda tem
   * endereço+categoria). Ajustável com mais dados reais de produção.
   */
  maxNameOnlyRate: number;
};

export const DEFAULT_ENRICHMENT_FILL_RATE_OPTIONS: EnrichmentFillRateOptions = {
  minSampleSize: 20,
  maxNameOnlyRate: 0.3,
};

/**
 * A5 — em janela de leads capturados, mede a fração que é "só nome": nem
 * endereço, nem telefone, nem categoria, nem site vieram preenchidos. É o
 * caso que A1-A4 nunca cobriram (2026-09-23: ~260 leads assim, nenhuma
 * assertion disparou) — A2 mede só `name` vazio (o INVERSO: aqui o nome
 * SEMPRE veio, só o resto que faltou), A3 mede só telefone isoladamente, A4
 * mede FORMATO (rating fora de faixa / telefone que falhou normalização),
 * não AUSÊNCIA. PAUSA a fila (`pauseQueue: true`) — diferente de A3/A4
 * (que não pausam porque podem refletir característica legítima de nicho):
 * um lead com TODOS os 4 campos vazios ao mesmo tempo não tem explicação de
 * nicho plausível (endereço e categoria são universais no Maps, ver
 * comentário do type acima) — é sinal de seletor quebrado em massa, o mesmo
 * tipo de falha estrutural que A1/A2 cobrem.
 */
export function checkEnrichmentFillRate(
  samples: readonly LeadEnrichmentSample[],
  options: EnrichmentFillRateOptions = DEFAULT_ENRICHMENT_FILL_RATE_OPTIONS,
): SanityCheckResult {
  if (samples.length < options.minSampleSize) return NOT_TRIGGERED;

  const nameOnly = samples.filter((s) => !s.hasAddress && !s.hasPhone && !s.hasCategory && !s.hasWebsite).length;
  const nameOnlyRate = nameOnly / samples.length;
  if (nameOnlyRate <= options.maxNameOnlyRate) return NOT_TRIGGERED;

  return {
    triggered: true,
    code: 'ENRICHMENT_FILL_RATE_LOW',
    severity: 'critical',
    message: `${(nameOnlyRate * 100).toFixed(1)}% dos leads capturados vieram só com o nome (endereço, telefone, categoria e site TODOS vazios) — acima do piso de ${(options.maxNameOnlyRate * 100).toFixed(0)}%. Scraper provavelmente quebrado (seletores de enriquecimento).`,
    metric: nameOnlyRate,
    threshold: options.maxNameOnlyRate,
    pauseQueue: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// A4 — Forma dos dados
// ─────────────────────────────────────────────────────────────────────────

export type LeadShapeSample = { rating: number | null; phoneNormalizationFailed: boolean };

/** A4 — `>10%` dos ratings fora de 0-5, OU `>10%` dos telefones falhando na normalização E.164. */
export function checkDataShape(samples: readonly LeadShapeSample[]): SanityCheckResult {
  if (samples.length === 0) return NOT_TRIGGERED;

  const invalidRatings = samples.filter((s) => s.rating !== null && (s.rating < 0 || s.rating > 5)).length;
  const ratingRate = invalidRatings / samples.length;
  if (ratingRate > 0.1) {
    return {
      triggered: true,
      code: 'RATING_OUT_OF_RANGE',
      severity: 'high',
      message: `${(ratingRate * 100).toFixed(1)}% dos ratings capturados estão fora de 0-5 — seletor pode estar pegando o campo errado.`,
      metric: ratingRate,
      threshold: 0.1,
      pauseQueue: false,
    };
  }

  const invalidPhones = samples.filter((s) => s.phoneNormalizationFailed).length;
  const phoneRate = invalidPhones / samples.length;
  if (phoneRate > 0.1) {
    return {
      triggered: true,
      code: 'PHONE_NORMALIZATION_FAILURE_RATE',
      severity: 'high',
      message: `${(phoneRate * 100).toFixed(1)}% dos telefones capturados falharam na normalização E.164 — seletor pode estar pegando o campo errado.`,
      metric: phoneRate,
      threshold: 0.1,
      pauseQueue: false,
    };
  }

  return NOT_TRIGGERED;
}

/** Roda A1-A5 e devolve só os que dispararam — conveniência para o chamador (worker). */
export function evaluateSanity(input: {
  recentTasks: readonly TaskResultForZeroStreak[];
  recentLeadNames: readonly (string | null | undefined)[];
  phoneFillRate: { current: number; currentSampleSize: number; sevenDayAverage: number };
  dataShapeSamples: readonly LeadShapeSample[];
  enrichmentSamples: readonly LeadEnrichmentSample[];
}): SanityCheckResult[] {
  const results = [
    checkZeroStreak(input.recentTasks),
    checkNameFillRate(input.recentLeadNames),
    checkPhoneFillRate(
      { fillRate: input.phoneFillRate.current, sampleSize: input.phoneFillRate.currentSampleSize },
      input.phoneFillRate.sevenDayAverage,
    ),
    checkDataShape(input.dataShapeSamples),
    checkEnrichmentFillRate(input.enrichmentSamples),
  ];
  return results.filter((r): r is Extract<SanityCheckResult, { triggered: true }> => r.triggered);
}
