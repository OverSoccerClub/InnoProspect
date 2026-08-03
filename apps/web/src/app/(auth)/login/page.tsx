import type { Metadata } from 'next';
import { Radar } from 'lucide-react';

import { LoginForm } from '@/components/auth/login-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Entrar — InnoProspect',
};

export default function LoginPage() {
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex items-center gap-2.5">
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
  );
}
