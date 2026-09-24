/**
 * lib/campaign-progress.ts — deriva `CampaignStats`/`CampaignRates`/estimativa
 * a partir dos ALVOS materializados (`CampaignTargetItem[]`), nunca o
 * contrário. Mesma disciplina de `search-job-outcome.ts` e
 * `SearchProgressBar` (ver DESIGN-SYSTEM/memória da Lyra): a barra e os
 * números da tela têm que vir da MESMA conta que o texto usa, ou a UI corre o
 * risco de mostrar uma barra que contradiz a legenda ao lado.
 *
 * ARQUITETURA.md §4.5.7 ("De onde vem cada número"): no backend real,
 * `stats.sent/delivered/read/responded/failed/skipped` são contadores de
 * FUNIL incrementados (não uma partição) — `total = COUNT(*)` dos alvos,
 * `pending` é o único contado ao vivo. Aqui, sem contadores incrementais
 * (o mock só tem a lista de alvos), a única forma correta de reproduzir o
 * MESMO significado é contar `status === 'sent'` como "alcançou pelo menos
 * sent", ou seja, os totais de funil por `COUNT(status IN {sent, delivered,
 * read, responded, ...})`. Ver `deriveCampaignStats` abaixo.
 */
import type { CampaignRates, CampaignStats, CampaignTargetItem, CampaignTargetStatus } from '@/types/campaign';

/** Ordem do funil "feliz" — mesma de `lib/services/campaign-targets.ts` (Vega), documentada em ARQUITETURA §4.5.0. */
const FUNNEL_ORDER: readonly CampaignTargetStatus[] = ['pending', 'sent', 'delivered', 'read', 'responded'];

function funnelIndex(status: CampaignTargetStatus): number {
  const index = FUNNEL_ORDER.indexOf(status);
  return index === -1 ? -1 : index; // failed/skipped: fora do funil, tratados à parte.
}

/**
 * Conta cada alvo nos contadores de funil que ele JÁ alcançou — um alvo
 * `responded` incrementa `sent`, `delivered`, `read` E `responded` (mesma
 * semântica documentada em ARQUITETURA §4.5.7: "não são partição, não tente
 * somar para achar o total"). `failed`/`skipped` são absorventes e só contam
 * uma vez, no próprio contador.
 */
export function deriveCampaignStats(targets: CampaignTargetItem[]): CampaignStats {
  const stats: CampaignStats = {
    total: targets.length,
    pending: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    responded: 0,
    failed: 0,
    skipped: 0,
  };

  for (const target of targets) {
    if (target.status === 'failed') {
      stats.failed += 1;
      continue;
    }
    if (target.status === 'skipped') {
      stats.skipped += 1;
      continue;
    }
    if (target.status === 'pending') {
      stats.pending += 1;
      continue;
    }
    const reached = funnelIndex(target.status);
    if (reached >= funnelIndex('sent')) stats.sent += 1;
    if (reached >= funnelIndex('delivered')) stats.delivered += 1;
    if (reached >= funnelIndex('read')) stats.read += 1;
    if (reached >= funnelIndex('responded')) stats.responded += 1;
  }

  return stats;
}

/** `deliveryRate`/`responseRate` — mesma fórmula de ARQUITETURA §4.5.7 (`.../sentCount`, 0 se `sentCount = 0`). */
export function deriveCampaignRates(stats: CampaignStats): CampaignRates {
  if (stats.sent === 0) return { deliveryRate: 0, responseRate: 0 };
  return {
    deliveryRate: stats.delivered / stats.sent,
    responseRate: stats.responded / stats.sent,
  };
}

export type CampaignProgressSegments = {
  /** entregue, lida ou respondida — o "melhor" estado observável, mesmo tom de verde do resto do app. */
  succeededPercent: number;
  /** enviada, aguardando confirmação — em voo. */
  inFlightPercent: number;
  failedPercent: number;
  skippedPercent: number;
  /** o que resta do total — ainda na fila. Nunca calculado por subtração de um "percent" da API (não existe um aqui, de propósito). */
  pendingPercent: number;
};

/**
 * Segmentos da barra de progresso — cada um deriva DIRETO de `stats`, nunca
 * de um campo de percentual solto. `succeeded` agrega delivered+read+
 * responded (todos "melhor que só enviado"); `inFlight` é só quem ainda não
 * passou disso (`sent` mas não `delivered`).
 */
export function computeCampaignProgressSegments(stats: CampaignStats): CampaignProgressSegments {
  const { total } = stats;
  if (total === 0) {
    return { succeededPercent: 0, inFlightPercent: 0, failedPercent: 0, skippedPercent: 0, pendingPercent: 0 };
  }
  const succeeded = stats.delivered; // delivered já inclui read/responded (funil acumulado)
  const inFlight = Math.max(0, stats.sent - stats.delivered);
  const pct = (n: number) => Math.min(100, (n / total) * 100);
  return {
    succeededPercent: pct(succeeded),
    inFlightPercent: pct(inFlight),
    failedPercent: pct(stats.failed),
    skippedPercent: pct(stats.skipped),
    pendingPercent: pct(stats.pending),
  };
}
