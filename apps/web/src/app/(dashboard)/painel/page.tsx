import type { Metadata } from 'next';

import { DashboardContent } from '@/components/dashboard/dashboard-content';
import { auth } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Painel — InnoProspect',
};

function greetingForHour(hour: number): string {
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

/**
 * Abertura do painel logado (era `/`, agora `/painel`). Server Component: lê
 * a sessão real (`auth()`, `lib/auth.ts`) só para o primeiro nome da
 * saudação — todo o resto (dado, estados de loading/erro/vazio, redesenho
 * completo da rodada "premium") vive em `DashboardContent`, fonte única de
 * dado via `GET /api/v1/dashboard/summary` (ver DESIGN-SYSTEM.md §9.4).
 */
export default async function PainelPage() {
  const session = await auth();
  const firstName = session?.user?.name?.trim().split(' ')[0];
  const greeting = greetingForHour(new Date().getHours());

  return <DashboardContent greeting={greeting} firstName={firstName} />;
}
