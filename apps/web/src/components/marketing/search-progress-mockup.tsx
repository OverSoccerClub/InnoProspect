import { CheckCircle2, Circle, Loader2, MapPinned } from 'lucide-react';

type CityRow = { name: string; state: 'done' | 'running' | 'pending'; count: number | null };

// Ilustrativo — mesma regra do mockup do hero: nunca dado real, nunca métrica de cliente.
const CITIES: CityRow[] = [
  { name: 'São Paulo', state: 'done', count: 18 },
  { name: 'Campinas', state: 'done', count: 11 },
  { name: 'Ribeirão Preto', state: 'done', count: 7 },
  { name: 'Sorocaba', state: 'running', count: null },
  { name: 'São José dos Campos', state: 'pending', count: null },
  { name: 'Jundiaí', state: 'pending', count: null },
];

const STATE_ICON = { done: CheckCircle2, running: Loader2, pending: Circle };

/**
 * Segunda composição visual do produto — a tela de progresso de busca, não a
 * de leads (essa já é o mockup do hero). Usada na seção "Recursos" pra
 * quebrar a monotonia de grade de cards repetida (pedido do dono).
 */
export function SearchProgressMockup() {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 -translate-x-4 translate-y-4 rounded-2xl bg-primary/[0.07] blur-2xl"
      />
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-destructive/40" />
          <span className="size-2.5 rounded-full bg-warning/50" />
          <span className="size-2.5 rounded-full bg-success/50" />
          <span className="ml-2 text-xs font-medium text-muted-foreground">InnoProspect · Nova busca</span>
        </div>

        <div className="p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <MapPinned className="size-4 text-primary" aria-hidden="true" />
            Clínicas odontológicas · SP
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full w-[62%] rounded-full bg-primary" />
          </div>
          <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">38 de 61 municípios · 62% concluído</p>
        </div>

        <div className="divide-y divide-border border-t border-border">
          {CITIES.map((city) => {
            const Icon = STATE_ICON[city.state];
            return (
              <div key={city.name} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="flex items-center gap-2 text-foreground">
                  <Icon
                    className={
                      city.state === 'done'
                        ? 'size-4 shrink-0 text-success'
                        : city.state === 'running'
                          ? 'size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none'
                          : 'size-4 shrink-0 text-muted-foreground/50'
                    }
                    aria-hidden="true"
                  />
                  {city.name}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {city.count !== null ? `${city.count} leads` : city.state === 'running' ? 'coletando…' : 'na fila'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
