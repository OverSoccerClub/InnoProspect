// Fonte da verdade: @inno/contracts (ARQUITETURA.md §4.6), publicado pelo
// Vega em paralelo a esta entrega. Reexporta com os nomes já usados em
// lib/api/whatsapp.ts, mocks/whatsapp.ts e nos componentes desta pasta.
import type { WhatsAppInstanceItem } from '@inno/contracts';

export type {
  InstanceHealth,
  WhatsAppInstanceStatus as InstanceConnectionStatus,
  WhatsAppInstanceItem as InstanceListItem,
  CreateWhatsAppInstanceBody as CreateInstanceRequest,
  CreateWhatsAppInstanceResponse as CreateInstanceResponse,
  GetQrCodeResponse as InstanceQrResponse,
  GetInstanceStatusResponse as InstanceStatusResponse,
  ConnectInstanceResponse,
  DisconnectInstanceResponse,
} from '@inno/contracts';

/**
 * Resultado de "Verificar agora" (`POST /whatsapp/instances/reconcile`).
 * Não é só a lista: `unconfirmed` é quantas instâncias desta rodada não
 * puderam ser confirmadas contra a Evolution. A rota devolve `200` mesmo
 * assim (a reconciliação nunca quebra a leitura), então é este número — e
 * não um código HTTP — que autoriza a tela a dizer "confirmei".
 */
export type ReconcileInstancesResult = {
  instances: WhatsAppInstanceItem[];
  unconfirmed: number;
};
