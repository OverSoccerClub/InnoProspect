import Link from 'next/link';
import { ChevronRight, Settings2, ShieldOff } from 'lucide-react';

import { PageHeader } from '@/components/common/page-header';
import { Card, CardContent } from '@/components/ui/card';

export default function ConfiguracoesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Configurações" description="Preferências da conta e mecanismos de proteção do sistema." />

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/configuracoes/optouts"
          className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Card variant="interactive" className="h-full">
            <CardContent className="flex h-full items-start gap-4 p-5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <ShieldOff className="size-5" aria-hidden="true" />
              </span>
              <div className="flex-1">
                <p className="font-display text-sm font-semibold text-foreground">Opt-outs</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Números que pediram para não receber mais mensagens — a lista que protege todo disparo.
                </p>
              </div>
              <ChevronRight className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </CardContent>
          </Card>
        </Link>

        {/* Placeholder honesto, não um item cinza morto: mesma pílula "em
         * breve" já usada em `NAV_ITEMS`/`NavLink` (consistência visual), e
         * nenhuma promessa de escopo/prazo que o roadmap ainda não confirmou
         * (ARQUITETURA.md §8 não cita "preferências de conta" em nenhuma
         * fase numerada — inventar uma aqui seria a mesma armadilha de
         * honestidade de copy documentada em DESIGN-SYSTEM.md §9.2). */}
        <Card variant="flat" className="h-full border-dashed bg-muted/20 shadow-none">
          <CardContent className="flex h-full items-start gap-4 p-5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Settings2 className="size-5" aria-hidden="true" />
            </span>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-display text-sm font-semibold text-foreground">Preferências da conta</p>
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  em breve
                </span>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Troca de senha, notificações e dados da conta vão morar aqui — ainda sem data confirmada no roadmap.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
