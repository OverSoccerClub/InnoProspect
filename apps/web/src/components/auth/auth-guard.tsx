'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { USE_MOCKS } from '@/lib/config';
import { hasMockSession } from '@/lib/auth-client';

/**
 * Gate de sessão só para o modo mock (dá pra sentir o fluxo de login/logout
 * sem backend). Quando USE_MOCKS=false, não bloqueia nada aqui — a proteção
 * de verdade é middleware do Next + Auth.js, que é do Vega
 * (ARQUITETURA.md §1.4, `lib/auth.ts`).
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(!USE_MOCKS);

  useEffect(() => {
    if (!USE_MOCKS) return;
    if (!hasMockSession()) {
      router.replace('/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Verificando sessão…" />
      </div>
    );
  }

  return <>{children}</>;
}
