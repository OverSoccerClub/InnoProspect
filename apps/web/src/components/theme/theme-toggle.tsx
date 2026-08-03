'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme/theme-provider';
import { cn } from '@/lib/utils';

/**
 * Ícone só reflete o tema real depois de montar no client (`mounted`) — nos
 * primeiros ms ele fica com opacidade 0 (mas ocupando o espaço, sem layout
 * shift) em vez de arriscar mostrar o ícone errado por um instante.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className={cn(className)}
      aria-label={mounted ? (theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro') : 'Alternar tema'}
    >
      <Sun className={cn(!mounted && 'opacity-0', mounted && theme === 'dark' && 'hidden')} aria-hidden="true" />
      <Moon className={cn('hidden', mounted && theme === 'dark' && 'block')} aria-hidden="true" />
    </Button>
  );
}
