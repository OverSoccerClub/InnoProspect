const STATS = [
  { value: '5.571', label: 'municípios cobertos (base IBGE)' },
  { value: '27', label: 'UFs, o Brasil inteiro' },
];

/**
 * Faixa de destaque com números REAIS (seed do IBGE, `packages/db/prisma/
 * seed.ts`) — nada de métrica de cliente inventada. Usa o par
 * `primary`/`primary-foreground` já verificado em WCAG (DESIGN-SYSTEM.md
 * §7, mesmo par do botão) — nenhum contraste novo pra calcular.
 */
export function StatBand() {
  return (
    <section className="border-t border-border bg-primary py-14 sm:py-16">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 text-center sm:grid-cols-2 sm:px-6 lg:px-8">
        {STATS.map((stat) => (
          <div key={stat.label}>
            <p className="font-display text-5xl font-bold tabular-nums text-primary-foreground sm:text-6xl">
              {stat.value}
            </p>
            <p className="mt-2 text-sm text-primary-foreground/85">{stat.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
