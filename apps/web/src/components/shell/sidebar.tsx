'use client';

import Link from 'next/link';
import { Radar } from 'lucide-react';

import { NAV_ITEMS } from './nav-items';
import { NavLink } from './nav-link';

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-border bg-card md:flex md:flex-col">
      <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Radar className="size-4" aria-hidden="true" />
          </span>
          <span className="font-display text-base font-bold tracking-tight">
            Inno<span className="text-primary">Prospect</span>
          </span>
        </Link>
      </div>
      <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-0.5 p-3">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}
      </nav>
    </aside>
  );
}
