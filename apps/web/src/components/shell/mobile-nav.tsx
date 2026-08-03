'use client';

import { useState } from 'react';
import { Menu, Radar } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { NAV_ITEMS } from './nav-items';
import { NavLink } from './nav-link';

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir menu de navegação">
          <Menu />
        </Button>
      </DialogTrigger>
      <DialogContent className="left-0 top-0 h-full max-w-64 translate-x-0 translate-y-0 gap-6 rounded-none border-r p-4 sm:rounded-none">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-base">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Radar className="size-4" aria-hidden="true" />
            </span>
            Inno<span className="text-primary">Prospect</span>
          </DialogTitle>
        </DialogHeader>
        <nav aria-label="Navegação principal" className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} onNavigate={() => setOpen(false)} />
          ))}
        </nav>
      </DialogContent>
    </Dialog>
  );
}
