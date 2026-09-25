/**
 * whatsapp/send-policy.ts — `resolveSendPolicy(env)`, o ÚNICO lugar com os
 * clamps de env do disparo (ARQUITETURA §4.F.2/§10). Puro, no mesmo
 * princípio de `send-window.ts`/`jitter.ts`: `env` chega por PARÂMETRO,
 * este módulo nunca lê `process.env` diretamente — é assim que "zero
 * `process.env` em `packages/core`" e "um único lugar com os clamps"
 * convivem: quem LÊ a env é a camada de app (`apps/web`, e depois
 * `apps/worker` na 4.F.4), quem DECIDE os limites é aqui.
 *
 * `SendPolicyEnv` usa os MESMOS nomes de `process.env` do §10 — de
 * propósito, para o chamador poder fazer `resolveSendPolicy(process.env)`
 * direto, sem uma camada de parsing própria por app (a estrutura de
 * `NodeJS.ProcessEnv`, um dicionário de `string | undefined`, satisfaz este
 * tipo estruturalmente).
 *
 * Antes desta função, `apps/web/src/lib/services/messages.ts` tinha CINCO
 * funções privadas (`quietHoursFromEnv`, `businessWindowFromEnv`,
 * `sendWindowConfigFromEnv`, `jitterRangeSecondsFromEnv`,
 * `microPauseConfigFromEnv`) fazendo exatamente esta conta — religadas para
 * chamar esta função na 4.F.2 (ver handoff do Vega). O futuro
 * `dispatch-tick.job` (`apps/worker`, 4.F.4) usa a MESMA função para nunca
 * ter uma segunda versão dos clamps.
 */
import {
  DEFAULT_SEND_WINDOW_CONFIG,
  type SendWindowConfig,
} from './send-window.js';
import {
  DEFAULT_JITTER_RANGE_SECONDS,
  DEFAULT_MICRO_PAUSE_CONFIG,
  MIN_JITTER_FLOOR_SECONDS,
  type JitterRangeSeconds,
  type MicroPauseConfig,
} from './jitter.js';

/**
 * Mesmos nomes de `process.env` do §10 — ver comentário do módulo.
 *
 * A assinatura de índice (`[key: string]`) é necessária, não decorativa:
 * sem ela, o TypeScript trata este tipo como "fraco" (só propriedades
 * opcionais) e recusa `resolveSendPolicy(process.env)` com
 * `TS2559 (no properties in common)` — `NodeJS.ProcessEnv` só expõe
 * `DISPATCH_*`/`APP_TIMEZONE` via índice, não como propriedade nomeada.
 */
export type SendPolicyEnv = {
  [key: string]: string | undefined;
  APP_TIMEZONE?: string;
  DISPATCH_QUIET_HOURS_START?: string;
  DISPATCH_QUIET_HOURS_END?: string;
  DISPATCH_WINDOW_START?: string;
  DISPATCH_WINDOW_END?: string;
  DISPATCH_JITTER_MIN_S?: string;
  DISPATCH_JITTER_MAX_S?: string;
  DISPATCH_MICRO_PAUSE_EVERY_MIN?: string;
  DISPATCH_MICRO_PAUSE_EVERY_MAX?: string;
  DISPATCH_MICRO_PAUSE_MIN_S?: string;
  DISPATCH_MICRO_PAUSE_MAX_S?: string;
};

export type SendPolicy = {
  /** Piso duro (G5) + janela comercial (G6) — o "piso da env" que `resolveCampaignWindow` (`send-window.ts`) intersecta com a configuração de cada campanha. */
  sendWindow: SendWindowConfig;
  jitterRangeSeconds: JitterRangeSeconds;
  microPause: MicroPauseConfig;
};

/** `Number.parseInt` + `Number.isFinite` num só lugar — `undefined` para "env ausente/inválida", nunca `NaN` escapando para a conta seguinte. */
function parsedInt(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Resolve a política inteira de disparo (janela + jitter + micro-pausa) a
 * partir da env, aplicando os clamps do §10 em cada campo. Nenhum destes
 * campos pode ALARGAR o padrão de `@inno/core` — env só estreita (mesma
 * regra que `resolveCampaignWindow` aplica à campanha, um nível abaixo).
 */
export function resolveSendPolicy(env: SendPolicyEnv): SendPolicy {
  const timezone = env.APP_TIMEZONE || DEFAULT_SEND_WINDOW_CONFIG.timezone;

  // G5 — piso duro: só ESTREITA (start maior / end menor que o padrão).
  const quietBase = DEFAULT_SEND_WINDOW_CONFIG.quietHours;
  const envQuietStart = parsedInt(env.DISPATCH_QUIET_HOURS_START);
  const envQuietEnd = parsedInt(env.DISPATCH_QUIET_HOURS_END);
  const quietHours: SendWindowConfig['quietHours'] = {
    startHour: envQuietStart !== undefined ? Math.max(envQuietStart, quietBase.startHour) : quietBase.startHour,
    endHour: envQuietEnd !== undefined ? Math.min(envQuietEnd, quietBase.endHour) : quietBase.endHour,
  };

  // G6 — janela comercial: mole no manual, sem clamp contra o padrão aqui
  // (a env é quem define a janela comercial "oficial"; o piso duro acima é
  // quem protege de verdade). `lunchBreak`/`daysOfWeek` não têm env própria
  // hoje — gap documentado, seguem no padrão de `@inno/core`.
  const windowBase = DEFAULT_SEND_WINDOW_CONFIG.businessWindow;
  const envWindowStart = parsedInt(env.DISPATCH_WINDOW_START);
  const envWindowEnd = parsedInt(env.DISPATCH_WINDOW_END);
  const businessWindow: SendWindowConfig['businessWindow'] = {
    startHour: envWindowStart !== undefined ? envWindowStart : windowBase.startHour,
    endHour: envWindowEnd !== undefined ? envWindowEnd : windowBase.endHour,
    lunchBreak: windowBase.lunchBreak,
  };

  // Jitter — 🔒 MIN_JITTER_FLOOR_SECONDS (30s) NUNCA contornável pela env,
  // mesmo que `DISPATCH_JITTER_MIN_S` peça menos (ARQUITETURA §6.3: "mín.
  // 30s" é literal, não "salvo configuração em contrário").
  const jitterBase = DEFAULT_JITTER_RANGE_SECONDS;
  const envJitterMin = parsedInt(env.DISPATCH_JITTER_MIN_S);
  const envJitterMax = parsedInt(env.DISPATCH_JITTER_MAX_S);
  const jitterMinSeconds = envJitterMin !== undefined ? Math.max(envJitterMin, MIN_JITTER_FLOOR_SECONDS) : jitterBase.minSeconds;
  const jitterMaxSeconds = envJitterMax !== undefined && envJitterMax > jitterMinSeconds ? envJitterMax : jitterBase.maxSeconds;

  // Micro-pausa — valor inválido/fora de ordem cai no default de
  // `@inno/core`, nunca em `NaN` silencioso.
  const microBase = DEFAULT_MICRO_PAUSE_CONFIG;
  const envEveryMin = parsedInt(env.DISPATCH_MICRO_PAUSE_EVERY_MIN);
  const envEveryMax = parsedInt(env.DISPATCH_MICRO_PAUSE_EVERY_MAX);
  const envPauseMin = parsedInt(env.DISPATCH_MICRO_PAUSE_MIN_S);
  const envPauseMax = parsedInt(env.DISPATCH_MICRO_PAUSE_MAX_S);
  const everyMin = envEveryMin !== undefined && envEveryMin > 0 ? envEveryMin : microBase.everyMin;
  const everyMax = envEveryMax !== undefined && envEveryMax >= everyMin ? envEveryMax : microBase.everyMax;
  const pauseMinSeconds = envPauseMin !== undefined && envPauseMin > 0 ? envPauseMin : microBase.pauseMinSeconds;
  const pauseMaxSeconds = envPauseMax !== undefined && envPauseMax >= pauseMinSeconds ? envPauseMax : microBase.pauseMaxSeconds;

  return {
    sendWindow: { timezone, quietHours, businessWindow },
    jitterRangeSeconds: { minSeconds: jitterMinSeconds, maxSeconds: jitterMaxSeconds },
    microPause: { everyMin, everyMax, pauseMinSeconds, pauseMaxSeconds },
  };
}
