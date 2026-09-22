import Link from 'next/link';
import { Radar } from 'lucide-react';

import { ThemeToggle } from '@/components/theme/theme-toggle';
import { Button } from '@/components/ui/button';

/** Header fixo da landing — marca + "Entrar". Server Component (só `ThemeToggle` é client). */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur-sm">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Radar className="size-5" aria-hidden="true" />
          </span>
          <span className="font-display text-lg font-bold tracking-tight">
            Inno<span className="text-primary">Prospect</span>
          </span>
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          <ThemeToggle />
          <Button asChild>
            <Link href="/login">Entrar</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
