import { Badge } from '@/components/ui/badge';
import { LEAD_STATUS_LABEL, type LeadStatus } from '@/types/lead';

const VARIANT: Record<LeadStatus, 'default' | 'secondary' | 'success' | 'destructive' | 'warning' | 'outline'> = {
  new: 'secondary',
  validated: 'outline',
  contacted: 'default',
  responded: 'warning',
  negotiating: 'warning',
  won: 'success',
  discarded: 'destructive',
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return <Badge variant={VARIANT[status]}>{LEAD_STATUS_LABEL[status]}</Badge>;
}
