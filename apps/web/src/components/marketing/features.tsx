import { Building2, Filter, Gauge, LayoutDashboard, MessageCircle, ScanSearch } from 'lucide-react';

import { SearchProgressMockup } from '@/components/marketing/search-progress-mockup';

const FEATURES = [
  {
    icon: ScanSearch,
    title: 'Busca por nicho e cidade',
    description: 'Busque um estado inteiro ou selecione só as cidades que interessam.',
  },
  {
    icon: Filter,
    title: 'Leads organizados e filtráveis',
    description: 'Nome, telefone, tipo de linha, site e avaliação. Filtre por status, região ou categoria.',
  },
  {
    icon: Gauge,
    title: 'Progresso em tempo real',
    description: 'Acompanhe cada cidade sendo processada, em vez de esperar sem saber se travou.',
  },
  {
    icon: Building2,
    title: 'Ficha completa do lead',
    description: 'Endereço, origem da coleta e linha do tempo de atividade: contexto para abordar.',
  },
  {
    icon: MessageCircle,
    title: 'WhatsApp com anti-ban',
    description: 'Aquecimento gradual de número novo e pausa automática de segurança.',
    badge: 'em construção',
  },
  {
    icon: LayoutDashboard,
    title: 'Painel único',
    description: 'Buscas, leads, templates de mensagem e instâncias de WhatsApp em um só lugar.',
  },
];

/**
 * Seção dividida (texto + visual) — quebra a fórmula "título centralizado +
 * grade de cards" repetida em `HowItWorks`/`ComplianceSection`. O visual é
 * a 2ª composição do produto (`SearchProgressMockup`, a tela de progresso),
 * distinta do mockup de leads do hero.
 */
export function Features() {
  return (
    <section className="border-t border-border bg-muted/30 py-20 sm:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-14 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Recursos
            </h2>
            <p className="mt-3 text-lg text-muted-foreground">
              O que já dá para usar hoje, e o que está sendo construído em cima da mesma base.
            </p>

            <ul className="mt-10 flex flex-col gap-7">
              {FEATURES.map((feature) => {
                const Icon = feature.icon;
                return (
                  <li key={feature.title} className="flex gap-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="flex items-center gap-2 font-display text-base font-semibold text-foreground">
                        {feature.title}
                        {feature.badge && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                            {feature.badge}
                          </span>
                        )}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">{feature.description}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <SearchProgressMockup />
        </div>
      </div>
    </section>
  );
}
