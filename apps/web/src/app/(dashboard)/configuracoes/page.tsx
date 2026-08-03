import Link from 'next/link';
import { ChevronRight, Settings2, ShieldOff } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

export default function ConfiguracoesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">Preferências da conta e mecanismos de proteção do sistema.</p>
      </div>

      <Link
        href="/configuracoes/optouts"
        className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Card className="transition-shadow hover:shadow-md">
          <CardContent className="flex items-center gap-4 p-5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <ShieldOff className="size-5" aria-hidden="true" />
            </span>
            <div className="flex-1">
              <p className="font-medium">Opt-outs</p>
              <p className="text-sm text-muted-foreground">
                Números que pediram para não receber mais mensagens — a lista que protege todo disparo.
              </p>
            </div>
            <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </CardContent>
        </Card>
      </Link>

      <Card className="border-dashed bg-muted/20 shadow-none">
        <CardContent className="flex items-center gap-4 p-5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Settings2 className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="font-medium text-muted-foreground">Preferências da conta</p>
            <p className="text-sm text-muted-foreground">Chega nas próximas fases.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
