// Fonte da verdade: @inno/contracts (ARQUITETURA.md §4.6), publicado pelo
// Vega em paralelo a esta entrega. Reexporta com os nomes já usados em
// lib/api/whatsapp.ts, mocks/whatsapp.ts e nos componentes desta pasta.
export type {
  InstanceHealth,
  WhatsAppInstanceStatus as InstanceConnectionStatus,
  WhatsAppInstanceItem as InstanceListItem,
  CreateWhatsAppInstanceBody as CreateInstanceRequest,
  CreateWhatsAppInstanceResponse as CreateInstanceResponse,
  GetQrCodeResponse as InstanceQrResponse,
  ConnectInstanceResponse,
  DisconnectInstanceResponse,
} from '@inno/contracts';
