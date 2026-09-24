import { WhatsappPageClient } from '@/components/whatsapp/whatsapp-page-client';
import { auth } from '@/lib/auth';

/**
 * Server Component (async) só para ler `session.user.role` e decidir se o
 * botão "Verificar agora" aparece — mesmo padrão de
 * `configuracoes/usuarios/page.tsx`/`configuracoes/servidores-evolution/
 * page.tsx`, mas aqui é PARCIAL: a tela inteira continua aberta pra
 * qualquer papel (ver instâncias não é admin-only), só a ação de
 * reconciliação forçada é (`POST /whatsapp/instances/reconcile`,
 * `requireRole: 'admin'`). Cortesia de UI, não o gate de verdade — a API
 * recusaria de qualquer forma.
 */
export default async function WhatsappPage() {
  const session = await auth();
  const isAdmin = session?.user.role === 'admin';

  return <WhatsappPageClient isAdmin={isAdmin} />;
}
