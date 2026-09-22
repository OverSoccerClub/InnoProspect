import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LEAD_STATUS_LABEL, type LeadStatus } from '@/types/lead';

// Ordem de funil (estágio, não alfabética) — mesma leitura de
// DESIGN-SYSTEM.md §5.1. `discarded` fica fora do funil "pra frente": é
// terminal negativo, mostrado por último e com cor neutra-fria, não como se
// fosse o próximo estágio depois de `won`.
const FUNNEL_ORDER: LeadStatus[] = ['new', 'validated', 'contacted', 'responded', 'negotiating', 'won'];

const BAR_COLOR: Record<LeadStatus, string> = {
  new: 'bg-muted-foreground/25',
  validated: 'bg-muted-foreground/45',
  contacted: 'bg-primary',
  responded: 'bg-warning',
  negotiating: 'bg-warning',
  won: 'bg-success',
  discarded: 'bg-destructive/60',
};

export function StatusFunnel({ byStatus, className }: { byStatus: Record<LeadStatus, number>; className?: string }) {
  const max = Math.max(...FUNNEL_ORDER.map((s) => byStatus[s] ?? 0), 1);
  const discarded = byStatus.discarded ?? 0;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="!font-sans text-sm font-medium text-muted-foreground">Funil de leads</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {FUNNEL_ORDER.map((status) => {
          const count = byStatus[status] ?? 0;
          const percent = Math.max(4, (count / max) * 100);
          return (
            <div key={status} className="flex items-center gap-2.5">
              <span className="w-24 shrink-0 text-xs text-muted-foreground">{LEAD_STATUS_LABEL[status]}</span>
              <div className="h-5 flex-1 overflow-hidden rounded-md bg-muted">
                <div className={`h-full rounded-md ${BAR_COLOR[status]} transition-[width]`} style={{ width: `${percent}%` }} />
              </div>
              <span className="w-8 shrink-0 text-right text-xs font-medium tabular-nums text-foreground">{count}</span>
            </div>
          );
        })}
        {discarded > 0 && (
          <div className="mt-1 flex items-center gap-2.5 border-t border-border pt-2.5">
            <span className="w-24 shrink-0 text-xs text-muted-foreground">{LEAD_STATUS_LABEL.discarded}</span>
            <div className="h-5 flex-1 overflow-hidden rounded-md bg-muted">
              <div className={`h-full rounded-md ${BAR_COLOR.discarded}`} style={{ width: `${Math.max(4, (discarded / max) * 100)}%` }} />
            </div>
            <span className="w-8 shrink-0 text-right text-xs font-medium tabular-nums text-foreground">{discarded}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
