// TODO: trocar o resto por import de @inno/contracts quando o Vega publicar
// (ARQUITETURA.md §4.3). `LeadMessageItem`/`MessageItem`/`MessageStatus`/
// `MessageDirection` já vêm de lá — publicados em paralelo a esta entrega
// (`packages/contracts/src/{lead,whatsapp,common}.contract.ts`, 2026-09-22).
// `import type` (não só `export type ... from`) porque `LeadMessageItem` é
// usado abaixo, dentro deste arquivo — um `export...from` puro não cria
// vínculo local (ES modules), só reexporta.
import type {
  BulkLeadsBody,
  BulkLeadsResponse,
  BulkLeadsSkippedItem,
  LeadBulkAction,
  LeadExportColumn,
  LeadMessageItem,
  LeadPageSize,
  MessageItem,
  MessageStatus,
  MessageDirection,
} from '@inno/contracts';
export { LEAD_EXPORT_COLUMNS, LEAD_PAGE_SIZES } from '@inno/contracts';
export type {
  BulkLeadsBody,
  BulkLeadsResponse,
  BulkLeadsSkippedItem,
  LeadBulkAction,
  LeadExportColumn,
  LeadMessageItem,
  LeadPageSize,
  MessageItem,
  MessageStatus,
  MessageDirection,
};

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
  /**
   * De qual busca este lead veio — SEMPRE presente (`Lead.searchJobId` é
   * obrigatório no schema; todo lead nasce de uma busca). Onda de 2026-09-23
   * (pedido do dono: "mostrar de qual busca/nicho eles são"). Confirmado
   * contra `packages/contracts/src/lead.contract.ts#leadListItemSchema`
   * (Vega) — `idSchema`, não `.nullable()`.
   */
  searchJobId: string;
  /** Nicho buscado na origem (`SearchJob.niche`) — é o texto que a UI mostra, não `searchJobId`. */
  searchNiche: string;
  /**
   * `true` quando a categoria real do lead diverge do nicho buscado — o Google
   * Maps devolve resultados geograficamente próximos, não só do nicho exato
   * (decisão do dono: nunca descartar, só marcar). Coluna persistida
   * (`Lead.offNiche`), recalculada a cada upsert do scraping — ver
   * `packages/core/src/leads/niche.ts#isOffNiche`.
   */
  offNiche: boolean;
};

export type LeadFacets = {
  byStatus: Partial<Record<LeadStatus, number>>;
  total: number;
};

/**
 * `page`/`pageSize`/`total`/`totalPages` no ENVELOPE (não dentro de `page` —
 * `page` aqui É o número da página, não um objeto de cursor). Contrato fixado
 * pelo Atlas em 2026-09-23 para `GET /leads` — substitui a paginação por
 * cursor usada até então (ver `PARA O PRÓXIMO` do handoff da Lyra daquele
 * dia). Só o `apps/web` sabe disto por ora: `@inno/contracts`/`lib/services/
 * leads.ts` ainda são cursor-based — o Vega está migrando em paralelo.
 */
export type LeadListResponse = {
  data: LeadListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
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
  /** `true` = só divergentes do nicho buscado; `false` = só aderentes; ausente = todos. */
  offNiche?: boolean;
  contactedInCampaign?: boolean;
  createdFrom?: string;
  createdTo?: string;
  sort?: string;
  /** Base 1 — default `1`. */
  page?: number;
  /** Default `25` — só `LEAD_PAGE_SIZES` (@inno/contracts), backend rejeita qualquer outro valor. */
  pageSize?: LeadPageSize;
};

export const PHONE_TYPE_LABEL: Record<PhoneType, string> = {
  mobile: 'Celular',
  landline: 'Fixo',
  unknown: 'Desconhecido',
};

/**
 * `LeadActivity.type` é texto livre no contrato (`z.string()`,
 * `packages/contracts/src/lead.contract.ts`) — o backend grava
 * `'opt_out'` (ver `lib/services/optouts.ts`/`lib/services/webhook.ts`,
 * território do Vega), enquanto esta tela padronizou `'opted_out'` desde a
 * 1ª rodada. As duas grafias precisam ser reconhecidas como o MESMO evento
 * aqui — nunca "corrigir" renomeando o dado real, só tolerar as duas na
 * leitura. Achado real (2026-09-23): sem isto, o selo de opt-out na linha do
 * tempo caía no fallback genérico (ícone neutro, texto cru "opt_out") em
 * qualquer lead descadastrado por resposta automática em produção.
 */
export function isOptOutActivity(type: string): boolean {
  return type === 'opted_out' || type === 'opt_out';
}

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'Novo',
  validated: 'Validado',
  contacted: 'Contatado',
  responded: 'Respondeu',
  negotiating: 'Negociando',
  won: 'Ganho',
  discarded: 'Descartado',
};
