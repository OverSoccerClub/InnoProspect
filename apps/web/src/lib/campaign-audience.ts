/**
 * lib/campaign-audience.ts — a mesma conta que `POST /campaigns` faz no
 * backend (ARQUITETURA.md §4.5.2/§4.5.4), replicada aqui em cima do MESMO
 * dado que os mocks já usam (`LeadListItem`), para a tela de montagem de
 * campanha poder mostrar "800 encontrados → 430 elegíveis" com os motivos
 * discriminados ANTES de qualquer chamada de rede — sem isso, cada tecla no
 * filtro de audiência exigiria criar (e descartar) um rascunho de campanha
 * só para ver o corte.
 *
 * Puro e sem I/O de propósito (mesmo motivo de `lib/pagination.ts` e
 * `lib/lead-filter-state.ts`): testável sem React, e reaproveitado pelo mock
 * de `POST /campaigns` (`mocks/campaigns.ts`) para a resposta real nunca
 * poder contradizer o que a tela mostrou no preview.
 *
 * Ordem de avaliação — CADA lead conta em UM motivo só, o primeiro que casar
 * (ARQUITETURA.md §4.5.4, tabela "os motivos de exclusão, em ordem"): sem
 * telefone → fixo → já descadastrado → telefone duplicado (mantém o mais
 * antigo) → contatado recentemente → já alvo de outra campanha.
 *
 * 🆕 Fase 4.D (Vega, backend real) — `alreadyTargeted` (§4.5.4, item v1.2)
 * ENTROU no contrato (`campaignAudienceExcludedSchema` agora tem os 6
 * campos), então este arquivo precisou ganhar o campo para não quebrar o
 * tipo. ⚠️ LIMITAÇÃO DE PREVIEW, documentada e não escondida: o cálculo
 * client-side aqui NÃO sabe quais leads já são alvo `pending` de outra
 * campanha (isso mora no Postgres, não em `LeadListItem`) — `alreadyTargeted`
 * fica sempre `0` neste preview, e o número real só aparece na resposta de
 * verdade do `POST /campaigns` (backend, `lib/services/campaigns.ts#
 * classifyAudience`). Ou seja: o preview pode mostrar "mais elegíveis" do
 * que a criação real vai confirmar — aceitável (é só isso, uma prévia antes
 * de criar), mas a tela não deve prometer que os números batem 100%.
 */
import type { CampaignAudienceExcluded, CampaignAudienceSummary } from '@/types/campaign';
import type { LeadListItem } from '@/types/lead';

export type AudienceEligibilityInput = {
  leads: LeadListItem[];
  /** Default 30 — mesmo default de `skipRecentlyContactedDays` no contrato. */
  skipRecentlyContactedDays?: number;
  /** Injetável para teste; produção usa `Date.now()`. */
  now?: Date;
};

export type AudienceEligibilityResult = {
  summary: CampaignAudienceSummary;
  /** Os leads que sobreviveram aos 5 filtros — quem entra em `CampaignTarget`. */
  eligibleLeads: LeadListItem[];
};

const MS_PER_DAY = 86_400_000;

/**
 * Decide o motivo de exclusão de UM lead, ou `null` se ele é elegível — os
 * primeiros 3 motivos dependem só do próprio lead; `duplicatePhone` e
 * `recentlyContacted` dependem do que já foi decidido para os leads
 * anteriores nesta MESMA audiência (por isso ficam fora desta função, em
 * `computeCampaignAudience`, que processa a lista em ordem).
 */
function exclusionReasonForOwnFields(lead: LeadListItem): 'noPhone' | 'landline' | 'optedOut' | null {
  if (!lead.phoneE164) return 'noPhone';
  if (lead.phoneType === 'landline') return 'landline';
  if (lead.isOptedOut) return 'optedOut';
  return null;
}

/**
 * Mantém a ordem de chegada de `leads` (a API real ordena por `createdAt`
 * asc antes de aplicar `duplicatePhone`, "mantém o mais antigo" — ARQUITETURA
 * §4.5.4 item 4). Quem chamar com leads fora de ordem de criação decide por
 * conta própria qual "sobrevive" ao duplicatePhone — documentado aqui para
 * não ser lido como bug.
 */
export function computeCampaignAudience(input: AudienceEligibilityInput): AudienceEligibilityResult {
  const { leads, skipRecentlyContactedDays = 30, now = new Date() } = input;

  const excluded: CampaignAudienceExcluded = {
    optedOut: 0,
    landline: 0,
    noPhone: 0,
    recentlyContacted: 0,
    duplicatePhone: 0,
    // 🆕 Fase 4.D — sempre 0 aqui (ver comentário de cabeçalho do arquivo).
    alreadyTargeted: 0,
  };
  const eligibleLeads: LeadListItem[] = [];
  const seenPhones = new Set<string>();
  const recentThresholdMs = now.getTime() - skipRecentlyContactedDays * MS_PER_DAY;

  for (const lead of leads) {
    const ownReason = exclusionReasonForOwnFields(lead);
    if (ownReason) {
      excluded[ownReason] += 1;
      continue;
    }

    // A partir daqui, `lead.phoneE164` existe (passou por `noPhone` acima).
    const phone = lead.phoneE164!;
    if (seenPhones.has(phone)) {
      excluded.duplicatePhone += 1;
      continue;
    }

    if (lead.lastContactedAt && new Date(lead.lastContactedAt).getTime() > recentThresholdMs) {
      excluded.recentlyContacted += 1;
      continue;
    }

    seenPhones.add(phone);
    eligibleLeads.push(lead);
  }

  const totalMatched = leads.length;
  const eligible = eligibleLeads.length;

  return {
    summary: { totalMatched, eligible, excluded },
    eligibleLeads,
  };
}

export type AudienceExclusionReasonKey = keyof CampaignAudienceExcluded;

/**
 * Rótulo + explicação de CADA motivo (ARQUITETURA §4.5.4, coluna "por que
 * existe") — a tela nunca mostra só o número, sempre com o motivo em texto
 * (requisito do dono: "precisa conseguir dizer 'esse está errado'").
 */
export const AUDIENCE_EXCLUSION_LABEL: Record<AudienceExclusionReasonKey, { label: string; hint: string }> = {
  noPhone: { label: 'Sem telefone', hint: 'Não há número cadastrado — não há para onde enviar.' },
  landline: { label: 'Telefone fixo', hint: 'Fixo não recebe WhatsApp; não existe permissão para ignorar isto numa campanha.' },
  optedOut: { label: 'Já descadastrado', hint: 'Respondeu "SAIR" ou foi removido manualmente — portão inegociável.' },
  duplicatePhone: {
    label: 'Telefone duplicado',
    hint: 'Outro lead da mesma audiência já usa este número — mantido só o registro mais antigo, para não mandar a mesma mensagem duas vezes.',
  },
  recentlyContacted: {
    label: 'Contatado recentemente',
    hint: 'Já recebeu mensagem dentro da janela configurada — abordagem repetida é o padrão que gera denúncia.',
  },
  // 🆕 Fase 4.D — sempre 0 neste preview (client não sabe de outras
  // campanhas); o número real vem do backend na criação.
  alreadyTargeted: {
    label: 'Já em outra campanha',
    hint: 'Já é alvo pendente de outra campanha ativa — evita mandar duas abordagens frias para o mesmo lead. Só confirmado no momento de criar a campanha.',
  },
};

/** Ordem fixa de exibição — mesma ordem de avaliação do backend (§4.5.4), não ordem alfabética nem por contagem. */
export const AUDIENCE_EXCLUSION_ORDER: readonly AudienceExclusionReasonKey[] = [
  'noPhone',
  'landline',
  'optedOut',
  'duplicatePhone',
  'recentlyContacted',
  'alreadyTargeted',
];
