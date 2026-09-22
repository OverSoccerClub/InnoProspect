'use client';

import { useRouter } from 'next/navigation';
import { ChevronDown, LogOut } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { logout } from '@/lib/auth-client';

export type ShellUser = {
  name?: string | null;
  email?: string | null;
  role?: 'admin' | 'operator' | null;
};

const ROLE_LABEL: Record<'admin' | 'operator', string> = {
  admin: 'Administrador',
  operator: 'Operador',
};

function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || 'U';
}

/**
 * Substitui o botão "Sair" solto do Topbar por uma área de usuário de
 * verdade (avatar com iniciais + nome + papel, num menu de verdade) — pedido
 * explícito da rodada. `user` chega como prop de um Server Component pai
 * (`app/(dashboard)/layout.tsx`, via `auth()`) porque `Topbar` é Client
 * Component e não pode chamar `auth()` sozinho.
 *
 * `user` pode vir `null`/`undefined` em dois casos legítimos: (1) modo mock
 * (`NEXT_PUBLIC_USE_MOCKS=true`) sem sessão Auth.js real por trás — só o
 * `AuthGuard` client-side libera a tela; (2) qualquer falha ao ler a sessão
 * no servidor. Os dois caem no mesmo fallback neutro ("Usuário", sem
 * e-mail/papel) — nunca quebra a tela por falta de sessão.
 */
export function UserMenu({ user }: { user?: ShellUser | null }) {
  const router = useRouter();
  const displayName = user?.name?.trim() || 'Usuário';
  const roleLabel = user?.role ? ROLE_LABEL[user.role] : undefined;

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
          aria-label={`Menu da conta de ${displayName}`}
        >
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-xs font-semibold text-primary"
          >
            {initials(user?.name)}
          </span>
          <span className="hidden flex-col items-start leading-tight sm:flex">
            <span className="max-w-32 truncate text-sm font-medium text-foreground">{displayName}</span>
            {roleLabel && <span className="text-xs text-muted-foreground">{roleLabel}</span>}
          </span>
          <ChevronDown className="hidden size-3.5 text-muted-foreground sm:block" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
          {user?.email && <p className="truncate text-xs text-muted-foreground">{user.email}</p>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={handleLogout}>
          <LogOut aria-hidden="true" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
