import { ListChecks, Radar, Send } from 'lucide-react';

const STEPS = [
  {
    number: '01',
    icon: ListChecks,
    title: 'Escolha nicho e UF',
    description:
      'Diga o que procura (ex.: "clínicas odontológicas") e onde — um estado inteiro ou só as cidades que interessam.',
  },
  {
    number: '02',
    icon: Radar,
    title: 'O sistema coleta',
    description:
      'O InnoProspect varre o Google Maps cidade por cidade, prioriza as mais populosas e mostra o progresso ao vivo — sem parecer travado numa UF grande.',
  },
  {
    number: '03',
    icon: Send,
    title: 'Você aborda pelo WhatsApp',
    description:
      'Cada resultado vira um lead com telefone, tipo de linha e contexto de origem — pronto pra você iniciar a conversa.',
  },
];

/** Âncora `#como-funciona` é o alvo do link "Ver como funciona" do Hero. */
export function HowItWorks() {
  return (
    <section id="como-funciona" className="scroll-mt-20 border-t border-border bg-muted/30 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Como funciona
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            Três passos entre &ldquo;não tenho leads nesse nicho&rdquo; e uma lista organizada pronta pra abordagem.
          </p>
        </div>

        <ol className="mt-12 grid gap-6 sm:grid-cols-3">
          {STEPS.map((step) => {
            const Icon = step.icon;
            return (
              <li
                key={step.number}
                className="relative flex flex-col gap-3 rounded-xl border border-border bg-card p-6 shadow-xs"
              >
                <span className="font-display text-sm font-bold text-primary/50" aria-hidden="true">
                  {step.number}
                </span>
                <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="font-display text-base font-semibold text-foreground">{step.title}</h3>
                <p className="text-sm text-muted-foreground">{step.description}</p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
