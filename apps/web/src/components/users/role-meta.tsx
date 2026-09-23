import type { LucideIcon } from 'lucide-react';
import { ShieldCheck, UserCog } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { UserRole } from '@/types/user';

/**
 * Explicação em pt-BR do que cada papel concede — pedido explícito do dono:
 * quem cria um usuário precisa entender o que está concedendo, não só ler
 * "admin"/"operator". Único lugar que define esse texto — reusar em vez de
 * escrever de novo no formulário de criação/edição.
 */
export const ROLE_META: Record<UserRole, { label: string; description: string; icon: LucideIcon }> = {
  admin: {
    label: 'Administrador',
    description: 'Faz tudo no sistema — inclui gerir usuários e instâncias de WhatsApp.',
    icon: ShieldCheck,
  },
  operator: {
    label: 'Operador',
    description: 'Usa o sistema no dia a dia (buscas, leads, templates, envio) e não administra.',
    icon: UserCog,
  },
};

export function RoleBadge({ role }: { role: UserRole }) {
  const meta = ROLE_META[role];
  const Icon = meta.icon;
  return (
    <Badge variant={role === 'admin' ? 'default' : 'outline'} title={meta.description}>
      <Icon aria-hidden="true" />
      {meta.label}
    </Badge>
  );
}
