// TODO: trocar por import de @inno/contracts quando o Vega publicar (ARQUITETURA.md §4.3)

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
  | 'message_sent'
  | 'message_received'
  | 'opted_out'
  | 'created';

export type LeadActivity = {
  id: string;
  leadId: string;
  type: LeadActivityType;
  payload: Record<string, unknown>;
  actor: 'user' | 'system' | 'lead';
  createdAt: string;
};

export type MessageItem = {
  id: string;
  direction: 'outbound' | 'inbound';
  body: string;
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
};

export type LeadDetail = LeadListItem & {
  notes: string | null;
  latitude: number | null;
  longitude: number | null;
  source: { type: string; url: string | null; collectedAt: string; searchJobId: string | null };
  firstSeenAt: string;
  lastSeenAt: string;
  activities: LeadActivity[];
  messages: MessageItem[];
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
