// TODO: trocar o resto por import de @inno/contracts quando o Vega publicar
// (ARQUITETURA.md §4.3). `LeadMessageItem`/`MessageItem`/`MessageStatus`/
// `MessageDirection` já vêm de lá — publicados em paralelo a esta entrega
// (`packages/contracts/src/{lead,whatsapp,common}.contract.ts`, 2026-09-22).
// `import type` (não só `export type ... from`) porque `LeadMessageItem` é
// usado abaixo, dentro deste arquivo — um `export...from` puro não cria
// vínculo local (ES modules), só reexporta.
import type { LeadMessageItem, MessageItem, MessageStatus, MessageDirection } from '@inno/contracts';
export type { LeadMessageItem, MessageItem, MessageStatus, MessageDirection };

export type LeadStatus =
  | 'new'
  | 'validated'
  | 'contacted'
  | 'responded'
  | 'negotiating'
  | 'won'
  | 'discarded';

export type PhoneType = 'mobile' | 'landline' | 'unknown';

export type LeadListItem = {
  id: string;
  name: string;
  phoneE164: string | null;
  phoneType: PhoneType;
  address: string | null;
  city: string | null;
  uf: string | null;
  website: string | null;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  status: LeadStatus;
  tags: string[];
  isOptedOut: boolean;
  lastContactedAt: string | null;
  createdAt: string;
};

export type LeadFacets = {
  byStatus: Partial<Record<LeadStatus, number>>;
  total: number;
};

export type LeadListResponse = {
  data: LeadListItem[];
  page: { cursor: string | null; nextCursor: string | null; limit: number; total: number };
  facets: LeadFacets;
};

export type LeadActivityType =
  | 'status_changed'
  | 'note_added'
  | 'tags_added'
  | 'tags_removed'
  | 'message_sent'
  | 'message_failed'
  | 'message_received'
  | 'opted_out'
  | 'created';

export type LeadActivity = {
  id: string;
  leadId: string;
  type: LeadActivityType;
  payload: Record<string, unknown> | null;
  actor: 'user' | 'system' | 'lead';
  createdAt: string;
};

export type LeadDetail = LeadListItem & {
  notes: string | null;
  latitude: number | null;
  longitude: number | null;
  source: { type: string; url: string | null; collectedAt: string; searchJobId: string | null };
  firstSeenAt: string;
  lastSeenAt: string;
  activities: LeadActivity[];
  messages: LeadMessageItem[];
};

export type LeadFilter = {
  q?: string;
  status?: LeadStatus[];
  uf?: string[];
  cityIbgeCode?: string[];
  category?: string[];
  searchJobId?: string;
  hasWebsite?: boolean;
  hasPhone?: boolean;
  phoneType?: PhoneType;
  minRating?: number;
  tags?: string[];
  optedOut?: boolean;
  contactedInCampaign?: boolean;
  createdFrom?: string;
  createdTo?: string;
  sort?: string;
  cursor?: string;
  limit?: number;
};

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'Novo',
  validated: 'Validado',
  contacted: 'Contatado',
  responded: 'Respondeu',
  negotiating: 'Negociando',
  won: 'Ganho',
  discarded: 'Descartado',
};
