import { MapPinOff } from 'lucide-react';

/**
 * De qual busca/nicho o lead veio, discreta o suficiente para não competir
 * com o nome do lead numa lista longa — texto pequeno e mudo por padrão, sem
 * coluna própria (colunas de baixa prioridade já saem do fluxo em telas
 * estreitas, e "de onde veio" precisa continuar visível em qualquer largura,
 * ver handoff de 2026-09-23). Cabeçalho de grupo por busca foi descartado de
 * propósito: a lista é paginada e um grupo pode atravessar duas páginas.
 *
 * O selo "fora do nicho" (pedido do dono, 2026-09-23) usa a mesma correção já
 * registrada para `Alert` (`feedback_dual_role_color_tokens`): a cor
 * semântica colore só o ÍCONE/borda, nunca o corpo do texto — evita repetir o
 * bug de contraste achado naquele componente (`text-warning-foreground`
 * direto sobre `bg-warning/10` chegava a 1.02:1).
 */
export function LeadOrigin({ searchNiche, offNiche }: { searchNiche: string | null; offNiche: boolean }) {
  if (!searchNiche) return null;

  return (
    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span className="truncate" title={`Encontrado na busca por "${searchNiche}"`}>
        via {searchNiche}
      </span>
      {offNiche && (
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-warning-foreground/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground dark:border-warning/40"
          title="A categoria deste lead não corresponde ao nicho buscado — o Google Maps traz resultados próximos geograficamente, não só do nicho exato. Ele continua na lista; use o filtro para revisar todos de uma vez."
        >
          <MapPinOff className="size-2.5 text-warning-foreground dark:text-warning" aria-hidden="true" />
          fora do nicho
        </span>
      )}
    </div>
  );
}
