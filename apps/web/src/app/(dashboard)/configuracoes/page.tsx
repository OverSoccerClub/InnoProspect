import Link from 'next/link';
import { ChevronRight, ShieldOff } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

export default function ConfiguracoesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">Preferências da conta e mecanismos de proteção do sistema.</p>
      </div>

      <Link href="/configuracoes/optouts" className="block">
        <Card className="transition-colors hover:bg-accent/50">
          <CardContent className="flex items-center gap-4 p-5">
            <ShieldOff className="size-6 shrink-0 text-muted-foreground" aria-hidden="true" />
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

      <Card className="border-dashed">
        <CardContent className="p-5">
          <p className="font-medium">Preferências da conta</p>
          <p className="text-sm text-muted-foreground">Chega nas próximas fases.</p>
        </CardContent>
      </Card>
    </div>
  );
}
