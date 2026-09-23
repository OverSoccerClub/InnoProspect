/**
 * lib/lead-filter-state.ts — estado da barra de filtros de `/leads`
 * (`components/leads/lead-filters.tsx`) e sua tradução para o `LeadFilter`
 * que a API espera. Fica fora do componente para poder ser testado sem React
 * — mesmo motivo de `lib/pagination.ts`.
 *
 * Contexto (pedido do dono, 2026-09-23): `leadFilterSchema`
 * (`@inno/contracts`) já aceita `hasWebsite`/`hasPhone`/`phoneType`/
 * `minRating`/`category`/`tags`/`createdFrom`/`createdTo` — o backend
 * responde a todos, mas a tela só expunha busca/UF/cidade/status/origem/
 * nicho. Este arquivo é a ponte para os 7 filtros que faltavam.
 *
 * Decisões de forma:
 * - Os filtros booleanos (`hasWebsite`/`hasPhone`/`offNiche`) usam string
 *   tri-state (`''|'true'|'false'`) porque um `<select>` nativo só fala
 *   string — mesma decisão já tomada para `offNiche` antes desta rodada.
 * - `category`/`tags` são texto livre separado por vírgula, não um
 *   multi-select com lista de valores conhecidos: `leadFilterSchema` aceita
 *   qualquer string nesses campos, e não existe endpoint de "categorias/tags
 *   distintas" hoje (`LeadFacets` só tem `byStatus`) — inventar um agora
 *   seria contrato novo, território do Vega. Ver PENDÊNCIAS do handoff.
 */
import type { LeadFilter, LeadStatus, PhoneType } from '@/types/lead';

export type TriState = '' | 'true' | 'false';
export type MinRatingOption = '' | '3' | '4' | '4.5';

export type LeadsFilterState = {
  q: string;
  status: LeadStatus[];
  uf: string;
  cityIbgeCode: string;
  /** id de `SearchJobSummary` (vazio = todas as buscas). */
  searchJobId: string;
  /** `''` = todos, `'true'` = só fora do nicho, `'false'` = só aderentes. */
  offNiche: TriState;
  /** `''` = todos, `'true'` = tem site, `'false'` = sem site. */
  hasWebsite: TriState;
  /** `''` = todos, `'true'` = tem telefone, `'false'` = sem telefone. */
  hasPhone: TriState;
  phoneType: '' | PhoneType;
  minRating: MinRatingOption;
  /** Texto livre separado por vírgula — ver nota do arquivo. */
  category: string;
  /** Texto livre separado por vírgula — ver nota do arquivo. */
  tags: string;
  /** `yyyy-mm-dd` (valor nativo de `<input type="date">`) ou `''`. */
  createdFrom: string;
  /** `yyyy-mm-dd` ou `''`. */
  createdTo: string;
};

export const EMPTY_LEADS_FILTER: LeadsFilterState = {
  q: '',
  status: [],
  uf: '',
  cityIbgeCode: '',
  searchJobId: '',
  offNiche: '',
  hasWebsite: '',
  hasPhone: '',
  phoneType: '',
  minRating: '',
  category: '',
  tags: '',
  createdFrom: '',
  createdTo: '',
};

/** Campos que ficam dentro do painel "Mais filtros" — usado só para contar o badge. */
const ADVANCED_KEYS = [
  'searchJobId',
  'offNiche',
  'hasWebsite',
  'hasPhone',
  'phoneType',
  'minRating',
  'category',
  'tags',
  'createdFrom',
  'createdTo',
] as const satisfies ReadonlyArray<keyof LeadsFilterState>;

function isFieldActive(value: LeadsFilterState[keyof LeadsFilterState]): boolean {
  return Array.isArray(value) ? value.length > 0 : value !== '';
}

export function hasAnyLeadFilter(state: LeadsFilterState): boolean {
  return (Object.keys(EMPTY_LEADS_FILTER) as Array<keyof LeadsFilterState>).some((key) => isFieldActive(state[key]));
}

/** Quantos filtros do painel "Mais filtros" estão ativos agora — vira o número do badge no gatilho do painel. */
export function countAdvancedLeadFilters(state: LeadsFilterState): number {
  return ADVANCED_KEYS.filter((key) => isFieldActive(state[key])).length;
}

function parseCsvList(raw: string): string[] | undefined {
  const items = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function triToBool(value: TriState): boolean | undefined {
  return value === '' ? undefined : value === 'true';
}

/**
 * Fim do dia em UTC (23:59:59.999Z) para `createdTo` — sem isso, filtrar
 * "até 20/09" excluiria o próprio dia 20 (a API usa `lte`, comparando contra
 * `T00:00:00.000Z`). Ambos os limites em UTC porque as colunas de data do
 * banco são `TIMESTAMP` sem fuso, já armazenadas em UTC — não há fuso do
 * operador para converter aqui.
 */
export function toApiLeadFilter(state: LeadsFilterState): Omit<LeadFilter, 'page' | 'pageSize' | 'sort'> {
  return {
    q: state.q.trim() || undefined,
    status: state.status.length > 0 ? state.status : undefined,
    uf: state.uf ? [state.uf] : undefined,
    cityIbgeCode: state.cityIbgeCode ? [state.cityIbgeCode] : undefined,
    searchJobId: state.searchJobId || undefined,
    offNiche: triToBool(state.offNiche),
    hasWebsite: triToBool(state.hasWebsite),
    hasPhone: triToBool(state.hasPhone),
    phoneType: state.phoneType || undefined,
    minRating: state.minRating === '' ? undefined : Number(state.minRating),
    category: parseCsvList(state.category),
    tags: parseCsvList(state.tags),
    createdFrom: state.createdFrom ? `${state.createdFrom}T00:00:00.000Z` : undefined,
    createdTo: state.createdTo ? `${state.createdTo}T23:59:59.999Z` : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Chips de filtro ativo — requisito do dono: "com 13 filtros possíveis, 'por
// que essa lista está vazia?' vira a pergunta mais frequente". Cada chip sabe
// se rótulo mostrar E como se remover sozinho, sem o resto do form saber
// disso.
// ─────────────────────────────────────────────────────────────────────────

export type ActiveLeadFilterChip = {
  /** Chave estável para `key` de lista em React e para `removeLeadFilterChip`. */
  key: string;
  label: string;
};

const MIN_RATING_LABEL: Record<Exclude<MinRatingOption, ''>, string> = {
  '3': '3+ estrelas',
  '4': '4+ estrelas',
  '4.5': '4,5+ estrelas',
};

function formatDateBR(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  if (!year || !month || !day) return isoDate;
  return `${day}/${month}/${year}`;
}

/**
 * `statusLabel`/`ufLabel`/`cityLabel`/`searchJobLabel`/`phoneTypeLabel` são
 * lookups opcionais — quando o componente já tem o nome legível à mão (ex.:
 * nome do município, nome da busca de origem), o chip mostra o nome; sem eles,
 * cai no valor bruto (nunca quebra por falta de dado auxiliar).
 */
export function describeActiveLeadFilters(
  state: LeadsFilterState,
  labels: {
    statusLabel?: (status: LeadStatus) => string;
    cityLabel?: string;
    searchJobLabel?: string;
    phoneTypeLabel?: (type: PhoneType) => string;
  } = {},
): ActiveLeadFilterChip[] {
  const chips: ActiveLeadFilterChip[] = [];

  if (state.q.trim()) chips.push({ key: 'q', label: `Busca: "${state.q.trim()}"` });
  for (const status of state.status) {
    chips.push({ key: `status:${status}`, label: labels.statusLabel?.(status) ?? status });
  }
  if (state.uf) chips.push({ key: 'uf', label: `UF: ${state.uf}` });
  if (state.cityIbgeCode) chips.push({ key: 'cityIbgeCode', label: `Cidade: ${labels.cityLabel ?? state.cityIbgeCode}` });
  if (state.searchJobId) chips.push({ key: 'searchJobId', label: `Busca de origem: ${labels.searchJobLabel ?? state.searchJobId}` });
  if (state.offNiche) chips.push({ key: 'offNiche', label: state.offNiche === 'true' ? 'Fora do nicho buscado' : 'Aderente ao nicho buscado' });
  if (state.hasWebsite) chips.push({ key: 'hasWebsite', label: state.hasWebsite === 'true' ? 'Tem site' : 'Sem site' });
  if (state.hasPhone) chips.push({ key: 'hasPhone', label: state.hasPhone === 'true' ? 'Tem telefone' : 'Sem telefone' });
  if (state.phoneType) chips.push({ key: 'phoneType', label: `Telefone: ${labels.phoneTypeLabel?.(state.phoneType) ?? state.phoneType}` });
  if (state.minRating) chips.push({ key: 'minRating', label: MIN_RATING_LABEL[state.minRating] });
  if (state.category.trim()) chips.push({ key: 'category', label: `Categoria: ${state.category.trim()}` });
  if (state.tags.trim()) chips.push({ key: 'tags', label: `Tags: ${state.tags.trim()}` });
  if (state.createdFrom) chips.push({ key: 'createdFrom', label: `Criados de ${formatDateBR(state.createdFrom)}` });
  if (state.createdTo) chips.push({ key: 'createdTo', label: `Criados até ${formatDateBR(state.createdTo)}` });

  return chips;
}

/** Remove só o que aquele chip representa — `uf` também limpa `cityIbgeCode` (cidade depende de UF). */
export function removeLeadFilterChip(state: LeadsFilterState, key: string): LeadsFilterState {
  if (key.startsWith('status:')) {
    const status = key.slice('status:'.length) as LeadStatus;
    return { ...state, status: state.status.filter((s) => s !== status) };
  }
  switch (key) {
    case 'q':
      return { ...state, q: '' };
    case 'uf':
      return { ...state, uf: '', cityIbgeCode: '' };
    case 'cityIbgeCode':
      return { ...state, cityIbgeCode: '' };
    case 'searchJobId':
      return { ...state, searchJobId: '' };
    case 'offNiche':
      return { ...state, offNiche: '' };
    case 'hasWebsite':
      return { ...state, hasWebsite: '' };
    case 'hasPhone':
      return { ...state, hasPhone: '' };
    case 'phoneType':
      return { ...state, phoneType: '' };
    case 'minRating':
      return { ...state, minRating: '' };
    case 'category':
      return { ...state, category: '' };
    case 'tags':
      return { ...state, tags: '' };
    case 'createdFrom':
      return { ...state, createdFrom: '' };
    case 'createdTo':
      return { ...state, createdTo: '' };
    default:
      return state;
  }
}
