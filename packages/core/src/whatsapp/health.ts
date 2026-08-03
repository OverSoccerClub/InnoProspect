/**
 * whatsapp/health.ts — deriva `instanceHealthSchema` (`ok|warming|degraded|
 * blocked`, `@inno/contracts`) a partir de `WhatsAppInstance.status` +
 * `isDegraded` + `warmupDay` (ARQUITETURA §4.6: "não existe coluna 'health'
 * 1:1 — é DERIVADO, para não ter duas fontes de verdade").
 *
 * Mapeamento (decisão do Vega — a ARQUITETURA descreve os 4 valores mas não
 * a fórmula exata de combinação com `status`/`isDegraded`):
 *   - `status === 'banned'`                  → `blocked` (§6.6 kill switch)
 *   - `isDegraded === true`                  → `degraded` (§6.2/§6.6, tem prioridade
 *                                                sobre o cálculo de warmup — uma
 *                                                instância pode estar `connected`
 *                                                E degradada ao mesmo tempo)
 *   - `status === 'connected'` e `isWarm`    → `ok`
 *   - `status === 'connected'` e `!isWarm`   → `warming`
 *   - qualquer outro `status` (disconnected/
 *     connecting/qr_pending, não banida)     → `warming` (ainda não está
 *                                                operando normalmente; mais
 *                                                perto de "aquecendo/parada"
 *                                                do que de um alerta de risco)
 */
import type { InstanceHealth, WhatsAppInstanceStatus } from '@inno/contracts';
import { isWarmupDayWarm } from './warmup.js';

export type DeriveInstanceHealthInput = {
  status: WhatsAppInstanceStatus;
  isDegraded: boolean;
  warmupDay: number;
};

export function deriveInstanceHealth({ status, isDegraded, warmupDay }: DeriveInstanceHealthInput): InstanceHealth {
  if (status === 'banned') return 'blocked';
  if (isDegraded) return 'degraded';
  if (status === 'connected') return isWarmupDayWarm(warmupDay) ? 'ok' : 'warming';
  return 'warming';
}
