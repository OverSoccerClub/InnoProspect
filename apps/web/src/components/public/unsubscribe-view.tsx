'use client';

import { useState } from 'react';
import { CheckCircle2, Clock, Loader2, MessageCircleOff, ShieldAlert } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { confirmPublicOptOut } from '@/lib/api/public-optout';
import { ApiRequestError } from '@/lib/fetcher';
import { cn } from '@/lib/utils';

type ViewState = 'idle' | 'submitting' | 'success' | 'already' | 'invalid' | 'rate_limited' | 'error';

/**
 * Círculo colorido por trás do ícone de estado — mesmo papel visual do
 * `EmptyState`/KPI (DESIGN-SYSTEM.md), mas aqui a cor do círculo também
 * carrega o resultado (sucesso = verde, neutro = cinza) porque esta tela
 * não tem mais nada na página pra dar esse contexto (sem sidebar, sem
 * topbar, sem badge ao lado).
 */
function StateIcon({ icon: Icon, tone }: { icon: typeof CheckCircle2; tone: 'success' | 'neutral' }) {
  return (
    <div
      className={cn(
        'flex size-14 items-center justify-center rounded-full',
        tone === 'success' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
      )}
    >
      <Icon className="size-7" aria-hidden="true" />
    </div>
  );
}

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
      <Card className="w-full shadow-md">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <StateIcon icon={CheckCircle2} tone="success" />
          <p className="font-display text-xl font-semibold">Pronto!</p>
          <p className="text-sm text-muted-foreground">
            {message ?? 'Você não vai mais receber mensagens nossas por WhatsApp.'}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (state === 'invalid') {
    return (
      <Card className="w-full shadow-md">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <StateIcon icon={ShieldAlert} tone="neutral" />
          <p className="font-display text-xl font-semibold">Este link não é mais válido</p>
          <p className="text-sm text-muted-foreground">
            Ele pode ter expirado ou já ter sido usado. Se você ainda quer parar de receber mensagens, responda{' '}
            <strong className="font-semibold text-foreground">SAIR</strong> na própria conversa do WhatsApp —
            funciona a qualquer momento.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (state === 'rate_limited') {
    return (
      <Card className="w-full shadow-md">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <StateIcon icon={Clock} tone="neutral" />
          <p className="font-display text-xl font-semibold">Muitas tentativas</p>
          <p className="text-sm text-muted-foreground">
            Foram feitas várias tentativas em pouco tempo por aqui. Aguarde um minuto e tente novamente.
          </p>
          <Button variant="outline" onClick={() => setState('idle')} className="mt-1">
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full shadow-md">
      <CardHeader className="items-center pb-2 text-center">
        <div className="mb-1 flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <MessageCircleOff className="size-7" aria-hidden="true" />
        </div>
        <CardTitle className="font-display text-xl">Parar de receber mensagens</CardTitle>
        <CardDescription className="max-w-xs">
          Você está prestes a cancelar o recebimento de mensagens de WhatsApp desta empresa. Isso não exige login e
          vale imediatamente.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-2">
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
