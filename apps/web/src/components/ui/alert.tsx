import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Título e descrição SEMPRE usam `text-foreground`/`text-muted-foreground`
 * (nunca a cor semântica da variante) — só o ícone e a borda esquerda
 * carregam a cor de status. Ícone/borda são "componentes gráficos" pelo
 * WCAG (piso de contraste 3:1), enquanto o corpo do texto precisa de 4.5:1;
 * um `--success`/`--destructive` sozinho não passa nos dois papéis ao mesmo
 * tempo em todo tema (ver DESIGN-SYSTEM.md §4 — essa troca corrigiu um bug
 * real: texto branco sobre `bg-success/10`, quase invisível).
 */
const alertVariants = cva(
  // Grid em vez de flex: o ícone (se houver) ocupa col.1/linha 1-2, e
  // AlertTitle (h5) + AlertDescription (div) ficam empilhados na col.2 —
  // sem isso os 3 filhos ficariam lado a lado numa única linha.
  'relative grid grid-cols-1 items-start gap-x-3 gap-y-1 has-[>svg]:grid-cols-[auto_1fr] rounded-lg border border-l-4 bg-card p-4 text-sm text-foreground shadow-xs [&>svg]:col-start-1 [&>svg]:row-start-1 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0 [&>h5]:col-start-2 [&>div]:col-start-2',
  {
    variants: {
      variant: {
        default: 'border-border border-l-border [&>svg]:text-muted-foreground',
        destructive: 'border-border border-l-destructive bg-destructive/[0.04] [&>svg]:text-destructive',
        // `--warning` é um amarelo claro por natureza — some contra fundo
        // claro (ratio medido: 2.23:1, abaixo do piso 3:1 pra ícone). Usa
        // `--warning-foreground` (o tom escuro já pareado com o fill do
        // badge) no light, e o próprio `--warning` (brilhante) no dark, onde
        // ele lê bem contra um fundo quase-preto (9.39:1). Ver
        // DESIGN-SYSTEM.md §4.
        warning:
          'border-border border-l-warning-foreground/70 bg-warning/[0.08] [&>svg]:text-warning-foreground dark:border-l-warning dark:[&>svg]:text-warning',
        success: 'border-border border-l-success bg-success/[0.05] [&>svg]:text-success',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className={cn('mb-1 flex items-center gap-2 font-medium leading-none text-foreground', className)} {...props} />
  ),
);
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-sm text-muted-foreground [&_p]:leading-relaxed', className)} {...props} />
  ),
);
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription };
