import { ThemeToggle } from '@/components/theme/theme-toggle';

/**
 * Shell de `(auth)` — deliberadamente pouco opinativo (sem largura máxima,
 * sem centralização): cada página do grupo decide a própria composição.
 * O login usa dois painéis (`AuthBrandPanel` + formulário); uma futura tela
 * de recuperação de senha pode continuar de painel único sem herdar um
 * `max-w-sm` que não serve a dois layouts diferentes.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-background">
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>
      {children}
    </div>
  );
}
