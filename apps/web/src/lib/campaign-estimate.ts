/**
 * lib/campaign-estimate.ts — `estimate` de `POST /campaigns` (ARQUITETURA
 * §4.5.4): "`eligible / (nº de instâncias × cota diária efetiva de cada uma
 * hoje)`, arredondado para cima em dias úteis". Puro, para o mock e a tela de
 * revisão (antes de criar) usarem a MESMA conta.
 */
import type { CampaignEstimate } from '@/types/campaign';

export type InstanceDailyCapacity = { dailyLimit: number };

/**
 * `finishesAround` soma em DIAS ÚTEIS (segunda–sábado, mesmo domínio de
 * `sendWindow.daysOfWeek` — só domingo é feriado fixo aqui; a Fase 4 não
 * cruza calendário de feriados, mesma simplificação assumida em
 * `lib/send-window.ts`).
 */
function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from);
  let remaining = days;
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    if (result.getDay() !== 0) remaining -= 1;
  }
  return result;
}

export function computeCampaignEstimate(
  eligible: number,
  instances: InstanceDailyCapacity[],
  now = new Date(),
): CampaignEstimate {
  const messagesPerDay = instances.reduce((sum, i) => sum + Math.max(0, i.dailyLimit), 0);

  if (eligible === 0 || messagesPerDay === 0) {
    return { days: 0, messagesPerDay, finishesAround: now.toISOString() };
  }

  const days = Math.ceil(eligible / messagesPerDay);
  const finishesAround = addBusinessDays(now, days);
  return { days, messagesPerDay, finishesAround: finishesAround.toISOString() };
}
