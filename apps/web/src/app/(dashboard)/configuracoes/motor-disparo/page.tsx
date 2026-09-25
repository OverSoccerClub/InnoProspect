import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { PageHeader } from '@/components/common/page-header';
import { DispatchEngineCard } from '@/components/dispatch/dispatch-engine-card';
import { auth } from '@/lib/auth';

/**
 * Fase 4.F.3: a tela que faltava — a rota (`GET/POST /api/v1/dispatch/queue`,
 * `POST /api/v1/dispatch/queue/resume`) já existia, mas parar o motor em um
 * incidente exigia montar uma requisição HTTP na mão (ARQUITETURA §6.8.9:
 * "às duas da manhã, parar tem que ser um clique").
 *
 * Diferente de `configuracoes/servidores-evolution/page.tsx` e
 * `configuracoes/usuarios/page.tsx`: a página INTEIRA não é admin-gated aqui,
 * porque `GET /api/v1/dispatch/queue` é liberado para qualquer operador
 * autenticado — "o motor está ligado?" é informação operacional, não
 * administrativa. Só as AÇÕES (pausar/retomar) são admin-only, e esse gate
 * (de cortesia; o de verdade é `requireRole: 'admin'` na API) mora dentro de
 * `DispatchEngineCard` via `isAdmin`, mesmo padrão de `WhatsappPageClient`.
 */
export default async function MotorDisparoPage() {
  const session = await auth();
  const isAdmin = session?.user.role === 'admin';

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/configuracoes"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Voltar para configurações
      </Link>

      <PageHeader
        title="Motor de disparo"
        description="O freio do motor que manda mensagens de campanha sozinho. Pausar aqui para qualquer campanha, imediatamente."
      />

      <DispatchEngineCard isAdmin={isAdmin} />
    </div>
  );
}
