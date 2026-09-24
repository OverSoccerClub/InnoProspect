// Fonte da verdade: @inno/contracts (ARQUITETURA.md §4.5), publicado pelo
// Vega em paralelo a esta entrega. Reexporta com os nomes já usados em
// lib/api/campaigns.ts, mocks/campaigns.ts e nos componentes desta pasta —
// mesma convenção de types/whatsapp.ts e types/template.ts.
//
// Histórico do gap (contexto para não reabrir a mesma dúvida): quando esta
// tela começou, `campaign.contract.ts` só tinha 5 motivos de exclusão e as 4
// ações (start/pause/resume/cancel) — sem `alreadyTargeted`, sem `PATCH`,
// sem envio manual por alvo. O Vega publicou os três em paralelo, no mesmo
// dia, e o arquivo hoje já tem tudo isto:
// - `alreadyTargeted` (6º motivo, `campaignAudienceExcludedSchema`).
// - `PATCH /campaigns/:id` (`patchCampaignBodySchema`) — NÃO consumido por
//   esta tela ainda (fora do escopo dos 5 requisitos desta rodada: editar
//   nome/template/instâncias/audiência de um rascunho). Ver PENDÊNCIAS.
// - `POST /campaigns/:id/targets/:targetId/send` — o disparo MANUAL,
//   alvo-a-alvo, que EXISTE nesta rodada por não haver motor automático
//   ainda (Fase 4.F). É como o operador "aperta o play" — consumido por
//   `components/campaigns/campaign-targets-table.tsx`.
// Ainda NÃO existe: `POST /campaigns/preview` (dry-run sem criar rascunho) —
// a tela faz a prévia de audiência 100% client-side contra os leads
// carregados em memória (`lib/campaign-audience.ts`), documentadamente
// incapaz de saber `alreadyTargeted` antes de criar de verdade.
export type {
  CampaignStatus,
  CampaignTargetStatus,
  CampaignAudienceInput,
  SendWindow,
  JitterSeconds,
  CampaignSettingsInput,
  CreateCampaignBody as CreateCampaignRequest,
  CampaignSettings,
  CampaignAudienceExcluded,
  CampaignAudienceSummary,
  CampaignEstimate,
  CreateCampaignResponse,
  CampaignStats,
  CampaignRates,
  CampaignSummary,
  ListCampaignsQuery,
  CampaignInstanceProgress,
  CampaignDetail,
  CampaignTargetItem,
  ListCampaignTargetsQuery,
  CampaignAction,
  ResumeCampaignBody as ResumeCampaignRequest,
  StartCampaignResponse,
  PauseCampaignResponse,
  ResumeCampaignResponse,
  CancelCampaignResponse,
  SendCampaignTargetBody as SendCampaignTargetRequest,
  SendCampaignTargetResponse,
} from '@inno/contracts';
