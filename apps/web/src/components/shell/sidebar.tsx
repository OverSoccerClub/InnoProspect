'use client';

import Link from 'next/link';

import { NAV_ITEMS } from './nav-items';
import { NavLink } from './nav-link';

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-border bg-card md:flex md:flex-col">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <Link href="/" className="text-base font-semibold tracking-tight">
          Inno<span className="text-primary">Prospect</span>
        </Link>
      </div>
      <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-1 p-3">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}
      </nav>
    </aside>
  );
}
