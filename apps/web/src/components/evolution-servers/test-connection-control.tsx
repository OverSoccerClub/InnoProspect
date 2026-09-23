'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2, Wifi, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { testEvolutionServerConnection } from '@/lib/api/evolution-servers';
import { ApiRequestError } from '@/lib/fetcher';
import { cn } from '@/lib/utils';

type TestResult =
  | { kind: 'ok'; latencyMs: number }
  | { kind: 'fail'; message: string }
  | { kind: 'request-error'; message: string };

type TestConnectionControlProps = {
  serverId: string;
  serverName: string;
  /**
   * Realce visual (borda) — pedido do dono: depois de rotacionar (ou
   * cadastrar) uma credencial, sugerir explicitamente testar a conexão em
   * vez de deixar essa ação "só mais um botão" na tabela.
   */
  highlighted?: boolean;
};

/**
 * Botão "Testar conexão" + resultado inline (latência ou motivo da falha) —
 * pedido direto do dono: "sem isso, o dono cadastra errado e só descobre
 * quando uma instância falhar". `ok:false` do contrato é o RESULTADO do
 * teste, nunca um erro de rede — só o `catch` (falha ao chamar nossa
 * própria API, ex.: rede caiu) cai no ramo `request-error`.
 */
export function TestConnectionControl({ serverId, serverName, highlighted }: TestConnectionControlProps) {
  const [isTesting, setIsTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  async function handleTest() {
    setIsTesting(true);
    setResult(null);
    try {
      const res = await testEvolutionServerConnection(serverId);
      setResult(
        res.ok
          ? { kind: 'ok', latencyMs: res.latencyMs }
          : { kind: 'fail', message: res.error?.message ?? 'Falha desconhecida ao testar a conexão.' },
      );
    } catch (err) {
      setResult({
        kind: 'request-error',
        message: err instanceof ApiRequestError ? err.message : `Não foi possível testar a conexão com ${serverName} agora.`,
      });
    } finally {
      setIsTesting(false);
    }
  }

  return (
    <div
      className={cn(
        'flex flex-col items-start gap-1.5',
        highlighted && 'rounded-md border border-warning-foreground/40 bg-warning/[0.06] p-2',
      )}
    >
      <Button type="button" size="sm" variant="outline" onClick={handleTest} disabled={isTesting}>
        {isTesting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Wifi aria-hidden="true" />}
        {isTesting ? 'Testando…' : 'Testar conexão'}
      </Button>
      {highlighted && !result && !isTesting && (
        <p className="text-xs text-muted-foreground">Confirme que a credencial está certa antes de confiar neste servidor.</p>
      )}
      {result?.kind === 'ok' && (
        <p className="flex items-center gap-1 text-xs text-success">
          <CheckCircle2 className="size-3.5" aria-hidden="true" />
          Conectado ({result.latencyMs} ms)
        </p>
      )}
      {(result?.kind === 'fail' || result?.kind === 'request-error') && (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <XCircle className="size-3.5 shrink-0" aria-hidden="true" />
          {result.message}
        </p>
      )}
    </div>
  );
}
