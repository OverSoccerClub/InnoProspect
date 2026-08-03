'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';
import type { NavItem } from './nav-items';

export function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background',
        isActive
          ? 'bg-primary text-primary-foreground shadow-xs'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn('size-4 shrink-0', !isActive && 'text-muted-foreground/80 group-hover:text-accent-foreground')}
      />
      <span className="flex-1">{item.label}</span>
      {item.comingSoon && (
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
            isActive ? 'bg-primary-foreground/15 text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          em breve
        </span>
      )}
    </Link>
  );
}
