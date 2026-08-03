'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

import { ThemeToggle } from '@/components/theme/theme-toggle';
import { Button } from '@/components/ui/button';
import { logout } from '@/lib/auth-client';
import { MobileNav } from './mobile-nav';

export function Topbar() {
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-card/80 px-4 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <MobileNav />
        <span className="text-sm font-semibold md:hidden">
          Inno<span className="text-primary">Prospect</span>
        </span>
      </div>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <Button variant="ghost" size="sm" onClick={handleLogout}>
          <LogOut />
          Sair
        </Button>
      </div>
    </header>
  );
}
