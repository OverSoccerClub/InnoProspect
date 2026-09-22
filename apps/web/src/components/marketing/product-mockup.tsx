import { CheckCircle2, MapPin, Radar } from 'lucide-react';

import { LeadStatusBadge } from '@/components/leads/lead-status-badge';
import type { LeadStatus } from '@/types/lead';

type MockLeadRow = {
  name: string;
  city: string;
  phone: string;
  status: LeadStatus;
};

// Dados ilustrativos, nunca reais — este componente é só a composição visual
// do hero (nenhuma chamada de API). Nomes fictícios de propósito (nenhum
// depoimento/cliente real está sendo insinuado aqui, é uma maquete de UI).
const MOCK_ROWS: MockLeadRow[] = [
  { name: 'Clínica OdontoSorriso', city: 'Campinas, SP', phone: '(19) 98888-1234', status: 'contacted' },
  { name: 'Odonto Vida', city: 'Ribeirão Preto, SP', phone: '(16) 99222-4455', status: 'responded' },
  { name: 'Sorriso & Cia', city: 'Sorocaba, SP', phone: '(15) 99777-8899', status: 'new' },
  { name: 'Espaço Dental', city: 'São José dos Campos, SP', phone: '(12) 98123-9090', status: 'won' },
];

/**
 * Mockup do produto construído 100% em código (sem imagem externa — a CSP
 * bloqueia recurso de fora, e isto fica nítido em qualquer tela/tema). É a
 * peça central do hero: uma composição estilizada da tela de Leads real
 * (mesma tabela densa, mesmo `LeadStatusBadge`) com um card de progresso de
 * busca sobreposto, no espírito Stripe de "produto real, não ilustração".
 */
export function ProductMockup() {
  return (
    // `pt-28` reserva espaço FIXO (não sobreposição por posicionamento
    // absoluto puro) para o card "Busca em andamento" caber acima da janela
    // do app sem cobrir o cabeçalho da tabela — testado com screenshot real
    // (skill medir-antes-de-afirmar): a 1ª versão usava `-top-5`, que
    // sobrepunha o card inteiro em cima do cabeçalho "Empresa/Status",
    // tornando-o ilegível. Padding no fluxo normal garante a folga em
    // qualquer viewport (mobile empilha a seção inteira, mas o espaço
    // reservado continua valendo).
    <div className="relative mx-auto w-full max-w-lg pt-28">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 translate-x-6 translate-y-6 rounded-2xl bg-primary/[0.07] blur-2xl"
      />

      {/* "Janela" do app: barra de chrome + tabela de leads. */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-destructive/40" />
          <span className="size-2.5 rounded-full bg-warning/50" />
          <span className="size-2.5 rounded-full bg-success/50" />
          <span className="ml-2 text-xs font-medium text-muted-foreground">InnoProspect · Leads</span>
        </div>

        <div className="divide-y divide-border">
          <div className="grid grid-cols-[1fr_auto] gap-3 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Empresa</span>
            <span>Status</span>
          </div>
          {MOCK_ROWS.map((row) => (
            <div key={row.name} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{row.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.city} · {row.phone}
                </p>
              </div>
              <LeadStatusBadge status={row.status} />
            </div>
          ))}
        </div>
      </div>

      {/* Card flutuante: busca em andamento — vive dentro do `pt-28` reservado acima, com uma
          sobreposição pequena e deliberada só na borda/canto arredondado da janela abaixo. */}
      <div className="absolute -left-4 top-0 w-52 rounded-xl border border-border bg-card p-3.5 shadow-md sm:-left-8">
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
          <Radar className="size-3.5 text-primary motion-safe:animate-pulse" aria-hidden="true" />
          Busca em andamento
        </div>
        <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="size-3 shrink-0" aria-hidden="true" />
          Clínicas odontológicas · SP
        </p>
        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-[62%] rounded-full bg-primary" />
        </div>
        <p className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">38 de 61 cidades · 62%</p>
      </div>

      {/* Badge flutuante: saúde da fila de coleta — mesmo sinal que o painel logado mostra em destaque.
          Cor só no ícone (piso WCAG 3:1) — o texto fica em `text-foreground`, mesma regra do Alert
          (DESIGN-SYSTEM.md §4/§1.4): um token de cor não é garantidamente 4.5:1 como texto corrido. */}
      <div className="absolute -bottom-4 -right-3 flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-md sm:-right-6">
        <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" />
        Fila operando
      </div>
    </div>
  );
}
