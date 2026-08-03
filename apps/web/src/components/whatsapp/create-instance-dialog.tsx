'use client';

import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createInstance } from '@/lib/api/whatsapp';
import { ApiRequestError } from '@/lib/fetcher';

type CreateInstanceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** avisa a tela de fora com o id criado, pra já abrir o modal de QR na sequência */
  onCreated: (instanceId: string, instanceName: string) => void;
};

export function CreateInstanceDialog({ open, onOpenChange, onCreated }: CreateInstanceDialogProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Dê um nome para identificar esse número (ex.: "Comercial — linha 1").');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await createInstance({ name: trimmed, startWarmup: true });
      setName('');
      onOpenChange(false);
      onCreated(result.id, result.name);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Não foi possível criar a instância agora.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Nova instância de WhatsApp</DialogTitle>
            <DialogDescription>
              Depois de criar, você vai escanear um QR Code para conectar o número. O aquecimento (ramp-up) começa
              automaticamente para proteger o número contra bloqueio.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="instance-name">Nome</Label>
            <Input
              id="instance-name"
              placeholder="Ex.: Comercial — linha 1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" aria-hidden="true" />}
              {isSubmitting ? 'Criando…' : 'Criar e conectar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
