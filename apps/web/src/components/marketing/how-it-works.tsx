import { ListChecks, Radar, Send } from 'lucide-react';

const STEPS = [
  {
    icon: ListChecks,
    title: 'Escolha nicho e UF',
    description:
      'Diga o que procura (ex.: "clínicas odontológicas") e onde: um estado inteiro ou só as cidades que interessam.',
  },
  {
    icon: Radar,
    title: 'O sistema coleta',
    description:
      'O InnoProspect varre o Google Maps cidade por cidade, prioriza as mais populosas e mostra o progresso ao vivo.',
  },
  {
    icon: Send,
    title: 'Você aborda pelo WhatsApp',
    description: 'Cada resultado vira um lead com telefone, tipo de linha e contexto, pronto para iniciar a conversa.',
  },
];

/**
 * Passos horizontais ligados por uma linha (desktop) — troca a fórmula de
 * "3 cards iguais" repetida em toda seção da página (apontado na rodada de
 * refinamento). No mobile a linha vira vertical, ligando os círculos
 * numerados de cima a baixo.
 */
export function HowItWorks() {
  return (
    <section id="como-funciona" className="scroll-mt-20 border-t border-border py-20 sm:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Como funciona
          </h2>
          <p className="mt-3 text-lg text-muted-foreground">
            Três passos entre não ter leads nesse nicho e uma lista organizada pronta para abordagem.
          </p>
        </div>

        <ol className="relative mt-16 grid gap-10 sm:grid-cols-3 sm:gap-6">
          {/* Linha conectora — só desktop, atrás dos círculos (z-index implícito por ordem no DOM). */}
          <div aria-hidden="true" className="absolute left-0 right-0 top-7 hidden h-px bg-border sm:block" />

          {STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="relative flex flex-col items-start gap-4 sm:items-center sm:text-center">
                <span className="relative flex size-14 shrink-0 items-center justify-center rounded-full border-4 border-background bg-primary text-primary-foreground shadow-md">
                  <Icon className="size-6" aria-hidden="true" />
                  <span className="absolute -right-1 -top-1 flex size-6 items-center justify-center rounded-full bg-card text-[11px] font-bold text-foreground shadow-xs ring-1 ring-border">
                    {index + 1}
                  </span>
                </span>
                <div>
                  <h3 className="font-display text-lg font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground sm:max-w-xs">{step.description}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
