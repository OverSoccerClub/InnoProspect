import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';

import { cn } from '@/lib/utils';

/**
 * Nível "popover" da escala de elevação (DESIGN-SYSTEM.md §3): `bg-popover`
 * + `shadow-lg` + borda — um degrau acima do Card `elevated` (`shadow-md`),
 * reservado para camadas que flutuam por cima de tudo sem bloquear a
 * página (ao contrário do `Dialog`, que tem overlay). Primeiro uso:
 * `components/shell/user-menu.tsx`.
 *
 * Animação feita à mão (sem `tailwindcss-animate`, não instalado — mesma
 * decisão do `Dialog`, ver `globals.css`): só `opacity` + a propriedade CSS
 * `scale` (não `transform`, que o Radix já usa para posicionar o menu
 * relativo ao trigger via Popper) — compor os dois nunca conflita, e a
 * origem do scale segue `--radix-dropdown-menu-content-transform-origin`
 * (o canto real do trigger), não um valor fixo. Gated em
 * `prefers-reduced-motion: no-preference`, mesmo padrão do resto do
 * projeto.
 */
const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 8, ...props }, ref) => (
  <DropdownMenuPortal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'inno-popover-content z-50 min-w-56 origin-[var(--radix-dropdown-menu-content-transform-origin)] rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-lg',
        className,
      )}
      {...props}
    />
  </DropdownMenuPortal>
));
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuLabel = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label ref={ref} className={cn('px-2.5 py-1.5', className)} {...props} />
));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

const DropdownMenuSeparator = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator ref={ref} className={cn('-mx-1.5 my-1.5 h-px bg-border', className)} {...props} />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { variant?: 'default' | 'destructive' }
>(({ className, variant = 'default', ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground outline-none transition-colors [&_svg]:size-4 [&_svg]:shrink-0',
      'focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      // `--destructive` no dark mede 3.58:1 contra o fundo (piso 3:1 de
      // ícone/borda, NÃO os 4.5:1 de texto corrido) — mesma armadilha de
      // token dual-role do Alert (DESIGN-SYSTEM.md §1.4/§4). Por isso só o
      // ÍCONE herda a cor; o rótulo continua neutro (`text-foreground`),
      // com um fundo de foco levemente tintado (mesma opacidade do Alert).
      variant === 'destructive' && 'focus:bg-destructive/10 [&_svg]:text-destructive',
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
};
