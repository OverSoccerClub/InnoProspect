'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

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
    <header className="flex h-14 items-center justify-between gap-3 border-b border-border bg-background px-4">
      <div className="flex items-center gap-2">
        <MobileNav />
        <span className="text-sm font-medium md:hidden">
          Inno<span className="text-primary">Prospect</span>
        </span>
      </div>
      <Button variant="ghost" size="sm" onClick={handleLogout}>
        <LogOut />
        Sair
      </Button>
    </header>
  );
}
