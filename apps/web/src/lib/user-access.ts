import type { UserItem } from '@/types/user';

/**
 * Réplica, só para a UI antecipar com a razão visível, das DUAS proteções
 * obrigatórias que `lib/services/users.ts` (Vega) já recusa de qualquer
 * jeito: ninguém se autoexclui/autorrebaixa, e o sistema nunca fica sem
 * nenhum admin ativo. **Nunca é o gate real** — desabilitar um botão aqui é
 * cortesia; o servidor decide e a tela só trata o erro que ele devolver
 * (ver `ApiRequestError`/`ErrorState`).
 */
export type ActionAvailability = { disabled: false } | { disabled: true; reason: string };

const AVAILABLE: ActionAvailability = { disabled: false };

export function isSelf(target: UserItem, currentUserId: string): boolean {
  return target.id === currentUserId;
}

export function countActiveAdmins(users: UserItem[]): number {
  return users.filter((u) => u.role === 'admin' && u.isActive).length;
}

export type AdminGuardContext = {
  currentUserId: string;
  /** Usuários já carregados na tela — usado só para a contagem de admins ativos. */
  loadedUsers: UserItem[];
  /**
   * `true` quando `loadedUsers` é o conjunto INTEIRO (sem próxima página) do
   * filtro atual. Paginado e incompleto, a contagem de admins pode estar
   * incompleta — nesse caso a função nunca desabilita por "último admin"
   * (evita bloquear uma ação válida por um admin que está fora da página
   * carregada). A autoproteção (não se autoexcluir/autorrebaixar) não
   * depende disso e vale sempre.
   */
  listComplete: boolean;
};

/** Regras de `updateUser`: recusa rebaixar a si mesmo, e recusa tirar o último admin ativo do papel de admin. */
export function canChangeRole(target: UserItem, nextRole: UserItem['role'], ctx: AdminGuardContext): ActionAvailability {
  if (target.role !== 'admin' || nextRole === 'admin') return AVAILABLE;
  if (isSelf(target, ctx.currentUserId)) {
    return { disabled: true, reason: 'Você não pode remover seu próprio acesso de administrador.' };
  }
  if (target.isActive && ctx.listComplete && countActiveAdmins(ctx.loadedUsers) <= 1) {
    return {
      disabled: true,
      reason: 'É o último administrador ativo do sistema — promova outra pessoa a administradora antes de rebaixar esta.',
    };
  }
  return AVAILABLE;
}

/** Regras de `updateUser`/`deactivateUser`: recusa desativar a si mesmo, e recusa desativar o último admin ativo. */
export function canDeactivate(target: UserItem, ctx: AdminGuardContext): ActionAvailability {
  if (isSelf(target, ctx.currentUserId)) {
    return { disabled: true, reason: 'Você não pode desativar sua própria conta.' };
  }
  if (target.role === 'admin' && target.isActive && ctx.listComplete && countActiveAdmins(ctx.loadedUsers) <= 1) {
    return {
      disabled: true,
      reason: 'É o último administrador ativo do sistema — não é possível desativá-lo.',
    };
  }
  return AVAILABLE;
}
