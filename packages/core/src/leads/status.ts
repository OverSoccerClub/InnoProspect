/**
 * leads/status.ts — máquina de estados do funil de Lead. Ver ARQUITETURA
 * §3.2 regra 2: transições ilegais são rejeitadas AQUI, não no frontend
 * (Lyra só reflete o que este módulo permite) nem no banco (Prisma só guarda
 * o enum, não a sequência).
 *
 * `new → validated → contacted → responded → negotiating → won`, e de
 * qualquer estado, `→ discarded`. `contacted` e `responded` são setados
 * pelo sistema (worker de disparo / webhook da Evolution) — o resto
 * (`validated`, `negotiating`, `won`, `discarded`) é humano, via
 * `PATCH /api/v1/leads/:id`.
 */

/** Ordem linear do funil — não inclui `discarded`, que é alcançável de qualquer ponto. */
export const LEAD_FUNNEL_ORDER = [
  'new',
  'validated',
  'contacted',
  'responded',
  'negotiating',
  'won',
] as const;
export type LeadFunnelStatus = (typeof LEAD_FUNNEL_ORDER)[number];

export const LEAD_STATUSES = [...LEAD_FUNNEL_ORDER, 'discarded'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/**
 * Estados que só o sistema pode setar (worker de disparo ao enviar =
 * `contacted`; webhook da Evolution ao receber resposta = `responded`).
 * Um `PATCH` humano tentando setar um destes é rejeitado mesmo que a
 * transição seja legal na sequência — ver `actor` em `checkStatusTransition`.
 */
export const SYSTEM_ONLY_STATUSES: ReadonlySet<LeadStatus> = new Set(['contacted', 'responded']);

export type TransitionActor = 'human' | 'system';

export type StatusTransitionResult =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Verifica se `from → to` é uma transição legal do funil, para o `actor`
 * informado (default `'human'`, o caso de `PATCH /leads/:id`). Pura — sem
 * I/O, sem acesso a banco. `reason` já vem pronta para virar
 * `details[0].message` no `422 INVALID_STATUS_TRANSITION` (ARQUITETURA §4.3).
 */
export function checkStatusTransition(
  from: LeadStatus,
  to: LeadStatus,
  actor: TransitionActor = 'human',
): StatusTransitionResult {
  if (from === to) {
    return { allowed: false, reason: `o lead já está em '${to}'` };
  }

  if (to === 'discarded') {
    // "de qualquer estado, → discarded" (ARQUITETURA §3.2) — sem restrição
    // adicional de ator: tanto operador quanto uma regra automática podem
    // descartar um lead.
    return { allowed: true };
  }

  if (from === 'discarded') {
    return { allowed: false, reason: `não é possível sair de 'discarded'` };
  }

  const fromIndex = LEAD_FUNNEL_ORDER.indexOf(from as LeadFunnelStatus);
  const toIndex = LEAD_FUNNEL_ORDER.indexOf(to as LeadFunnelStatus);

  if (toIndex !== fromIndex + 1) {
    return { allowed: false, reason: `não é possível ir de '${from}' para '${to}'` };
  }

  if (actor === 'human' && SYSTEM_ONLY_STATUSES.has(to)) {
    return {
      allowed: false,
      reason: `'${to}' é definido automaticamente pelo sistema e não pode ser setado manualmente`,
    };
  }

  return { allowed: true };
}

/** Igual a `checkStatusTransition`, mas lança — útil fora de uma rota HTTP (ex.: worker). */
export function assertStatusTransition(
  from: LeadStatus,
  to: LeadStatus,
  actor: TransitionActor = 'human',
): void {
  const result = checkStatusTransition(from, to, actor);
  if (!result.allowed) {
    throw new Error(result.reason);
  }
}
