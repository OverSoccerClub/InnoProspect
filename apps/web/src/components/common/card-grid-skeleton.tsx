import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading para telas em grade de cards (ex.: lista de Buscas, Instâncias de
 * WhatsApp) — reserva a mesma geometria do card final (caixa de ícone +
 * título + 2 linhas de meta) em vez de um spinner solitário, para o layout
 * não "pular" quando o dado real chega. Companheiro de `LoadingRows`
 * (`components/common/loading-rows.tsx`, mesma ideia para `<table>`).
 */
export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Carregando…">
      {Array.from({ length: count }).map((_, index) => (
        <Card key={index}>
          <CardContent className="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-3">
              <Skeleton className="size-9 shrink-0 rounded-lg" />
              <Skeleton className="h-4 w-2/3" />
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
