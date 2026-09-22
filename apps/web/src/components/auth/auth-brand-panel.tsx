import { MessageCircle, Radar, ScanSearch, Users } from 'lucide-react';

const FEATURE_BULLETS = [
  {
    icon: ScanSearch,
    title: 'Busca por nicho e cidade',
    description: 'Empresas direto do Google Maps, em qualquer UF do Brasil, com progresso em tempo real.',
  },
  {
    icon: Users,
    title: 'Leads organizados',
    description: 'Telefone, tipo de linha, site e histórico de contato — tudo filtrável, nada em planilha solta.',
  },
  {
    icon: MessageCircle,
    title: 'Abordagem por WhatsApp',
    description: 'Templates com variáveis, conversa na ficha do lead e descadastro automático.',
  },
] as const;

// Mesma base do IBGE usada em `components/marketing/stat-band.tsx` — números
// reais (seed em `packages/db/prisma/seed.ts`), nunca métrica inventada.
const COVERAGE_STATS = [
  { value: '5.571', label: 'municípios' },
  { value: '27', label: 'UFs' },
] as const;

/**
 * Painel de marca do login — metade esquerda em telas `lg+` (a direita é o
 * formulário, `app/(auth)/login/page.tsx`). Substitui o cartão branco
 * solitário sobre cinza chapado da versão anterior: aqui quem chega à
 * primeira tela do sistema já vê PROVA do que o produto faz, não só um
 * formulário sem contexto. Server Component puro (sem `'use client'`) — zero
 * custo de hidratação nessa metade da tela.
 *
 * Cor: `bg-primary`/`primary-foreground` é o MESMO par já verificado em WCAG
 * (DESIGN-SYSTEM.md §7, idêntico ao botão e à `StatBand` da landing) — nenhum
 * contraste novo pra calcular aqui.
 *
 * Honestidade de copy (mesma regra da landing, DESIGN-SYSTEM.md §9.2): as 3
 * feature bullets citam só o que já tem tela funcionando de verdade (busca,
 * lista de leads, envio unitário de WhatsApp) — nada de disparo em massa
 * (Campanhas), que continua `comingSoon` na navegação.
 */
export function AuthBrandPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-primary px-10 py-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between xl:px-14">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-32 size-96 rounded-full bg-primary-foreground/[0.08] blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -right-16 size-80 rounded-full bg-primary-foreground/[0.06] blur-3xl"
      />

      <div className="relative flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary-foreground/15">
          <Radar className="size-5" aria-hidden="true" />
        </span>
        <span className="font-display text-lg font-bold tracking-tight">InnoProspect</span>
      </div>

      <div className="relative flex flex-col gap-10">
        <div className="max-w-md">
          <h2 className="font-display text-3xl font-bold leading-[1.1] tracking-tight xl:text-4xl">
            Leads B2B prontos para o WhatsApp.
          </h2>
          <p className="mt-3 max-w-sm text-pretty text-sm text-primary-foreground/80">
            Do nicho e cidade até o contato qualificado — sem planilha manual no meio do caminho.
          </p>
        </div>

        <ul className="flex flex-col gap-5">
          {FEATURE_BULLETS.map((feature) => {
            const Icon = feature.icon;
            return (
              <li key={feature.title} className="flex gap-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-foreground/15">
                  <Icon className="size-4.5" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-display text-sm font-semibold">{feature.title}</p>
                  <p className="mt-0.5 text-sm text-primary-foreground/75">{feature.description}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="relative flex gap-8 border-t border-primary-foreground/15 pt-6">
        {COVERAGE_STATS.map((stat) => (
          <div key={stat.label}>
            <p className="font-display text-2xl font-bold tabular-nums">{stat.value}</p>
            <p className="text-xs text-primary-foreground/70">{stat.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
