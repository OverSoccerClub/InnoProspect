'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ROLE_META } from '@/components/users/role-meta';
import { createUser, updateUser } from '@/lib/api/users';
import { ApiRequestError } from '@/lib/fetcher';
import { canChangeRole, type AdminGuardContext } from '@/lib/user-access';
import type { UserItem, UserRole } from '@/types/user';

type UserFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null`/ausente = criação. Presente = edição daquele usuário. */
  user?: UserItem | null;
  currentUserId: string;
  guardContext: Omit<AdminGuardContext, 'currentUserId'>;
  onSaved: () => void;
};

const EMPTY_STATE = { name: '', email: '', password: '', role: 'operator' as UserRole };

/**
 * Formulário único de criar/editar (mesma lógica de `AddOptOutDialog`, um
 * dialog reusado pros dois modos). Senha: em criação é obrigatória; em
 * edição é opcional e, se preenchida, RESETA a senha (contrato PATCH) — o
 * campo nunca vem pré-preenchido (a API não devolve senha/hash em nenhuma
 * resposta).
 */
export function UserFormDialog({ open, onOpenChange, user, currentUserId, guardContext, onSaved }: UserFormDialogProps) {
  const isEdit = Boolean(user);
  const [name, setName] = useState(EMPTY_STATE.name);
  const [email, setEmail] = useState(EMPTY_STATE.email);
  const [password, setPassword] = useState(EMPTY_STATE.password);
  const [role, setRole] = useState<UserRole>(EMPTY_STATE.role);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reidrata o formulário quando o dialog abre (criação limpa, edição
  // preenche com o usuário atual) — nunca com a senha, que a API não devolve.
  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setPassword('');
    setName(user?.name ?? EMPTY_STATE.name);
    setEmail(user?.email ?? EMPTY_STATE.email);
    setRole(user?.role ?? EMPTY_STATE.role);
  }, [open, user]);

  const roleGuard = user
    ? canChangeRole(user, role, { ...guardContext, currentUserId })
    : { disabled: false as const };
  // Trocar o papel de operador->admin nunca é bloqueado por `canChangeRole`
  // (ela só existe pra proteger quem JÁ é admin) — o aviso de sessão aberta
  // só faz sentido no sentido contrário (perder acesso de admin).
  const isDemotingFromAdmin = isEdit && user?.role === 'admin' && role !== 'admin';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (roleGuard.disabled) {
      setFormError(roleGuard.reason);
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEdit && user) {
        await updateUser(
          user.id,
          {
            name: name.trim(),
            email: email.trim(),
            role,
            ...(password ? { password } : {}),
          },
          currentUserId,
        );
      } else {
        await createUser({ name: name.trim(), email: email.trim(), password, role });
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      // `reason`/status já vêm prontos do servidor (autoexclusão, e-mail
      // duplicado, último admin) — sempre exibir `message`, nunca reescrever.
      setFormError(err instanceof ApiRequestError ? err.message : 'Não foi possível salvar o usuário agora.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const roleDescription = ROLE_META[role].description;

  return (
    <Dialog open={open} onOpenChange={(next) => !isSubmitting && onOpenChange(next)}>
      <DialogContent>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{isEdit ? `Editar ${user?.name}` : 'Adicionar usuário'}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? 'Alterações de papel entram em vigor no próximo login — uma sessão já aberta continua valendo como estava.'
                : 'A pessoa entra com o e-mail e a senha definidos aqui. A senha nunca aparece de novo — só é redefinida por uma ação explícita.'}
            </DialogDescription>
          </DialogHeader>

          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="user-name">Nome *</Label>
            <Input id="user-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="user-email">E-mail *</Label>
            <Input id="user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="user-password">{isEdit ? 'Nova senha (opcional)' : 'Senha *'}</Label>
            <Input
              id="user-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isEdit ? 'Deixe em branco para manter a atual' : 'Mínimo de 8 caracteres'}
              // `minLength` só é checado pelo navegador quando o campo TEM valor —
              // em edição, deixar em branco (campo opcional) passa direto, mesmo com isto fixo.
              minLength={8}
              required={!isEdit}
              autoComplete="new-password"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="user-role">Papel *</Label>
            <Select id="user-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              <option value="operator">{ROLE_META.operator.label}</option>
              <option value="admin">{ROLE_META.admin.label}</option>
            </Select>
            <p className="text-xs text-muted-foreground">{roleDescription}</p>
            {isDemotingFromAdmin && !roleGuard.disabled && (
              <p className="text-xs text-muted-foreground">
                Se {user?.name} já estiver com uma sessão aberta, o acesso de administrador continua valendo até ela
                expirar ou a pessoa entrar de novo — retirar o papel aqui não derruba o que já está em andamento.
              </p>
            )}
            {roleGuard.disabled && (
              <p className="text-xs text-destructive">{roleGuard.reason}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" aria-hidden="true" />}
              {isSubmitting ? 'Salvando…' : isEdit ? 'Salvar alterações' : 'Adicionar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
