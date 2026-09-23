/**
 * @inno/core — regras de domínio puras, sem I/O de framework (sem Prisma,
 * sem Next). Ver ARQUITETURA.md §2/§3/§6.4/§6.7.
 */
export * from './leads/dedupe.js';
export * from './leads/niche.js';
export * from './leads/phone.js';
export * from './leads/status.js';
export * from './templates/render.js';
export * from './templates/spintax.js';
export * from './templates/optout-notice.js';
export * from './optout/detect.js';
export * from './optout/token.js';
export * from './locations/uf.js';
export * from './whatsapp/warmup.js';
export * from './whatsapp/health.js';
export * from './whatsapp/send-window.js';
export * from './whatsapp/send-guard.js';
