import { Sparkles } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TemplateVariationBadge } from '@/components/templates/template-variation-badge';
import { countVariations, renderSamples, variationRisk } from '@/lib/spintax';

const RISK_COPY: Record<'low' | 'medium' | 'good', string> = {
  low: 'Risco alto: essa mensagem sai quase idêntica em todo envio — é o sinal mais fácil de detectar do lado do WhatsApp. Adicione alternativas com {opção a|opção b}.',
  medium:
    'Risco moderado: campanhas com mais de 50 contatos exigem pelo menos 10 variações para iniciar. Vale adicionar mais alternativas.',
  good: 'Boa variação de texto — reduz bastante o risco de bloqueio.',
};

/**
 * Preview ao vivo, calculado localmente (ver `lib/spintax.ts`) — reage a
 * cada tecla, sem round-trip de rede, e mostra amostras diferentes para
 * deixar a variação "tangível" em vez de só um número.
 */
export function TemplatePreview({ body }: { body: string }) {
  const count = countVariations(body);
  const risk = variationRisk(count);
  const samples = body.trim() ? renderSamples(body, 3) : [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Preview</CardTitle>
        <TemplateVariationBadge count={count} />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Alert variant={risk === 'good' ? 'success' : risk === 'medium' ? 'warning' : 'destructive'}>
          <AlertDescription>{RISK_COPY[risk]}</AlertDescription>
        </Alert>

        {samples.length === 0 ? (
          <p className="text-sm text-muted-foreground">Comece a escrever para ver como a mensagem fica.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Sparkles className="size-3.5" aria-hidden="true" />
              Exemplos de envios diferentes para pessoas diferentes
            </p>
            <ul className="flex flex-col gap-2">
              {samples.map((text, index) => (
                <li
                  key={index}
                  className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-sm leading-relaxed"
                >
                  {text}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
