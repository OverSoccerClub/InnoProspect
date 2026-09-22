import type { Metadata } from 'next';
import { Radar } from 'lucide-react';

import { AuthBrandPanel } from '@/components/auth/auth-brand-panel';
import { LoginForm } from '@/components/auth/login-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Entrar — InnoProspect',
};

/**
 * Layout de dois painéis (`lg:grid-cols-2`): `AuthBrandPanel` à esquerda com
 * prova do que o produto faz, formulário à direita — troca o cartão branco
 * solitário sobre cinza chapado da versão anterior (reprovada como "feira e
 * fria"). Abaixo de `lg`, o painel de marca some (`hidden lg:flex` dentro
 * dele) e o wordmark compacto aqui reaparece, então a tela nunca fica sem
 * identidade nenhuma.
 *
 * Nenhuma lógica de autenticação muda aqui — `LoginForm` continua chamando
 * `lib/auth-client.ts#login` exatamente como antes (arquivo do Vega,
 * auditado pelo Órion). Só a camada visual e os estados de loading/erro do
 * formulário foram refinados.
 */
export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <AuthBrandPanel />

      <div className="relative flex items-center justify-center overflow-hidden p-4 py-16 sm:p-8">
        {/* Halo de marca sutil atrás do cartão — mesma "voz" visual do hero da
         * landing (`components/marketing/hero.tsx`), mantida aqui pra quem
         * chega direto no formulário em telas estreitas (sem o painel de marca). */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/3 -z-10 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/[0.08] blur-3xl lg:hidden"
        />

        <div className="flex w-full max-w-sm flex-col items-center gap-6">
          <div className="flex items-center gap-2.5 lg:hidden">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Radar className="size-5" aria-hidden="true" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight">
              Inno<span className="text-primary">Prospect</span>
            </span>
          </div>

          <Card className="w-full shadow-md">
            <CardHeader>
              <CardTitle className="text-center text-xl">Entrar</CardTitle>
              <CardDescription className="text-center">Acesse suas buscas e leads.</CardDescription>
            </CardHeader>
            <CardContent>
              <LoginForm />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
