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

/** Roda A1-A4 e devolve só os que dispararam — conveniência para o chamador (worker). */
export function evaluateSanity(input: {
  recentTasks: readonly TaskResultForZeroStreak[];
  recentLeadNames: readonly (string | null | undefined)[];
  phoneFillRate: { current: number; currentSampleSize: number; sevenDayAverage: number };
  dataShapeSamples: readonly LeadShapeSample[];
}): SanityCheckResult[] {
  const results = [
    checkZeroStreak(input.recentTasks),
    checkNameFillRate(input.recentLeadNames),
    checkPhoneFillRate(
      { fillRate: input.phoneFillRate.current, sampleSize: input.phoneFillRate.currentSampleSize },
      input.phoneFillRate.sevenDayAverage,
    ),
    checkDataShape(input.dataShapeSamples),
  ];
  return results.filter((r): r is Extract<SanityCheckResult, { triggered: true }> => r.triggered);
}
