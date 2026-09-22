import { AuthGuard } from '@/components/auth/auth-guard';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { auth } from '@/lib/auth';

/**
 * Server Component (async) — única leitura de sessão da árvore do shell,
 * pelo mesmo motivo de `app/(dashboard)/painel/page.tsx`: `Topbar`/`UserMenu`
 * são Client Components e não podem chamar `auth()` sozinhos. Em modo mock
 * (`NEXT_PUBLIC_USE_MOCKS=true`) sem sessão Auth.js real, `session` vem
 * `null` — `UserMenu` já trata esse caso com um fallback neutro, nunca quebra.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex min-h-screen flex-1 flex-col">
          <Topbar user={session?.user} />
          <main className="flex-1 overflow-x-hidden p-4 md:p-8">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}
