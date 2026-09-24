'use client';

import { Clock, HelpCircle } from 'lucide-react';

import { useNow } from '@/hooks/useNow';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { getStatusFreshnessLevel } from '@/lib/whatsapp-freshness';

type StatusFreshnessProps = {
  statusCheckedAt: string | null;
  /**
   * `true` quando o `status` ATUAL da instância é `connected` — é a
   * combinação perigosa do incidente 2026-09-24 ("mesmo desconectado, o
   * sistema ainda mostra conectado"): um "Conectado" que ninguém confirma há
   * muito tempo pode estar mentindo. Para qualquer outro status, a mesma
   * demora é só "ainda não perguntamos de novo" — bem menos grave.
   */
  isConnected: boolean;
  className?: string;
};

/**
 * Selo textual de frescor — "confirmado há 2 min" / "confirmado há 40 min" /
 * "nunca confirmado". Envelhece sozinho na tela (`useNow`) sem precisar de
 * novo fetch. Deliberadamente NUNCA vermelho/destructive: é "não sei", não
 * "quebrou" — na maioria das vezes está tudo bem e só não houve motivo para
 * reconferir ainda (pedido explícito do dono). O peso visual só sobe quando
 * a instância está `connected` (`isConnected`), porque é aí que a
 * incerteza importa de verdade.
 */
export function StatusFreshness({ statusCheckedAt, isConnected, className }: StatusFreshnessProps) {
  const now = useNow();
  const level = getStatusFreshnessLevel(statusCheckedAt, now);
  const label = statusCheckedAt ? `Confirmado ${formatRelative(statusCheckedAt)}` : 'Nunca confirmado';

  if (level === 'fresh') {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}>
        <Clock className="size-3" aria-hidden="true" />
        {label}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        isConnected ? 'font-medium text-warning-foreground dark:text-warning' : 'text-muted-foreground',
        className,
      )}
      title={
        isConnected
          ? 'Ainda não reconfirmamos esta conexão com a Evolution API — pode estar desatualizado. Use "Verificar agora" se precisar ter certeza.'
          : 'Ainda não reconfirmamos este status com a Evolution API.'
      }
    >
      <HelpCircle className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
}
