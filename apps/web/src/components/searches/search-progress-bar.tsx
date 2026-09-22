import { cn } from '@/lib/utils';

type SearchProgressBarProps = {
  progress: { total: number; done: number; failed: number };
  className?: string;
};

/**
 * Barra de progresso de uma busca — 3 segmentos (concluído / falhou /
 * pendente) calculados localmente a partir de `done`/`failed`/`total`, os
 * mesmos números que o rótulo ao lado mostra. Nunca usa `progress.percent`
 * da API pra desenhar a barra: esse campo é ambíguo (pode contar só
 * concluídos ou concluídos+falhos, dependendo de quem implementou) e foi
 * exatamente isso que causou o bug relatado — barra cheia ao lado de
 * "0/5 municípios". Derivar os segmentos direto de `done`/`failed`/`total`
 * garante que a barra NUNCA pode contradizer o texto, seja qual for a
 * fórmula que a API usa em `percent`.
 */
export function SearchProgressBar({ progress, className }: SearchProgressBarProps) {
  const { total, done, failed } = progress;
  const donePercent = total === 0 ? 0 : Math.min(100, (done / total) * 100);
  const failedPercent = total === 0 ? 0 : Math.min(100 - donePercent, (failed / total) * 100);

  const label = `${done} de ${total} municípios concluídos${failed > 0 ? `, ${failed} com falha` : ''}`;

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(donePercent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('flex h-2 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div className="h-full bg-success transition-all" style={{ width: `${donePercent}%` }} />
      {failed > 0 && <div className="h-full bg-destructive transition-all" style={{ width: `${failedPercent}%` }} />}
    </div>
  );
}
