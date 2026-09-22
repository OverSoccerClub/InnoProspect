import { Clock, MapPinned, Radar } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDurationMinutes } from '@/lib/format';
import { estimateSearchDurationMinutes } from '@/lib/search-estimate';

type SearchSummaryPanelProps = {
  niche: string;
  ufLabel: string | null;
  /** > 0 = cidades escolhidas manualmente; 0 = fanout pra UF inteira (usa `ufCityCount`). */
  selectedCityCount: number;
  ufCityCount: number | null;
  maxResultsPerCity: number;
};

/**
 * Resumo ao vivo do que a busca vai varrer — a informação existe no banco
 * (`Uf.cityCount`, real, não sintético) e não era mostrada em lugar nenhum
 * antes do envio. Atualiza a cada tecla, sem chamada de API extra (usa os
 * mesmos dados que `useUfs`/`CitySelector` já buscaram).
 */
export function SearchSummaryPanel({ niche, ufLabel, selectedCityCount, ufCityCount, maxResultsPerCity }: SearchSummaryPanelProps) {
  const targetCityCount = selectedCityCount > 0 ? selectedCityCount : (ufCityCount ?? 0);
  const estimatedMinutes = estimateSearchDurationMinutes(targetCityCount);
  const maxLeadsEstimate = targetCityCount * maxResultsPerCity;

  return (
    <Card variant="elevated" className="lg:sticky lg:top-20">
      <CardHeader>
        <CardTitle className="text-base">Resumo da busca</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">{niche.trim() || 'Nicho ainda não informado'}</p>
          <p className="text-xs text-muted-foreground">{ufLabel ?? 'Escolha uma UF para ver o alcance da busca'}</p>
        </div>

        {ufLabel && (
          <dl className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <MapPinned className="size-4" aria-hidden="true" />
                Municípios varridos
              </dt>
              <dd className="font-medium tabular-nums text-foreground">
                {targetCityCount}
                {selectedCityCount === 0 && ufCityCount !== null && <span className="text-muted-foreground"> (todos)</span>}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="size-4" aria-hidden="true" />
                Tempo estimado
              </dt>
              <dd className="font-medium tabular-nums text-foreground">
                {targetCityCount > 0 ? `~${formatDurationMinutes(estimatedMinutes)}` : '—'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <Radar className="size-4" aria-hidden="true" />
                Teto de leads
              </dt>
              <dd className="font-medium tabular-nums text-foreground">{targetCityCount > 0 ? `até ${maxLeadsEstimate}` : '—'}</dd>
            </div>
          </dl>
        )}

        <p className="text-xs text-muted-foreground">
          Estimativa aproximada (~40s por município, com concorrência do scraper) — o tempo real depende da
          carga do momento.
        </p>
      </CardContent>
    </Card>
  );
}
