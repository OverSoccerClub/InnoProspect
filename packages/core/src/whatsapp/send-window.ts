/**
 * whatsapp/send-window.ts — piso duro de horário (G5) + janela comercial
 * (G6), ARQUITETURA §4.9.6/§6.3. Puro: todo "agora" chega por parâmetro
 * (`now: Date`) e toda configuração chega por parâmetro (`SendWindowConfig`)
 * — este módulo NUNCA lê `Date.now()` nem `process.env` (mesmo princípio de
 * `warmup.ts`: "este módulo não sabe nada sobre tempo/infra"). Quem lê as
 * envs (`DISPATCH_QUIET_HOURS_START/END`, `APP_TIMEZONE`...) é a camada de
 * aplicação (`apps/web/src/lib/services/messages.ts`), que monta o
 * `SendWindowConfig` e passa para `evaluateSendGuard`.
 *
 * Dois níveis, ARQUITETURA §4.9.6 (a tabela é a fonte da verdade):
 *   - 🔴 Piso legal/anti-denúncia (DURO): fora de 08:00–20:00, OU domingo, OU
 *     feriado nacional. Nunca contornável — nem por confirmação, nem por
 *     `role=admin`. Só pode ser ESTREITADO via env (`quietHours` menor que o
 *     padrão), nunca alargado — quem garante isso é a camada que monta a
 *     config (mesmo princípio de `dailyLimitOverride`, `warmup.ts`).
 *   - 🟡 Janela comercial (MOLE no envio manual): fora do horário comercial
 *     (mas dentro do piso duro) exige confirmação explícita do operador.
 *     Sábado inteiro cai aqui (nunca é "aberto" na janela comercial, mas
 *     também nunca é bloqueado pelo piso duro, que só proíbe domingo).
 */

export type SendWindowConfig = {
  /** Fuso para calcular hora local/dia da semana (ARQUITETURA §10 `APP_TIMEZONE`). */
  timezone: string;
  /** Piso duro (G5) — padrão 08–20. Só estreitar (start maior / end menor), nunca alargar; quem aplica essa regra é quem monta a config a partir da env, não este módulo. */
  quietHours: { startHour: number; endHour: number };
  /** Janela comercial (G6) — padrão 09–18 com pausa de almoço. */
  businessWindow: {
    startHour: number;
    endHour: number;
    lunchBreak: { startHour: number; startMinute: number; endHour: number; endMinute: number } | null;
  };
};

/** Padrão da ARQUITETURA §4.9.6/§6.3 — usado quando a env não estreita nada. */
export const DEFAULT_SEND_WINDOW_CONFIG: SendWindowConfig = {
  timezone: 'America/Sao_Paulo',
  quietHours: { startHour: 8, endHour: 20 },
  businessWindow: {
    startHour: 9,
    endHour: 18,
    lunchBreak: { startHour: 12, startMinute: 0, endHour: 13, endMinute: 30 },
  },
};

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Decompõe `date` no calendário LOCAL de `timezone` — 0=domingo..6=sábado, sem depender do fuso do servidor. */
function localParts(date: Date, timezone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const map = new Map(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  // Algumas implementações de `Intl` devolvem "24" para meia-noite com `hour12: false`.
  const rawHour = Number(map.get('hour'));
  return {
    year: Number(map.get('year')),
    month: Number(map.get('month')),
    day: Number(map.get('day')),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: Number(map.get('minute')),
    weekday: WEEKDAY_INDEX[map.get('weekday') ?? ''] ?? 0,
  };
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

// ─────────────────────────────────────────────────────────────────────────
// Feriados nacionais — tabela estática de fixos + cálculo determinístico dos
// móveis a partir da Páscoa (algoritmo de Meeus/Jones/Butcher). "Estático" no
// sentido da ARQUITETURA (§6.3: "tabela estática em policies/send-window.ts")
// é sobre NÃO depender de API externa — o cálculo em si é exato para qualquer
// ano, sem manutenção anual.
// ─────────────────────────────────────────────────────────────────────────

/** `{ month, day }` da Páscoa (domingo) no calendário gregoriano, para `year`. */
function computeEasterDate(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** Soma `offsetDays` (pode ser negativo) a `{year,month,day}`, aritmética de calendário pura (âncora em UTC só para o cálculo, sem relação com fuso de negócio). */
function addCalendarDays(year: number, month: number, day: number, offsetDays: number): { year: number; month: number; day: number } {
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + offsetDays);
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

/** Feriados nacionais fixos (mês, dia) — Lei 6.802/1980 + Lei 14.759/2023 (Consciência Negra). */
const FIXED_NATIONAL_HOLIDAYS: ReadonlyArray<readonly [number, number]> = [
  [1, 1], // Confraternização Universal
  [4, 21], // Tiradentes
  [5, 1], // Dia do Trabalho
  [9, 7], // Independência
  [10, 12], // Nossa Senhora Aparecida
  [11, 2], // Finados
  [11, 15], // Proclamação da República
  [11, 20], // Consciência Negra (nacional desde 2024)
  [12, 25], // Natal
];

const holidayCache = new Map<number, ReadonlySet<string>>();

function nationalHolidaysForYear(year: number): ReadonlySet<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const set = new Set<string>();
  for (const [month, day] of FIXED_NATIONAL_HOLIDAYS) set.add(`${year}-${pad2(month)}-${pad2(day)}`);

  const easter = computeEasterDate(year);
  // Carnaval (segunda + terça — não é feriado federal formal na segunda, mas
  // é dia sem expediente comercial na prática; tratado como piso duro pelo
  // mesmo motivo do domingo: mensagem comercial nesse dia é ruído/denúncia).
  const movable = [
    addCalendarDays(year, easter.month, easter.day, -48), // Carnaval (segunda)
    addCalendarDays(year, easter.month, easter.day, -47), // Carnaval (terça)
    addCalendarDays(year, easter.month, easter.day, -2), // Paixão de Cristo
    addCalendarDays(year, easter.month, easter.day, 60), // Corpus Christi
  ];
  for (const h of movable) set.add(`${h.year}-${pad2(h.month)}-${pad2(h.day)}`);

  holidayCache.set(year, set);
  return set;
}

/** `true` se a data LOCAL (no fuso `timezone`) de `date` for feriado nacional brasileiro. */
export function isBrazilianNationalHoliday(date: Date, timezone: string): boolean {
  const { year, month, day } = localParts(date, timezone);
  return nationalHolidaysForYear(year).has(`${year}-${pad2(month)}-${pad2(day)}`);
}

// ─────────────────────────────────────────────────────────────────────────
// G5 — piso duro (nunca contornável)
// ─────────────────────────────────────────────────────────────────────────

/** `true` se `now` está DENTRO do piso legal duro (ARQUITETURA §4.9.6) — fora disso, G5 bloqueia com `QUIET_HOURS`, sem exceção. */
export function isWithinQuietHoursFloor(now: Date, config: SendWindowConfig): boolean {
  const { hour, weekday } = localParts(now, config.timezone);
  if (weekday === 0) return false; // domingo — nunca configurável
  if (isBrazilianNationalHoliday(now, config.timezone)) return false; // feriado nacional — nunca configurável
  if (hour < config.quietHours.startHour || hour >= config.quietHours.endHour) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// G6 — janela comercial (mole no manual, dura na campanha — a "moleza" é
// decidida por quem chama `evaluateSendGuard`, via `overrides.confirmOutsideBusinessWindow`)
// ─────────────────────────────────────────────────────────────────────────

/** `true` se `now` está dentro da janela comercial "cheia" (seg-sex, fora da pausa de almoço, dentro do horário comercial). Sábado/domingo são SEMPRE `false` aqui — mesmo que passem no piso duro. */
export function isWithinBusinessWindow(now: Date, config: SendWindowConfig): boolean {
  const { hour, minute, weekday } = localParts(now, config.timezone);
  if (weekday === 0 || weekday === 6) return false;

  const { startHour, endHour, lunchBreak } = config.businessWindow;
  if (hour < startHour || hour >= endHour) return false;

  if (lunchBreak) {
    const afterLunchStart = hour > lunchBreak.startHour || (hour === lunchBreak.startHour && minute >= lunchBreak.startMinute);
    const beforeLunchEnd = hour < lunchBreak.endHour || (hour === lunchBreak.endHour && minute < lunchBreak.endMinute);
    if (afterLunchStart && beforeLunchEnd) return false;
  }

  return true;
}

/** Limite de varredura (minutos) ao procurar a próxima abertura — ~21 dias, suficiente mesmo em torno do Natal/Ano Novo. */
const WINDOW_SEARCH_LIMIT_MINUTES = 21 * 24 * 60;

/** Próximo instante (minuto exato) em que `predicate(candidate)` volta a ser `true`, varrendo minuto a minuto a partir de `now` (exclusive). Puro e determinístico — usado para `details[].meta` (`nextWindowOpensAt`), não para lógica de bloqueio. */
function findNextTrueMinute(now: Date, predicate: (d: Date) => boolean): Date | null {
  const start = new Date(now.getTime());
  start.setSeconds(0, 0);
  for (let i = 1; i <= WINDOW_SEARCH_LIMIT_MINUTES; i++) {
    const candidate = new Date(start.getTime() + i * 60_000);
    if (predicate(candidate)) return candidate;
  }
  return null;
}

/** Próxima abertura do piso duro (para `QUIET_HOURS.meta.nextWindowOpensAt`). `null` só seria possível com uma config absurda (ex.: piso fechado o dia inteiro) — não deveria acontecer com config vinda de `DEFAULT_SEND_WINDOW_CONFIG`/env válida. */
export function nextQuietHoursFloorOpensAt(now: Date, config: SendWindowConfig): Date | null {
  return findNextTrueMinute(now, (d) => isWithinQuietHoursFloor(d, config));
}

/** Próxima abertura da janela comercial (para `OUTSIDE_BUSINESS_WINDOW.details[].meta.nextWindowOpensAt`). */
export function nextBusinessWindowOpensAt(now: Date, config: SendWindowConfig): Date | null {
  return findNextTrueMinute(now, (d) => isWithinBusinessWindow(d, config));
}

/** Meia-noite (00:00) do PRÓXIMO dia local em `timezone` — usado para `DAILY_LIMIT_REACHED.details[].meta.resetsAt` (a cota reseta com o dia civil, mesma granularidade de `InstanceDailyStat.date`). */
export function nextLocalMidnight(now: Date, timezone: string): Date {
  const { year, month, day } = localParts(now, timezone);
  const next = addCalendarDays(year, month, day, 1);
  // Constrói o instante UTC correspondente a "00:00 no fuso `timezone`" do dia
  // seguinte por busca fina (o offset do fuso pode variar com DST em outros
  // países; o Brasil não tem DST desde 2019, mas o cálculo fica correto de
  // qualquer forma por não assumir um offset fixo).
  const guess = new Date(Date.UTC(next.year, next.month - 1, next.day, 3, 0, 0)); // UTC-3 é o offset atual de America/Sao_Paulo; ponto de partida da busca
  for (let deltaHours = -6; deltaHours <= 6; deltaHours++) {
    const candidate = new Date(guess.getTime() + deltaHours * 3_600_000);
    const parts = localParts(candidate, timezone);
    if (parts.year === next.year && parts.month === next.month && parts.day === next.day && parts.hour === 0) {
      return candidate;
    }
  }
  return guess;
}
