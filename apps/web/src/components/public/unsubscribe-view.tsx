'use client';

import { useState } from 'react';
import { CheckCircle2, Clock, Loader2, MessageCircleOff, ShieldAlert } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { confirmPublicOptOut } from '@/lib/api/public-optout';
import { ApiRequestError } from '@/lib/fetcher';

type ViewState = 'idle' | 'submitting' | 'success' | 'already' | 'invalid' | 'rate_limited' | 'error';

/**
 * Página pública de descadastro (ARQUITETURA.md §4.7/§7.3) — sem sessão, é o
 * link que vai dentro da mensagem de WhatsApp. Sem GET de validação prévia no
 * contrato: a única chamada é o `POST /api/v1/public/optout` no clique do
 * botão de confirmação, e o resultado (inclusive token inválido/expirado) é
 * tratado só a partir da resposta desse POST.
 */
export function UnsubscribeView({ token }: { token: string }) {
  const [state, setState] = useState<ViewState>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function handleConfirm() {
    setState('submitting');
    try {
      const result = await confirmPublicOptOut(token);
      setMessage(result.message);
      setState('success');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === 'NOT_FOUND') {
          setState('invalid');
          return;
        }
        if (err.code === 'RATE_LIMITED') {
          setState('rate_limited');
          return;
        }
        if (err.code === 'CONFLICT') {
          // já estava descadastrado — o resultado que a pessoa queria já vale, então tratamos como sucesso
          setMessage('Você já estava descadastrado. Não vamos te enviar mais mensagens.');
          setState('already');
          return;
        }
        setMessage(err.message);
        setState('error');
        return;
      }
      setMessage('Não foi possível processar seu pedido agora.');
      setState('error');
    }
  }

  if (state === 'success' || state === 'already') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <CheckCircle2 className="size-10 text-success" aria-hidden="true" />
          <p className="text-lg font-semibold">Pronto!</p>
          <p className="text-sm text-muted-foreground">
            {message ?? 'Você não vai mais receber mensagens nossas por WhatsApp.'}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (state === 'invalid') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <ShieldAlert className="size-10 text-muted-foreground" aria-hidden="true" />
          <p className="text-lg font-semibold">Este link não é mais válido</p>
          <p className="text-sm text-muted-foreground">
            Ele pode ter expirado ou já ter sido usado. Se você ainda quer parar de receber mensagens, responda{' '}
            <strong>SAIR</strong> na própria conversa do WhatsApp — funciona a qualquer momento.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (state === 'rate_limited') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <Clock className="size-10 text-muted-foreground" aria-hidden="true" />
          <p className="text-lg font-semibold">Muitas tentativas</p>
          <p className="text-sm text-muted-foreground">
            Foram feitas várias tentativas em pouco tempo por aqui. Aguarde um minuto e tente novamente.
          </p>
          <Button variant="outline" onClick={() => setState('idle')}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="items-center text-center">
        <MessageCircleOff className="mb-1 size-8 text-muted-foreground" aria-hidden="true" />
        <CardTitle className="text-lg">Parar de receber mensagens</CardTitle>
        <CardDescription>
          Você está prestes a cancelar o recebimento de mensagens de WhatsApp desta empresa. Isso não exige login e
          vale imediatamente.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {state === 'error' && (
          <Alert variant="destructive">
            <AlertDescription>{message ?? 'Não foi possível processar seu pedido agora.'}</AlertDescription>
          </Alert>
        )}
        <Button size="lg" className="w-full" onClick={handleConfirm} disabled={state === 'submitting'}>
          {state === 'submitting' && <Loader2 className="animate-spin" aria-hidden="true" />}
          {state === 'submitting' ? 'Confirmando…' : 'Sim, quero parar de receber mensagens'}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Seus dados de contato continuam guardados só para respeitar esse pedido — não usamos para mais nada.
        </p>
      </CardContent>
    </Card>
  );
}
