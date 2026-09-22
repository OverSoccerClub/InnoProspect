import { BarChart3, Filter, MapPinned } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const PREVIEW_ITEMS = [
  {
    icon: BarChart3,
    title: 'Gráfico de evolução',
    description: 'Leads coletados nos últimos 30 dias, dia a dia.',
  },
  {
    icon: Filter,
    title: 'Funil de status',
    description: 'Do primeiro contato até o negócio fechado.',
  },
  {
    icon: MapPinned,
    title: 'Destaques por UF e categoria',
    description: 'Onde e em que nicho os leads estão se concentrando.',
  },
];

/**
 * Prévia do que o painel rico mostra assim que a conta tiver leads —
 * substitui um vazio grande ao lado do card de saúde do sistema no primeiro
 * acesso (a 1ª versão deixava "Saúde do sistema" sozinho em 1/3 da largura,
 * com o resto da linha em branco). Deliberadamente sem número nenhum: é
 * honesto sobre ser uma prévia, não finge dado real ainda inexistente.
 */
export function DashboardPreviewCard({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="!font-sans text-sm font-medium text-muted-foreground">
          O que aparece aqui quando os leads chegarem
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {PREVIEW_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.title} className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 text-muted-foreground">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">{item.title}</p>
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
