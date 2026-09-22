import { AlertOctagon, AlertTriangle, Ban, CheckCircle2, CircleAlert, Clock, Loader2, Pause } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { getSearchJobOutcome, type SearchJobOutcome } from '@/lib/search-job-outcome';
import type { SearchJobSummary } from '@/types/search';

const CONFIG: Record<
  SearchJobOutcome,
  { label: string; variant: 'default' | 'secondary' | 'success' | 'destructive' | 'warning' | 'outline'; icon: typeof Clock }
> = {
  queued: { label: 'Na fila', variant: 'secondary', icon: Clock },
  running: { label: 'Em andamento', variant: 'default', icon: Loader2 },
  paused: { label: 'Pausada', variant: 'warning', icon: Pause },
  cancelled: { label: 'Cancelada', variant: 'outline', icon: Ban },
  // Job em si não conseguiu continuar (crash) — diferente de "rodou e falhou tudo".
  failed: { label: 'Falhou', variant: 'destructive', icon: AlertOctagon },
  completed_success: { label: 'Concluída', variant: 'success', icon: CheckCircle2 },
  // Terminou, mas parte dos municípios falhou — não é sucesso nem fracasso total.
  completed_partial: { label: 'Concluída com falhas', variant: 'warning', icon: AlertTriangle },
  // Terminou de processar todos os municípios e NENHUM deu resultado — o
  // selo verde de sucesso seria uma mentira aqui (achado real em produção).
  completed_empty: { label: 'Sem resultados', variant: 'destructive', icon: CircleAlert },
};

export function SearchJobStatusBadge({ job }: { job: Pick<SearchJobSummary, 'status' | 'progress'> }) {
  const outcome = getSearchJobOutcome(job);
  const config = CONFIG[outcome];
  const Icon = config.icon;
  return (
    <Badge variant={config.variant}>
      <Icon aria-hidden="true" className={outcome === 'running' ? 'animate-spin' : undefined} />
      {config.label}
    </Badge>
  );
}
