import { Radar } from 'lucide-react';

/**
 * Layout da única tela pública do produto — chega por link de WhatsApp,
 * quase sempre no celular, para alguém que não tem contexto nenhum sobre o
 * InnoProspect. Tratada como peça de marca (halo de marca + wordmark no
 * topo + rodapé de credibilidade), não como formulário de sistema — mesma
 * intenção do `(auth)/layout.tsx`, mas sem alternador de tema (a pessoa não
 * tem conta, não precisa de mais uma decisão nessa tela) e com um rodapé que
 * deixa claro que isto não é um link suspeito de phishing.
 */
export default function DescadastroLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background p-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/3 -z-10 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/[0.08] blur-3xl"
      />

      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Radar className="size-5" aria-hidden="true" />
          </span>
          <span className="font-display text-lg font-bold tracking-tight">
            Inno<span className="text-primary">Prospect</span>
          </span>
        </div>

        {children}

        <p className="max-w-xs text-center text-xs text-muted-foreground">
          O InnoProspect é uma plataforma de mensagens usada por empresas para prospecção comercial. Esta página
          confirma pedidos de descadastro — ela nunca pede senha, dados de pagamento ou código de verificação.
        </p>
      </div>
    </div>
  );
}
