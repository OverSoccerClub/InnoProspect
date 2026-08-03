'use client';

import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createOptOut } from '@/lib/api/optouts';
import { ApiRequestError } from '@/lib/fetcher';
import { isValidE164 } from '@/lib/format';

type AddOptOutDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

export function AddOptOutDialog({ open, onOpenChange, onCreated }: AddOptOutDialogProps) {
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function reset() {
    setPhone('');
    setReason('');
    setPhoneError(null);
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const trimmed = phone.trim();
    if (!isValidE164(trimmed)) {
      setPhoneError('Use o formato internacional, ex.: +5511987654321.');
      return;
    }
    setPhoneError(null);
    setIsSubmitting(true);
    try {
      await createOptOut({ phoneE164: trimmed, reason: reason.trim() || undefined, source: 'manual' });
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      setFormError(err instanceof ApiRequestError ? err.message : 'Não foi possível adicionar o opt-out agora.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Adicionar opt-out manualmente</DialogTitle>
            <DialogDescription>
              Use quando alguém pedir para não receber mensagens por outro canal (telefone, e-mail). O bloqueio
              vale para o número, não para um lead específico, e é aplicado antes de qualquer envio futuro.
            </DialogDescription>
          </DialogHeader>

          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="optout-phone">Telefone *</Label>
            <Input
              id="optout-phone"
              type="tel"
              placeholder="+5511987654321"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-invalid={Boolean(phoneError)}
              aria-describedby={phoneError ? 'optout-phone-error' : undefined}
              autoFocus
            />
            {phoneError && (
              <p id="optout-phone-error" className="text-sm text-destructive">
                {phoneError}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="optout-reason">Motivo (opcional)</Label>
            <Input
              id="optout-reason"
              placeholder="Ex.: pediu por telefone"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" aria-hidden="true" />}
              {isSubmitting ? 'Adicionando…' : 'Adicionar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
