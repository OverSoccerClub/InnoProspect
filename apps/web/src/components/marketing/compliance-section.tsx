import { BellOff, Clock, ShieldCheck } from 'lucide-react';

import { DescadastroPreviewMockup } from '@/components/marketing/descadastro-preview-mockup';

const ITEMS = [
  {
    icon: BellOff,
    title: 'Descadastro imediato, sem intervenção manual',
    description:
      'Qualquer contato pode pedir para sair a qualquer momento. O pedido é processado na hora, por uma página pública própria.',
  },
  {
    icon: Clock,
    title: 'Janela de horário de disparo',
    description:
      'Cada campanha define uma janela de horário permitida. Faz parte do desenho do produto; o disparo em si ainda está em construção.',
  },
  {
    icon: ShieldCheck,
    title: 'Pausa automática de segurança',
    description:
      'Quando uma métrica foge do padrão, o sistema pausa sozinho e exige confirmação humana antes de retomar.',
  },
];

/**
 * Seção dividida — o visual é a prévia real da página pública de
 * descadastro (`DescadastroPreviewMockup`), não mais uma 3ª grade de cards.
 * Ordem invertida em relação a `Features` (visual à esquerda no desktop)
 * pra dar ritmo, não repetir a mesma composição duas vezes seguidas.
 */
export function ComplianceSection() {
  return (
    <section className="border-t border-border py-20 sm:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-14 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div className="order-2 lg:order-1">
            <DescadastroPreviewMockup />
          </div>

          <div className="order-1 lg:order-2">
            <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Conformidade não é opcional
            </h2>
            <p className="mt-3 text-lg text-muted-foreground">
              Abordar empresas em escala só é sustentável se quem não quer contato puder sair fácil.
            </p>

            <ul className="mt-10 flex flex-col gap-7">
              {ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.title} className="flex gap-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="font-display text-base font-semibold text-foreground">{item.title}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
