import Link from 'next/link';
import { Radar } from 'lucide-react';

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Radar className="size-4" aria-hidden="true" />
          </span>
          <span className="font-display text-sm font-bold tracking-tight">
            Inno<span className="text-primary">Prospect</span>
          </span>
        </div>

        <nav aria-label="Rodapé" className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <Link href="#como-funciona" className="hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm">
            Como funciona
          </Link>
          <Link href="/login" className="hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm">
            Entrar
          </Link>
        </nav>

        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} InnoProspect. Plataforma de prospecção B2B.
        </p>
      </div>
    </footer>
  );
}
