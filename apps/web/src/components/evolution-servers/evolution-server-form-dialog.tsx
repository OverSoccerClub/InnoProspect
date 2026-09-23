'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createEvolutionServer, updateEvolutionServer } from '@/lib/api/evolution-servers';
import { ApiRequestError } from '@/lib/fetcher';
import type { EvolutionServerItem } from '@/types/evolution-server';

type EvolutionServerFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null`/ausente = cadastro. Presente = edição daquele servidor. */
  server?: EvolutionServerItem | null;
  /** Chamado com o id do servidor salvo (novo ou editado) — a tela usa para sugerir "Testar conexão" logo em seguida. */
  onSaved: (serverId: string) => void;
};

const EMPTY_STATE = { name: '', baseUrl: '', apiKey: '' };

/**
 * Formulário único de cadastrar/editar (mesmo padrão de `UserFormDialog`). A
 * credencial (`apiKey`) NUNCA vem pré-preenchida — a API não a devolve em
 * nenhuma resposta (ver comentário no topo de `evolution-server.contract.ts`)
 * — e o campo em branco na edição significa "manter a atual", nunca
 * "apagar".
 *
 * Rotacionar (preencher o campo em edição) é uma ação destrutiva e
 * silenciosa: se a chave nova estiver errada, os envios por este servidor
 * param de funcionar sem nenhum erro visível na hora — só quando uma
 * instância tentar usá-lo. Por isso, ao detectar rotação, o formulário troca
 * de tela para uma confirmação explícita ANTES de salvar (mesmo `Dialog`,
 * sem abrir um segundo por cima — evita empilhar dois overlays) e sugere
 * testar a conexão depois (`onSaved` sempre devolve o id, e a tabela realça
 * o botão "Testar conexão" para aquele servidor).
 */
export function EvolutionServerFormDialog({ open, onOpenChange, server, onSaved }: EvolutionServerFormDialogProps) {
  const isEdit = Boolean(server);
  const [name, setName] = useState(EMPTY_STATE.name);
  const [baseUrl, setBaseUrl] = useState(EMPTY_STATE.baseUrl);
  const [apiKey, setApiKey] = useState(EMPTY_STATE.apiKey);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmingRotation, setConfirmingRotation] = useState(false);

  // Reidrata o formulário quando o dialog abre — nunca com a senha/chave,
  // que a API não devolve (mesmo padrão de `UserFormDialog`).
  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setApiKey('');
    setConfirmingRotation(false);
    setName(server?.name ?? EMPTY_STATE.name);
    setBaseUrl(server?.baseUrl ?? EMPTY_STATE.baseUrl);
  }, [open, server]);

  const isRotatingKey = isEdit && apiKey.trim().length > 0;

  function validate(): string | null {
    if (name.trim().length < 2) return 'Dê um nome para identificar este servidor (ex.: "Principal").';
    const trimmedUrl = baseUrl.trim();
    if (trimmedUrl.length === 0) return 'Informe a URL base da Evolution API (ex.: https://evolution.seudominio.com).';
    if (!/^https?:\/\//.test(trimmedUrl)) return 'A URL base precisa começar com http:// ou https://.';
    if (!isEdit && apiKey.trim().length === 0) return 'Informe a chave de API deste servidor.';
    return null;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const validationError = validate();
    if (validationError) {
      setFormError(validationError);
      return;
    }
    if (isRotatingKey) {
      setConfirmingRotation(true);
      return;
    }
    void save();
  }

  async function save() {
    setIsSubmitting(true);
    setFormError(null);
    try {
      const result =
        isEdit && server
          ? await updateEvolutionServer(server.id, {
              name: name.trim(),
              baseUrl: baseUrl.trim(),
              ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
            })
          : await createEvolutionServer({ name: name.trim(), baseUrl: baseUrl.trim(), apiKey: apiKey.trim() });
      setConfirmingRotation(false);
      onOpenChange(false);
      onSaved(result.id);
    } catch (err) {
      setConfirmingRotation(false);
      setFormError(err instanceof ApiRequestError ? err.message : 'Não foi possível salvar o servidor agora.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isSubmitting && onOpenChange(next)}>
      <DialogContent>
        {!confirmingRotation ? (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{isEdit ? `Editar ${server?.name}` : 'Cadastrar servidor Evolution'}</DialogTitle>
              <DialogDescription>
                {isEdit
                  ? 'A credencial cadastrada nunca é exibida, mesmo mascarada — deixe o campo em branco para mantê-la como está.'
                  : 'Instâncias de WhatsApp criadas a partir de agora poderão nascer neste servidor.'}
              </DialogDescription>
            </DialogHeader>

            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="server-name">Nome *</Label>
              <Input id="server-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="server-base-url">URL base *</Label>
              <Input
                id="server-base-url"
                type="url"
                placeholder="https://evolution.seudominio.com"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="server-api-key">{isEdit ? 'Rotacionar chave de API (opcional)' : 'Chave de API *'}</Label>
              <Input
                id="server-api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={isEdit ? 'Deixe em branco para manter a atual' : 'Chave da Evolution API deste servidor'}
                autoComplete="new-password"
                required={!isEdit}
              />
              {isEdit && (
                <p className="text-xs text-muted-foreground">
                  Preencher aqui substitui a credencial atual — a próxima tela confirma antes de salvar.
                </p>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" aria-hidden="true" />}
                {isSubmitting ? 'Salvando…' : isEdit ? 'Salvar alterações' : 'Cadastrar'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Rotacionar a chave de {server?.name}?</DialogTitle>
              <DialogDescription>
                Isso substitui a credencial atual imediatamente. Se a chave nova estiver errada, os envios por este
                servidor param de funcionar sem nenhum erro visível na hora — só quando uma instância tentar usá-lo.
              </DialogDescription>
            </DialogHeader>

            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <Alert variant="warning">
              <AlertDescription>Depois de salvar, use &ldquo;Testar conexão&rdquo; para confirmar que a chave nova está certa.</AlertDescription>
            </Alert>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConfirmingRotation(false)} disabled={isSubmitting}>
                Voltar
              </Button>
              <Button type="button" variant="destructive" onClick={() => void save()} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" aria-hidden="true" />}
                {isSubmitting ? 'Salvando…' : 'Rotacionar e salvar'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
