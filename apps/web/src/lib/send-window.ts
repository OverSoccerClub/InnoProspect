/**
 * Janela de envio do envio unitário (ARQUITETURA.md §4.9.6) — puro, sem I/O,
 * para o mock reagir do mesmo jeito que o backend real vai reagir. Dois
 * níveis, do mais duro pro mais mole:
 *
 * - `quiet_hours` (piso legal): fora de 08:00–20:00 ou domingo. Duro — sem
 *   flag que passe.
 * - `outside_business` (janela comercial): 08–09, 12:00–13:30, 18–20 ou
 *   sábado. Mole — a UI pede `confirmOutsideBusinessWindow: true`.
 * - `ok`: dentro do comercial (09–12, 13:30–18, seg–sex).
 *
 * Simplificação assumida (documentar no handoff): não considera feriados
 * nacionais — o backend real cruza com um calendário; o mock não tem essa
 * fonte de dados. Fica pior só em feriados, que são raros e não afetam o
 * fluxo normal de demonstração/teste.
 */

const HARD_START_HOUR = 8;
const HARD_END_HOUR = 20;
const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 18;
const LUNCH_START_HOUR = 12;
const LUNCH_END_HOUR = 13.5;

export type SendWindowLevel = 'ok' | 'quiet_hours' | 'outside_business';

export type SendWindowVerdict =
  | { level: 'ok' }
  | { level: 'quiet_hours' | 'outside_business'; nextOpensAt: Date };

function hourOf(date: Date): number {
  return date.getHours() + date.getMinutes() / 60;
}

function classify(date: Date): SendWindowLevel {
  const day = date.getDay(); // 0 = domingo, 6 = sábado
  const hour = hourOf(date);

  if (day === 0 || hour < HARD_START_HOUR || hour >= HARD_END_HOUR) return 'quiet_hours';

  const isSaturday = day === 6;
  const inLunch = hour >= LUNCH_START_HOUR && hour < LUNCH_END_HOUR;
  const inEarly = hour < BUSINESS_START_HOUR;
  const inEvening = hour >= BUSINESS_END_HOUR;
  if (isSaturday || inLunch || inEarly || inEvening) return 'outside_business';

  return 'ok';
}

/** Avança em passos de 15min até achar o próximo momento `ok` (limite de 14 dias). */
function findNextOk(from: Date): Date {
  const step = 15 * 60_000;
  let candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate = new Date(Math.ceil(candidate.getTime() / step) * step);
  const limit = from.getTime() + 14 * 86_400_000;
  while (candidate.getTime() < limit) {
    if (classify(candidate) === 'ok') return candidate;
    candidate = new Date(candidate.getTime() + step);
  }
  return candidate;
}

export function evaluateSendWindow(now: Date): SendWindowVerdict {
  const level = classify(now);
  if (level === 'ok') return { level };
  return { level, nextOpensAt: findNextOk(now) };
}
