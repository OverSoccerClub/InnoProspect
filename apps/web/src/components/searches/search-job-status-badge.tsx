import { Badge } from '@/components/ui/badge';
import type { SearchJobStatus } from '@/types/search';

const CONFIG: Record<SearchJobStatus, { label: string; variant: 'default' | 'secondary' | 'success' | 'destructive' | 'warning' | 'outline' }> = {
  queued: { label: 'Na fila', variant: 'secondary' },
  running: { label: 'Em andamento', variant: 'default' },
  paused: { label: 'Pausada', variant: 'warning' },
  completed: { label: 'Concluída', variant: 'success' },
  failed: { label: 'Falhou', variant: 'destructive' },
  cancelled: { label: 'Cancelada', variant: 'outline' },
};

export function SearchJobStatusBadge({ status }: { status: SearchJobStatus }) {
  const config = CONFIG[status];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
