'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Loader2, Server as ServerIcon } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { listEvolutionServers } from '@/lib/api/evolution-servers';
import { createInstance } from '@/lib/api/whatsapp';
import { ApiRequestError } from '@/lib/fetcher';
import type { EvolutionServerItem } from '@/types/evolution-server';

type CreateInstanceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** avisa a tela de fora com o id criado, pra já abrir o modal de QR na sequência */
  onCreated: (instanceId: string, instanceName: string) => void;
};

/**
 * 🆕 Fase 4.B — toda instância nova precisa nascer em um `EvolutionServer`
 * (`evolutionServerId` obrigatório no contrato, ver `whatsapp.contract.ts`).
 * Os servidores são carregados só quando o diálogo abre (não na montagem da
 * página `/whatsapp`) e reidratados a cada abertura — mesmo espírito de
 * `UserFormDialog`. Caso especial tratado explicitamente: NENHUM servidor
 * ativo cadastrado (hoje é o estado de todo mundo, cliente novo incluso) —
 * a tela não trava num select vazio, ela leva direto para o cadastro.
 */
export function CreateInstanceDialog({ open, onOpenChange, onCreated }: CreateInstanceDialogProps) {
  const [name, setName] = useState('');
  const [evolutionServerId, setEvolutionServerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [servers, setServers] = useState<EvolutionServerItem[] | null>(null);
  const [isLoadingServers, setIsLoadingServers] = useState(false);
  const [serversError, setServersError] = useState<string | null>(null);

  function loadServers() {
    setIsLoadingServers(true);
    setServersError(null);
    listEvolutionServers()
      .then((data) => {
        setServers(data);
        const firstActive = data.find((s) => s.isActive);
        setEvolutionServerId(firstActive?.id ?? '');
      })
      .catch((err: unknown) => {
        setServersError(err instanceof ApiRequestError ? err.message : 'Não foi possível carregar os servidores Evolution.');
      })
      .finally(() => setIsLoadingServers(false));
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (next) {
      setError(null);
      setName('');
      setServers(null);
      setEvolutionServerId('');
      loadServers();
    }
  }

  const activeServers = (servers ?? []).filter((s) => s.isActive);
  const hasNoActiveServers = servers !== null && !isLoadingServers && !serversError && activeServers.length === 0;
  const canSubmit = !isLoadingServers && !serversError && !hasNoActiveServers;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Dê um nome para identificar esse número (ex.: "Comercial — linha 1").');
      return;
    }
    if (!evolutionServerId) {
      setError('Escolha em qual servidor Evolution esta instância vai nascer.');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await createInstance({ name: trimmed, evolutionServerId, startWarmup: true });
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
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

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="instance-server">Servidor Evolution</Label>

            {serversError && (
              <Alert variant="destructive">
                <AlertDescription className="flex flex-col gap-2">
                  <span>{serversError}</span>
                  <Button type="button" size="sm" variant="outline" onClick={loadServers} className="w-fit">
                    Tentar novamente
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {!serversError && hasNoActiveServers && (
              <Alert variant="warning">
                <ServerIcon />
                <AlertDescription className="flex flex-col gap-2">
                  <span>
                    Nenhum servidor Evolution ativo cadastrado ainda — cadastre um antes de criar a primeira
                    instância.
                  </span>
                  <Button asChild size="sm" variant="outline" className="w-fit">
                    <Link href="/configuracoes/servidores-evolution" onClick={() => onOpenChange(false)}>
                      Cadastrar servidor Evolution
                    </Link>
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {!serversError && !hasNoActiveServers && (
              <Select
                id="instance-server"
                value={evolutionServerId}
                onChange={(e) => setEvolutionServerId(e.target.value)}
                disabled={isLoadingServers || activeServers.length === 0}
                aria-label="Servidor Evolution onde esta instância vai nascer"
              >
                {isLoadingServers && <option value="">Carregando servidores…</option>}
                {!isLoadingServers &&
                  activeServers.map((server) => (
                    <option key={server.id} value={server.id}>
                      {server.name}
                    </option>
                  ))}
              </Select>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting || !canSubmit}>
              {isSubmitting && <Loader2 className="animate-spin" aria-hidden="true" />}
              {isSubmitting ? 'Criando…' : 'Criar e conectar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
