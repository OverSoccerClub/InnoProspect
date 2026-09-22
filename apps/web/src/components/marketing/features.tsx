import { Building2, Filter, Gauge, LayoutDashboard, MessageCircle, ScanSearch } from 'lucide-react';

const FEATURES = [
  {
    icon: ScanSearch,
    title: 'Busca por nicho e cidade',
    description:
      'Cobertura dos 5.571 municípios das 27 UFs (base IBGE) — busque um estado inteiro ou selecione só as cidades que interessam.',
  },
  {
    icon: Filter,
    title: 'Leads organizados e filtráveis',
    description:
      'Nome, telefone, tipo de linha, site e avaliação — filtre por status, região ou categoria sem precisar de planilha.',
  },
  {
    icon: Gauge,
    title: 'Progresso em tempo real',
    description:
      'Acompanhe cada cidade sendo processada enquanto a busca roda — em vez de esperar sem saber se travou.',
  },
  {
    icon: Building2,
    title: 'Ficha completa do lead',
    description:
      'Cada empresa chega com endereço, origem da coleta e linha do tempo de atividade — contexto para abordar, não só um número solto.',
  },
  {
    icon: MessageCircle,
    title: 'WhatsApp com anti-ban',
    description: 'Aquecimento gradual de número novo e pausa automática de segurança — em construção.',
    badge: 'em construção',
  },
  {
    icon: LayoutDashboard,
    title: 'Painel único',
    description: 'Buscas, leads, templates de mensagem e instâncias de WhatsApp — tudo em um só lugar.',
  },
];

export function Features() {
  return (
    <section className="border-t border-border py-16 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Recursos
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            O que já dá pra usar hoje — e o que está sendo construído em cima da mesma base.
          </p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <div key={feature.title} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-6 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  {feature.badge && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {feature.badge}
                    </span>
                  )}
                </div>
                <h3 className="font-display text-base font-semibold text-foreground">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
