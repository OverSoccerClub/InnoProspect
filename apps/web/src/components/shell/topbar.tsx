import { ThemeToggle } from '@/components/theme/theme-toggle';
import { MobileNav } from './mobile-nav';
import { UserMenu, type ShellUser } from './user-menu';

/**
 * Server Component (voltou a ser — não precisa de `'use client'` aqui: nem
 * `ThemeToggle` nem `MobileNav` nem `UserMenu` exigem hooks NESTE nível,
 * cada um já é `'use client'` por si). `user` chega de
 * `app/(dashboard)/layout.tsx` (única leitura de sessão da árvore) e desce
 * só até quem realmente precisa (`UserMenu`).
 */
export function Topbar({ user }: { user?: ShellUser | null }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-card/80 px-4 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <MobileNav />
        <span className="text-sm font-semibold md:hidden">
          Inno<span className="text-primary">Prospect</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
