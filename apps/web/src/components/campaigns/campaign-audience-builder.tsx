'use client';

import { useEffect, useState } from 'react';
import { ListChecks, SlidersHorizontal } from 'lucide-react';

import { CampaignAudienceSummaryCard } from '@/components/campaigns/campaign-audience-summary';
import { CampaignAudienceIdPicker } from '@/components/campaigns/campaign-audience-id-picker';
import { LeadFilters } from '@/components/leads/lead-filters';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { previewCampaignAudience } from '@/lib/api/campaigns';
import { EMPTY_LEADS_FILTER, hasAnyLeadFilter, toApiLeadFilter, type LeadsFilterState } from '@/lib/lead-filter-state';
import { cn } from '@/lib/utils';
import type { CampaignAudienceSummary } from '@/types/campaign';

export type CampaignAudienceValue = { mode: 'filter'; filter: LeadsFilterState } | { mode: 'ids'; leadIds: string[] };

export const EMPTY_CAMPAIGN_AUDIENCE: CampaignAudienceValue = { mode: 'filter', filter: EMPTY_LEADS_FILTER };

type CampaignAudienceBuilderProps = {
  value: CampaignAudienceValue;
  onChange: (value: CampaignAudienceValue) => void;
  skipRecentlyContactedDays: number;
  /** O form pai usa isto para saber se pode habilitar "Criar campanha" (precisa de eligible > 0). */
  onSummaryChange: (summary: CampaignAudienceSummary | null) => void;
};

/**
 * O bloco que decide QUEM entra na campanha — dois modos, mesma ideia de
 * `campaignAudienceInputSchema` (`@inno/contracts`, discriminated union):
 * "por filtro" (reaproveita a barra de `/leads` inteira, já madura com 13
 * campos) ou "por lista" (escolher leads um a um, útil para um público
 * pequeno e específico que não vira um filtro limpo). Cada mexida recalcula
 * a prévia (`previewCampaignAudience`, debounced) e mostra o corte —
 * requisito central do dono ("o dono precisa olhar esse número e conseguir
 * dizer 'esse está errado'"), ANTES de qualquer chamada que crie algo.
 */
export function CampaignAudienceBuilder({ value, onChange, skipRecentlyContactedDays, onSummaryChange }: CampaignAudienceBuilderProps) {
  const [summary, setSummary] = useState<CampaignAudienceSummary | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewUnavailable, setPreviewUnavailable] = useState(false);

  const debouncedKey = useDebouncedValue(JSON.stringify(value), 400);

  useEffect(() => {
    const parsed: CampaignAudienceValue = JSON.parse(debouncedKey);
    const isEmpty = parsed.mode === 'filter' ? !hasAnyLeadFilter(parsed.filter) : parsed.leadIds.length === 0;
    if (isEmpty) {
      setSummary(null);
      onSummaryChange(null);
      return;
    }

    let cancelled = false;
    setIsPreviewing(true);
    const audienceInput =
      parsed.mode === 'ids' ? { mode: 'ids' as const, leadIds: parsed.leadIds } : { mode: 'filter' as const, filter: toApiLeadFilter(parsed.filter) };

    previewCampaignAudience(audienceInput, skipRecentlyContactedDays)
      .then((result) => {
        if (cancelled) return;
        setPreviewUnavailable(result === null);
        setSummary(result);
        onSummaryChange(result);
      })
      .finally(() => {
        if (!cancelled) setIsPreviewing(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedKey, skipRecentlyContactedDays]);

  function setMode(mode: CampaignAudienceValue['mode']) {
    if (mode === value.mode) return;
    onChange(mode === 'filter' ? { mode: 'filter', filter: EMPTY_LEADS_FILTER } : { mode: 'ids', leadIds: [] });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2" role="radiogroup" aria-label="Como escolher o público da campanha">
        <ModeButton icon={SlidersHorizontal} label="Por filtro" isActive={value.mode === 'filter'} onClick={() => setMode('filter')} />
        <ModeButton icon={ListChecks} label="Por lista de leads" isActive={value.mode === 'ids'} onClick={() => setMode('ids')} />
      </div>

      {value.mode === 'filter' ? (
        <LeadFilters value={value.filter} onChange={(filter) => onChange({ mode: 'filter', filter })} />
      ) : (
        <CampaignAudienceIdPicker selected={value.leadIds} onChange={(leadIds) => onChange({ mode: 'ids', leadIds })} />
      )}

      {isPreviewing && !summary && <Skeleton className="h-32 w-full" />}

      {summary && <CampaignAudienceSummaryCard summary={summary} isPreview className={cn(isPreviewing && 'opacity-70')} />}

      {previewUnavailable && (
        <p className="text-xs text-muted-foreground">
          A prévia de público não está disponível neste ambiente — o corte completo (&quot;encontrados → elegíveis&quot;, com cada motivo) aparece
          assim que você criar a campanha.
        </p>
      )}
    </div>
  );
}

function ModeButton({
  icon: Icon,
  label,
  isActive,
  onClick,
}: {
  icon: typeof SlidersHorizontal;
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isActive}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        isActive ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:bg-accent',
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      {label}
    </button>
  );
}
