import { Badge } from '@/components/ui/badge';

export function TemplateStatusBadge({ isActive }: { isActive: boolean }) {
  return <Badge variant={isActive ? 'success' : 'secondary'}>{isActive ? 'Ativo' : 'Inativo'}</Badge>;
}
