'use client';

import { Activity, HeartCrack } from 'lucide-react';

import { getDispatchHeartbeatLevel } from '@/lib/dispatch-heartbeat';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

type WorkerHeartbeatProps = {
  lastTickAt: string | null;
  /**
   * Relógio de quem chama (`useNow()`, ver `DispatchEngineCard`) — recebido
   * como prop em vez de chamado aqui de novo de propósito: o card também
   * precisa do mesmo `now` para decidir o alerta "ligado mas sem sinal", e
   * dois `useNow()` independentes teriam intervalos de re-render próprios,
   * podendo mostrar o badge e o alerta em momentos de atualização diferentes
   * (drift de até 30s entre os dois). Uma fonte só evita a inconsistência.
   */
  now: number;
  className?: string;
};

/**
 * Sinal de vida do WORKER (processo que efetivamente dispara mensagens) —
 * independente de o motor estar ligado ou pausado, ver `lib/dispatch-
 * heartbeat.ts`. Envelhece sozinho na tela (`now` vem de um `useNow()` no
 * componente pai, ver comentário de `now` acima), mesmo espírito de
 * `StatusFreshness` (WhatsApp), mas com limiares próprios: o heartbeat daqui
 * bate a cada 15s, não a cada minuto.
 *
 * `lagging`/`dead` recebem o MESMO tratamento visual (a diferença é só o
 * texto) — a partir do momento em que o pulso atrasa, "quanto" já não importa
 * tanto pro operador quanto "confio ou não confio nisso agora".
 */
export function WorkerHeartbeat({ lastTickAt, now, className }: WorkerHeartbeatProps) {
  const level = getDispatchHeartbeatLevel(lastTickAt, now);
  const label = lastTickAt ? `Último sinal ${formatRelative(lastTickAt)}` : 'Nenhum sinal do worker ainda';

  if (level === 'alive') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-sm text-muted-foreground', className)}>
        <Activity className="size-3.5 text-success" aria-hidden="true" />
        Worker ativo · {label}
      </span>
    );
  }

  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-sm font-medium text-warning-foreground dark:text-warning', className)}
      title="O worker não dá sinal há tempo demais. Pode ter caído — nenhuma mensagem sai enquanto ele estiver assim, mesmo com o motor ligado."
    >
      <HeartCrack className="size-3.5" aria-hidden="true" />
      Worker sem sinal · {label}
    </span>
  );
}
