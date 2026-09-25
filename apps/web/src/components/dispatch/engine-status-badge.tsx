import { Pause, Play } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { DispatchQueueStatus } from '@/types/dispatch-queue';

/**
 * Selo do estado do motor de disparo. `paused` usa `variant="secondary"` (a
 * mesma cor neutra do resto do sistema, NUNCA `warning`/`destructive`) de
 * propósito: o motor NASCE pausado (ARQUITETURA §6.8.9) e continua pausado
 * até alguém decidir ligá-lo — é o estado inicial normal, não um incidente.
 * Só `running` ganha `success`, porque é o estado que carrega risco (mensagem
 * de verdade saindo).
 */
export function EngineStatusBadge({ status }: { status: DispatchQueueStatus }) {
  if (status === 'running') {
    return (
      <Badge variant="success">
        <Play aria-hidden="true" />
        Motor ligado
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      <Pause aria-hidden="true" />
      Motor pausado
    </Badge>
  );
}
