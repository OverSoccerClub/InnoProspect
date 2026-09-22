import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type PageHeaderProps = {
  title: string;
  description?: string;
  /** Selo curto ao lado do título (ex.: contagem "115 leads", status). Não é badge de cor semântica — é meta-informação neutra. */
  meta?: ReactNode;
  /** Botão(ões) de ação principal da página, alinhados à direita em telas largas. */
  action?: ReactNode;
  className?: string;
};

/**
 * Cabeçalho padrão de página logada (título H1 em `font-display` + descrição
 * + slot de ação) — formaliza o padrão que Configurações e o painel já
 * repetiam à mão, para a onda 2 não reescrever a mesma marcação em cada
 * tela nova. Empilha em telas estreitas, fica lado a lado a partir de `sm`.
 */
export function PageHeader({ title, description, meta, action, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {meta}
        </div>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
