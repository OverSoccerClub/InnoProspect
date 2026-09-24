/**
 * lib/campaign-creation-cache.ts — ponte de UX entre a criação e o detalhe
 * de uma campanha, dentro das costuras do contrato PUBLICADO hoje.
 *
 * Problema real: `campaignDetailSchema`/`campaignSummarySchema` NUNCA
 * expõem `audience`/`excluded` de novo depois da criação — esse bloco só
 * existe na resposta `201` de `POST /campaigns` (ver `campaign.contract.ts`).
 * Ou seja, "800 → 430, por motivo" É mostrado uma vez só, na hora de criar.
 * Isso é o contrato de verdade, não uma limitação inventada por mim — a
 * alternativa (fingir que `GET /campaigns/:id` devolve isso) seria inventar
 * contrato, proibido.
 *
 * Solução: cachear a resposta da criação no `sessionStorage` do navegador
 * (não no backend — é só UX local, "acabei de criar isto, deixa eu ver de
 * novo depois do redirect") e mostrar como um card "Resumo da criação"
 * dispensável na página de detalhe, lido uma vez. Fecha sozinho ao trocar
 * de aba/navegador — é exatamente o tempo de vida que essa informação
 * merece ter.
 */
import type { CreateCampaignResponse } from '@/types/campaign';

const KEY_PREFIX = 'inno_campaign_creation_summary_';

export function saveCampaignCreationSummary(response: CreateCampaignResponse): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`${KEY_PREFIX}${response.id}`, JSON.stringify(response));
  } catch {
    // sessionStorage indisponível (modo privado restrito etc.) — degrada
    // graciosamente: o operador só não vê o resumo flutuante, o resto da
    // tela de detalhe funciona igual.
  }
}

/** Lê UMA vez e remove — reabrir a mesma campanha depois não deve voltar a mostrar o resumo. */
export function readAndClearCampaignCreationSummary(campaignId: string): CreateCampaignResponse | null {
  if (typeof window === 'undefined') return null;
  const key = `${KEY_PREFIX}${campaignId}`;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    window.sessionStorage.removeItem(key);
    return JSON.parse(raw) as CreateCampaignResponse;
  } catch {
    return null;
  }
}
