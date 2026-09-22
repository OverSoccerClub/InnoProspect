import { BellOff, Clock, ShieldCheck } from 'lucide-react';

const ITEMS = [
  {
    icon: BellOff,
    title: 'Descadastro imediato, sem intervenção manual',
    description:
      'Qualquer contato pode pedir pra sair a qualquer momento. O pedido é processado na hora, por uma página pública própria — ninguém precisa aguardar um humano dar baixa numa planilha.',
  },
  {
    icon: Clock,
    title: 'Janela de horário de disparo',
    description:
      'Cada campanha define uma janela de horário permitida — mensagem fora dela não sai. Faz parte do desenho do produto; o disparo em si ainda está em construção.',
  },
  {
    icon: ShieldCheck,
    title: 'Pausa automática de segurança',
    description:
      'Quando uma métrica foge do padrão (ex.: taxa alta de resultados vazios, possível bloqueio), o sistema pausa sozinho e exige confirmação humana explícita antes de retomar — nunca continua no automático perto de um risco.',
  },
];

/**
 * Seção de conformidade/LGPD — diferencial real do produto, não enfeite de
 * marketing (pedido do dono). O item "pausa automática" é o mesmo mecanismo
 * que o banner de saúde da fila mostra no painel logado (`components/
 * dashboard/queue-health-banner.tsx`) — a landing só descreve em prosa o que
 * o operador já vê e confirma na prática.
 */
export function ComplianceSection() {
  return (
    <section className="border-t border-border bg-muted/30 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Conformidade não é opcional
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            Abordar empresas em escala só é sustentável se quem não quer contato puder sair fácil, e se o
            sistema souber parar sozinho quando algo foge do esperado.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl gap-5 sm:grid-cols-3">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-6 shadow-xs">
                <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="font-display text-base font-semibold text-foreground">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
