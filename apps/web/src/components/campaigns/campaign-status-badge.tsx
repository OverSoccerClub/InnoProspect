import { AlertOctagon, Ban, CalendarClock, CheckCircle2, FileEdit, Pause, Radio } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { CampaignStatus } from '@inno/contracts';

/**
 * Ainda sem tela de verdade (`/campanhas` hoje é só o roadmap da Fase 4,
 * `components/campaigns/campaign-roadmap.tsx`) — componente deixado pronto
 * para não improvisar a semântica no meio da implementação.
 * Mapa definido em DESIGN-SYSTEM.md §5.3: `halted` e `paused` são os dois
 * que mais importa não confundir — `paused` é ação humana e esperada,
 * `halted` é parada automática de segurança que exige reconhecimento
 * (`acknowledgeHalt`, ver `campaign.contract.ts`). A diferença nunca é só a
 * cor: ícone e texto também mudam.
 */
const LABEL: Record<CampaignStatus, string> = {
  draft: 'Rascunho',
  scheduled: 'Agendada',
  running: 'Em andamento',
  paused: 'Pausada',
  completed: 'Concluída',
  cancelled: 'Cancelada',
  halted: 'Interrompida automaticamente',
};

const VARIANT: Record<CampaignStatus, 'default' | 'secondary' | 'outline' | 'success' | 'destructive'> = {
  draft: 'secondary',
  scheduled: 'outline',
  running: 'default',
  paused: 'outline',
  completed: 'success',
  cancelled: 'secondary',
  halted: 'destructive',
};

const ICON: Record<CampaignStatus, typeof Radio> = {
  draft: FileEdit,
  scheduled: CalendarClock,
  running: Radio,
  paused: Pause,
  completed: CheckCircle2,
  cancelled: Ban,
  halted: AlertOctagon,
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const Icon = ICON[status];
  return (
    <Badge variant={VARIANT[status]}>
      <Icon aria-hidden="true" className={status === 'running' ? 'animate-pulse' : undefined} />
      {LABEL[status]}
    </Badge>
  );
}
