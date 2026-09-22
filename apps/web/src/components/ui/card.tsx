import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Escala de elevação do projeto (DESIGN-SYSTEM.md §3): canvas (`bg-background`,
 * fora do Card) → painel em repouso (`flat`, o padrão histórico, `shadow-sm`)
 * → painel elevado/em destaque (`elevated`, `shadow-md` fixo — hero, tile de
 * indicador, qualquer bloco que precise competir por atenção sem virar
 * modal) → painel interativo (`interactive`, mesmo `shadow-sm` em repouso,
 * ganha `shadow-md` + leve levitação no hover — item que convida ao clique,
 * como o card de navegação de Configurações). O nível "popover" (`Content`
 * do `DropdownMenu`/menus futuros) fica em `--color-popover` +
 * `shadow-lg`, não neste componente — ver `components/ui/dropdown-menu.tsx`.
 *
 * `interactive` só anima com `motion-safe:` (variante nativa do Tailwind
 * pra `prefers-reduced-motion: no-preference`) — não é "mais rápido" sob
 * reduced motion, é NENHUMA translação, mesmo padrão do resto do projeto
 * (`.inno-stagger-in`, animações do Dialog).
 */
const cardVariants = cva('rounded-lg border border-border bg-card text-card-foreground', {
  variants: {
    variant: {
      flat: 'shadow-sm',
      elevated: 'shadow-md',
      interactive:
        'shadow-sm transition-shadow duration-150 hover:shadow-md motion-safe:transition-[box-shadow,transform] motion-safe:hover:-translate-y-0.5',
    },
  },
  defaultVariants: {
    variant: 'flat',
  },
});

export interface CardProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(({ className, variant, ...props }, ref) => (
  <div ref={ref} className={cn(cardVariants({ variant }), className)} {...props} />
));
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1.5 p-6', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('font-display text-lg font-semibold leading-none tracking-tight', className)} {...props} />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />,
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, cardVariants };
