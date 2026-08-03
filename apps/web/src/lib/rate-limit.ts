/**
 * lib/rate-limit.ts — limitador de taxa em memória (por processo), usado por
 * `apiRoute({ rateLimit })` nas rotas PÚBLICAS de maior exposição: webhook da
 * Evolution API e opt-out público. Existe para dois achados da revisão de
 * 2026-08-03 (REVISAO-ARQUITETURA/REVISAO-QA, achado do Órion):
 *   1. ARQUITETURA §4.7 já definia "Rate limit: 10 req/min por IP" para
 *      `POST /api/v1/public/optout` e isso nunca foi implementado.
 *   2. `lib/api-handler.ts` fazia `req.text()` + `JSON.parse` e (no webhook)
 *      uma consulta ao Postgres para validar `instanceKey`/`apikey` ANTES de
 *      qualquer limite — uma rota sem sessão paga o custo total por
 *      requisição anônima, mesmo malformada. O rate limit roda como o
 *      PRIMEIRO passo de `apiRoute` (antes de sessão/parsing), exatamente
 *      para cortar esse custo cedo.
 *
 * Limitação conhecida (documentar, não esconder): o contador vive na memória
 * do processo Node — em deploy com múltiplas réplicas de `apps/web`, cada
 * réplica tem seu próprio contador (o limite efetivo multiplica pelo nº de
 * réplicas). Aceitável hoje (EasyPanel roda 1 réplica de `apps/web`,
 * `DEPLOY.md`). Se isso mudar, trocar por contador em Redis (`INCR`+`EXPIRE`
 * na mesma conexão de `lib/queue.ts`) — a interface `checkRateLimit` abaixo já
 * isola o chamador dessa troca futura, e a assinatura (`key`, `windowMs`,
 * `max`) foi desenhada para mapear 1:1 num `INCR`/`PEXPIRE` do Redis.
 */
import type { NextRequest } from 'next/server';

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Varredura periódica para não deixar o Map crescer sem limite (chaves de IPs que pararam de bater). */
let sweepStarted = false;
function ensureSweep(): void {
  if (sweepStarted) return;
  sweepStarted = true;
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, 60_000);
  interval.unref?.();
}

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterMs: number };

/**
 * Janela fixa (fixed window counter) — simples e suficiente aqui: isto não é
 * defesa anti-DDoS de borda (isso é responsabilidade de infra/CDN), é
 * limitador de ABUSO/CUSTO para uma rota específica sem sessão.
 */
export function checkRateLimit(key: string, windowMs: number, max: number): RateLimitResult {
  ensureSweep();
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (existing.count >= max) {
    return { allowed: false, retryAfterMs: existing.resetAt - now };
  }

  existing.count += 1;
  return { allowed: true };
}

/**
 * IP do cliente a partir de `X-Forwarded-For`/`X-Real-Ip` (EasyPanel roda
 * atrás de proxy reverso que preenche esses headers — `NextRequest` não tem
 * mais `.ip` em deploy self-hosted). ⚠️ Não validado nesta máquina contra o
 * proxy real do EasyPanel (sem ambiente de produção disponível aqui) — se o
 * proxy não sobrescrever `X-Forwarded-For` de requisições externas, um
 * cliente malicioso pode forjar o header e obter um contador novo por
 * requisição. Assunção documentada, não uma garantia; Órion deve confirmar
 * a configuração do proxy antes do deploy contar com isto como defesa forte.
 */
export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}
