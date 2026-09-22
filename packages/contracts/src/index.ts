/**
 * @inno/contracts — FONTE ÚNICA DA VERDADE de contratos de API (Zod + tipos
 * inferidos). Ver ARQUITETURA.md §4. `apps/web` e `apps/worker` importam
 * daqui — nunca duplicar um schema de request/response em outro lugar.
 */
export * from './common.js';
export * from './search.contract.js';
export * from './lead.contract.js';
export * from './template.contract.js';
export * from './campaign.contract.js';
export * from './whatsapp.contract.js';
export * from './optout.contract.js';
export * from './webhook.contract.js';
export * from './dashboard.contract.js';
