/**
 * lib/evolution.ts — singleton do `EvolutionClient` (`@inno/messaging`) +
 * helpers de configuração usados pelas rotas de `whatsapp/instances` e pelo
 * webhook (ARQUITETURA §4.6/§4.8). Mesmo padrão de singleton de
 * `lib/queue.ts` (reaproveita a instância entre chamadas de rota no mesmo
 * processo Next.js).
 */
import { randomBytes } from 'node:crypto';
import { EvolutionClient, evolutionConfigFromEnv } from '@inno/messaging';

let client: EvolutionClient | null = null;

/** Lança `MessagingError('VALIDATION_ERROR', ...)` se `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` faltarem — a rota chamadora traduz isso para `502 UPSTREAM_ERROR` (erro de configuração de infra, não do usuário). */
export function getEvolutionClient(): EvolutionClient {
  if (!client) {
    client = new EvolutionClient(evolutionConfigFromEnv());
  }
  return client;
}

/**
 * Segredo por instância usado no path `/api/webhooks/evolution/:instanceKey`
 * (ARQUITETURA §4.8) — GERADO POR NÓS, não é o nome da instância nem
 * `EVOLUTION_API_KEY`. 32 bytes aleatórios em hex (64 chars): espaço grande o
 * suficiente para não ser adivinhável por força bruta, e hex evita qualquer
 * problema de caractere especial em path de URL.
 */
export function generateInstanceKey(): string {
  return randomBytes(32).toString('hex');
}

/** `evolutionInstanceName` — nome da instância dentro do container Evolution. Único: prefixo do nome amigável (para depuração) + sufixo aleatório (para nunca colidir mesmo com 2 instâncias de mesmo nome). */
export function generateEvolutionInstanceName(friendlyName: string): string {
  const slug = friendlyName
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = randomBytes(4).toString('hex');
  return `${slug || 'instancia'}-${suffix}`;
}

/** URL completa de webhook por instância — `{EVOLUTION_WEBHOOK_BASE_URL}/:instanceKey` (ARQUITETURA §4.8/§10). */
export function buildWebhookUrl(instanceKey: string): string {
  const base = (process.env.EVOLUTION_WEBHOOK_BASE_URL ?? '').replace(/\/+$/, '');
  return `${base}/${instanceKey}`;
}
