import type { Metadata } from 'next';

import { NewSearchForm } from '@/components/searches/new-search-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Nova busca — InnoProspect',
};

export default function NewSearchPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Nova busca</h1>
        <p className="text-sm text-muted-foreground">
          Descreva o nicho e a UF. O InnoProspect varre o Google Maps município a município e transforma o
          resultado em leads.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detalhes da busca</CardTitle>
          <CardDescription>Campos com * são obrigatórios.</CardDescription>
        </CardHeader>
        <CardContent>
          <NewSearchForm />
        </CardContent>
      </Card>
    </div>
  );
}
