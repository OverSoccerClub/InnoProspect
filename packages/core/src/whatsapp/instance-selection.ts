/**
 * whatsapp/instance-selection.ts — passo 2 da escolha de instância
 * (ARQUITETURA §6.8.4): "senão, round-robin PONDERADO — peso =
 * `quotaRestante × (isDegraded ? 0.3 : 1)`, sorteio proporcional". O passo 1
 * (afinidade lead→instância) e o passo 3 (ninguém elegível → soltar o alvo)
 * são do `dispatch-tick.job` (4.F.4, tem `CampaignTarget`/`Message`, que
 * este pacote não conhece) — aqui só o sorteio, puro.
 *
 * Ponderar pela cota restante em vez de guardar "de quem era a vez" é a
 * decisão documentada em §6.8.4: distribui sem precisar de um estado extra
 * (um "índice do próximo" por campanha) que poderia dessincronizar entre
 * ticks concorrentes.
 *
 * `rng` é injetável — mesmo padrão de `jitter.ts` (`RandomSource`
 * reaproveitado de lá, não duplicado: é o mesmo conceito, "fonte uniforme
 * em [0,1)", e este pacote já tem UM tipo para isso).
 */
import type { RandomSource } from './jitter.js';

export type WeightedInstanceCandidate = {
  instanceId: string;
  /** `effectiveDailyLimit - sentCount` de HOJE — negativa não deveria acontecer, mas é clampada em 0 aqui por segurança (nunca gera peso negativo). */
  quotaRemaining: number;
  /** `WhatsAppInstance` degradada (ARQUITETURA §6.6) — ainda participa da rotação, só que com 30% do peso. */
  isDegraded: boolean;
};

/** ARQUITETURA §6.8.4 — instância degradada pesa 0.3× a cota restante. */
const DEGRADED_WEIGHT_MULTIPLIER = 0.3;

function weightOf(candidate: WeightedInstanceCandidate): number {
  const quota = Math.max(0, candidate.quotaRemaining);
  return candidate.isDegraded ? quota * DEGRADED_WEIGHT_MULTIPLIER : quota;
}

/**
 * Sorteio proporcional ao peso (`quotaRestante × multiplicador`) — não
 * round-robin por índice, nem uniforme entre candidatos. `null` quando não
 * há ninguém elegível (lista vazia OU todo peso é zero, ex.: todas as
 * instâncias com cota esgotada) — quem chama decide o que fazer (§6.8.4
 * passo 3: soltar o alvo para a próxima abertura).
 */
export function pickInstanceWeighted(
  candidates: readonly WeightedInstanceCandidate[],
  rng: RandomSource = Math.random,
): WeightedInstanceCandidate | null {
  const weights = candidates.map(weightOf);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) return null;

  const draw = rng() * totalWeight;
  let cumulative = 0;
  for (let i = 0; i < candidates.length; i++) {
    cumulative += weights[i]!;
    if (draw < cumulative) return candidates[i]!;
  }
  // Só alcançável por erro de arredondamento de ponto flutuante (`draw`
  // caindo exatamente em `totalWeight`) — devolve o último candidato com
  // peso > 0 em vez de `null`, para nunca "perder" um sorteio válido por
  // causa de 1 ULP.
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (weights[i]! > 0) return candidates[i]!;
  }
  return null;
}
