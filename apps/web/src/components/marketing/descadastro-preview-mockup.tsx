import { CheckCircle2, Radar, ShieldCheck } from 'lucide-react';

/**
 * Prévia da página pública `/descadastro/:token` — mesma composição visual
 * da tela real (ícone de estado em círculo, wordmark, rodapé de
 * credibilidade), reduzida pra caber como visual de apoio na seção de
 * conformidade. Nunca um link real, nunca dado de um contato real.
 */
export function DescadastroPreviewMockup() {
  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 translate-x-3 translate-y-3 rounded-2xl bg-primary/[0.07] blur-2xl"
      />
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
        <span className="flex items-center gap-1.5">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Radar className="size-3.5" aria-hidden="true" />
          </span>
          <span className="font-display text-sm font-bold tracking-tight">
            Inno<span className="text-primary">Prospect</span>
          </span>
        </span>

        <span className="flex size-16 items-center justify-center rounded-full bg-success/10 text-success">
          <CheckCircle2 className="size-8" aria-hidden="true" />
        </span>

        <div>
          <p className="font-display text-base font-semibold text-foreground">Você foi removido da nossa lista</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Este número não recebe mais mensagens nossas. O pedido foi processado agora.
          </p>
        </div>

        <div className="flex items-center gap-1.5 border-t border-border pt-4 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
          Esta página nunca pede senha ou pagamento.
        </div>
      </div>
    </div>
  );
}
