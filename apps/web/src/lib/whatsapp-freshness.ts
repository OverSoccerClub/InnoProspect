/**
 * Frescor da última confirmação de status contra a Evolution API
 * (`WhatsAppInstanceItem.statusCheckedAt`, ver `@inno/contracts`).
 *
 * Nasceu do incidente do dono (2026-09-24): "mesmo o número estando
 * desconectado o sistema ainda fica mostrando como se ele estivesse
 * conectado". O backend agora reconcilia (`GET /whatsapp/instances` sozinho
 * a cada 60s por instância `connected`, e `POST .../reconcile` sob pedido —
 * ver `apps/web/src/lib/services/whatsapp-instances.ts`), mas a TELA
 * também precisa admitir quando não sabe: `statusCheckedAt` velho (ou nulo)
 * enquanto `status === 'connected'` é exatamente a combinação que pode
 * estar mentindo até a próxima leitura.
 *
 * Função pura, sem side-effect, para ser testável e compartilhada entre
 * `InstanceCard` e `SystemHealthCard` — nenhuma delas deve reimplementar o
 * limiar.
 */

/**
 * Limiar a partir do qual a confirmação vira "hesitante" na tela. Bem mais
 * generoso que o `STATUS_FRESHNESS_MS` (60s) do backend — aquele controla
 * a FREQUÊNCIA de reconciliação automática; este controla quando o
 * OPERADOR deve deixar de confiar cegamente no que está vendo. Um "conectado
 * confirmado há 90 segundos" ainda é uma leitura recente pro olho humano —
 * só a partir de alguns minutos sem confirmação é que vale desconfiar.
 */
export const STATUS_FRESHNESS_STALE_MS = 5 * 60_000;

export type StatusFreshnessLevel = 'fresh' | 'stale' | 'unknown';

/**
 * `unknown` = nunca confirmado desde que a coluna existe (`statusCheckedAt
 * === null`, ou valor que não parseia). `stale` = confirmado uma vez, mas há
 * mais tempo que `STATUS_FRESHNESS_STALE_MS`. `fresh` = tudo bem, dado
 * recente. `unknown`/`stale` recebem o MESMO tratamento visual (ambos são
 * "não sei", não "quebrou") — a distinção de rótulo existe só para o texto
 * ("nunca confirmado" vs. "confirmado há X"), nunca para a cor.
 */
export function getStatusFreshnessLevel(statusCheckedAt: string | null, now: number = Date.now()): StatusFreshnessLevel {
  if (!statusCheckedAt) return 'unknown';
  const checkedAtMs = new Date(statusCheckedAt).getTime();
  if (Number.isNaN(checkedAtMs)) return 'unknown';
  return now - checkedAtMs >= STATUS_FRESHNESS_STALE_MS ? 'stale' : 'fresh';
}
