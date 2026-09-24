import { computeCampaignProgressSegments } from '@/lib/campaign-progress';
import { cn } from '@/lib/utils';
import type { CampaignStats } from '@/types/campaign';

type CampaignProgressBarProps = {
  stats: CampaignStats;
  className?: string;
};

/**
 * Barra de progresso de campanha — mesma disciplina de `SearchProgressBar`
 * (`components/searches/search-progress-bar.tsx`): cada segmento deriva
 * DIRETO dos mesmos contadores que o texto ao lado mostra
 * (`computeCampaignProgressSegments`, `lib/campaign-progress.ts`), nunca de
 * um percentual solto — é o que impede a barra de contradizer a legenda
 * (bug real já visto em `/buscas`, ver memória da Lyra).
 *
 * 5 segmentos (não 3, como busca): sucesso (entregue/lida/respondida) →
 * em voo (enviada, sem confirmação) → falhou → pulado → pendente (resto,
 * é a cor de fundo da trilha — nunca desenhado por cima).
 */
export function CampaignProgressBar({ stats, className }: CampaignProgressBarProps) {
  const segments = computeCampaignProgressSegments(stats);
  const label = `${stats.delivered} de ${stats.total} entregues${stats.failed > 0 ? `, ${stats.failed} falharam` : ''}${
    stats.pending > 0 ? `, ${stats.pending} na fila` : ''
  }`;

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(segments.succeededPercent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('flex h-2 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div className="h-full bg-success transition-all" style={{ width: `${segments.succeededPercent}%` }} />
      <div className="h-full bg-primary/60 transition-all" style={{ width: `${segments.inFlightPercent}%` }} />
      {segments.failedPercent > 0 && <div className="h-full bg-destructive transition-all" style={{ width: `${segments.failedPercent}%` }} />}
      {segments.skippedPercent > 0 && <div className="h-full bg-muted-foreground/40 transition-all" style={{ width: `${segments.skippedPercent}%` }} />}
    </div>
  );
}
