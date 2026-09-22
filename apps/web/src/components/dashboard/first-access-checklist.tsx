import Link from 'next/link';
import { ArrowRight, MessageCircle, MessageSquareText, Search, Sparkles } from 'lucide-react';

import { QueueHealthBanner } from '@/components/dashboard/queue-health-banner';
import { SystemHealthCard } from '@/components/dashboard/system-health-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const STEPS = [
  {
    icon: Search,
    title: 'Faça sua primeira busca',
    description: 'Escolha um nicho e uma UF — o InnoProspect varre o Google Maps e traz os resultados como leads organizados.',
    href: '/buscas/nova',
    cta: 'Nova busca',
  },
  {
    icon: MessageCircle,
    title: 'Conecte um número de WhatsApp',
    description: 'Prepare uma instância agora para já poder abordar os leads assim que a primeira busca terminar.',
    href: '/whatsapp',
    cta: 'Ir para WhatsApp',
  },
  {
    icon: MessageSquareText,
    title: 'Crie um template de mensagem',
    description: 'Monte a primeira abordagem com variáveis (nome, cidade) e variações — pronta pra quando o disparo chegar.',
    href: '/templates',
    cta: 'Criar template',
  },
];

/**
 * Estado de primeiro acesso — produção começa com zero leads, e um painel
 * "lindo com mock, triste com zero" é reprovado (nota do dono). Em vez de
 * mostrar gráficos mortos, troca a seção inteira por um checklist de
 * primeiros passos com ação de verdade em cada item.
 */
export function FirstAccessChecklist({ greeting, firstName }: { greeting: string; firstName?: string }) {
  return (
    <div className="flex flex-col gap-6">
      <section className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-primary/[0.07] via-card to-card p-6 shadow-sm sm:p-8">
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-primary/[0.1] blur-3xl" />
        <div className="relative flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Sparkles className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              {greeting}
              {firstName ? `, ${firstName}` : ''}
            </h1>
            <p className="mt-1.5 max-w-xl text-pretty text-sm text-muted-foreground">
              Sua conta está pronta e ainda sem leads. Três passos separam você da primeira lista.
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        {STEPS.map((step, index) => {
          const Icon = step.icon;
          return (
            <Card key={step.title} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col gap-3 p-5">
                <div className="flex items-center gap-2">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="font-display text-xs font-bold text-muted-foreground">Passo {index + 1}</span>
                </div>
                <h2 className="font-display text-base font-semibold text-foreground">{step.title}</h2>
                <p className="flex-1 text-sm text-muted-foreground">{step.description}</p>
                <Button asChild variant="outline" className="w-fit">
                  <Link href={step.href}>
                    {step.cta}
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Assim que os primeiros leads chegarem, esta página ganha gráfico de evolução, funil por status e os
        destaques por UF e categoria automaticamente.
      </p>

      <QueueHealthBanner />

      <div className="grid gap-4 lg:grid-cols-3">
        <SystemHealthCard className="lg:col-span-1" />
      </div>
    </div>
  );
}
