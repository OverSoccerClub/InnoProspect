import { mulberry32 } from '@/lib/utils';
import type { DashboardSummary } from '@/types/dashboard';
import type { LeadStatus } from '@/types/lead';
import { mockGetQueueStatus } from './scraper';

const STATUS_WEIGHTS: Record<LeadStatus, number> = {
  new: 0.2,
  validated: 0.18,
  contacted: 0.27,
  responded: 0.09,
  negotiating: 0.07,
  won: 0.14,
  discarded: 0.05,
};

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 30 dias, tendência de crescimento suave + ruído + queda de fim de semana — não uma linha reta artificial. */
function buildByDay(): { date: string; count: number }[] {
  const random = mulberry32(20260922);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const trend = 7 + (29 - i) * 0.6;
    const weekday = d.getDay();
    const weekendFactor = weekday === 0 || weekday === 6 ? 0.5 : 1;
    const noise = (random() - 0.5) * 7;
    const count = Math.max(0, Math.round((trend + noise) * weekendFactor));
    days.push({ date: toDateKey(d), count });
  }
  return days;
}

function distributeByStatus(total: number): Record<LeadStatus, number> {
  const entries = Object.entries(STATUS_WEIGHTS) as [LeadStatus, number][];
  const result = {} as Record<LeadStatus, number>;
  let assigned = 0;
  entries.forEach(([status, weight], index) => {
    if (index === entries.length - 1) {
      result[status] = total - assigned;
      return;
    }
    const value = Math.round(total * weight);
    result[status] = value;
    assigned += value;
  });
  return result;
}

let cached: DashboardSummary | null = null;

/**
 * Mock rico de `GET /api/v1/dashboard/summary` (endpoint sendo construído em
 * paralelo pelo Vega, ver `types/dashboard.ts`). Determinístico (seed fixa),
 * mas com variação real dia a dia — nada de sequência artificial tipo
 * "1,2,3,4..." que faria o gráfico parecer fake.
 */
export function mockGetDashboardSummary(): DashboardSummary {
  if (cached) return cached;

  const byDay = buildByDay();
  const total = byDay.reduce((sum, d) => sum + d.count, 0);
  const createdLast7d = byDay.slice(-7).reduce((sum, d) => sum + d.count, 0);
  const createdPrev7d = byDay.slice(-14, -7).reduce((sum, d) => sum + d.count, 0);
  const withPhone = Math.round(total * 0.79);
  const withMobile = Math.round(withPhone * 0.77);
  const optedOut = Math.round(total * 0.025);

  const queue = mockGetQueueStatus();

  cached = {
    generatedAt: new Date().toISOString(),
    timezone: 'America/Sao_Paulo',
    leads: {
      total,
      createdLast7d,
      createdPrev7d,
      withPhone,
      withMobile,
      optedOut,
      byStatus: distributeByStatus(total),
      byDay,
      topUfs: [
        { uf: 'SP', count: Math.round(total * 0.38) },
        { uf: 'MG', count: Math.round(total * 0.16) },
        { uf: 'RJ', count: Math.round(total * 0.13) },
        { uf: 'ES', count: Math.round(total * 0.11) },
        { uf: 'BA', count: Math.round(total * 0.08) },
      ],
      topCategories: [
        { category: 'Clínica odontológica', count: Math.round(total * 0.22) },
        { category: 'Restaurante', count: Math.round(total * 0.17) },
        { category: 'Escritório de advocacia', count: Math.round(total * 0.12) },
        { category: 'Pet shop', count: Math.round(total * 0.1) },
        { category: 'Salão de beleza', count: Math.round(total * 0.09) },
      ],
    },
    searches: {
      queued: queue.status === 'paused' ? 1 : 1,
      running: queue.status === 'paused' ? 0 : 2,
      completedLast30d: 21,
      tasksFailedLast30d: 3,
    },
  };
  return cached;
}

/** Estado de primeiro acesso — produção real começa assim (zero leads). Usado pra testar a tela vazia. */
export function mockGetEmptyDashboardSummary(): DashboardSummary {
  const byDay = Array.from({ length: 30 }).map((_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (29 - i));
    return { date: toDateKey(d), count: 0 };
  });
  return {
    generatedAt: new Date().toISOString(),
    timezone: 'America/Sao_Paulo',
    leads: {
      total: 0,
      createdLast7d: 0,
      createdPrev7d: 0,
      withPhone: 0,
      withMobile: 0,
      optedOut: 0,
      byStatus: { new: 0, validated: 0, contacted: 0, responded: 0, negotiating: 0, won: 0, discarded: 0 },
      byDay,
      topUfs: [],
      topCategories: [],
    },
    searches: { queued: 0, running: 0, completedLast30d: 0, tasksFailedLast30d: 0 },
  };
}
