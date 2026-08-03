import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Checkbox nativo estilizado. Sem Radix aqui de propósito: é usado em listas
 * potencialmente longas (filtros, seleção de cidade) e o input nativo já
 * cobre teclado/leitor de tela sem custo de bundle extra.
 */
export type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    className={cn(
      'size-4 shrink-0 rounded border border-input text-primary accent-primary transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Checkbox.displayName = 'Checkbox';

export { Checkbox };
