import { describe, expect, it } from 'vitest';
import { evaluateSendGuard, OPT_OUT_MAX_AGE_MS, StaleOptOutCheckError, type SendGuardFacts } from './send-guard';
import { DEFAULT_SEND_WINDOW_CONFIG } from './send-window';

/** 2026-09-22 10:00 America/Sao_Paulo (terça, dentro do piso duro E da janela comercial, fora do almoço) = 13:00 UTC. */
const NOW = new Date('2026-09-22T13:00:00.000Z');

/**
 * Facts de um envio "tudo certo": celular, instância conectada com cota
 * sobrando, opt-out fresco e inexistente, sem duplo-clique, conversa já em
 * andamento (não é 1º contato frio, então G10 não se aplica). Cada teste
 * sobrescreve só o campo que quer exercitar.
 */
function baseFacts(overrides: Partial<SendGuardFacts> = {}): SendGuardFacts {
  return {
    now: NOW,
    phone: { e164: '+5511987654321', type: 'mobile' },
    instance: { status: 'connected', isDegraded: false, warmupDay: 22, dailyLimitOverride: null },
    quota: { sentToday: 0 },
    optOut: { exists: false, checkedAt: NOW },
    lastOutboundAt: null,
    isColdFirstContact: false,
    text: 'Oi! Só confirmando o horário de amanhã.',
    companyName: 'Innova Prospect',
    overrides: { allowNonMobile: false, confirmOutsideBusinessWindow: false },
    ...overrides,
  };
}

describe('evaluateSendGuard — carimbo do opt-out (guarda de runtime, não de disciplina)', () => {
  it('lança StaleOptOutCheckError quando checkedAt tem mais de 5s', () => {
    const staleCheckedAt = new Date(NOW.getTime() - (OPT_OUT_MAX_AGE_MS + 1));
    expect(() => evaluateSendGuard(baseFacts({ optOut: { exists: false, checkedAt: staleCheckedAt } }))).toThrow(
      StaleOptOutCheckError,
    );
  });

  it('NÃO lança quando checkedAt está dentro dos 5s', () => {
    const freshCheckedAt = new Date(NOW.getTime() - 2_000);
    expect(() => evaluateSendGuard(baseFacts({ optOut: { exists: false, checkedAt: freshCheckedAt } }))).not.toThrow();
  });

  it('carimbo EXATAMENTE no limite (5000ms) ainda passa — só lança acima disso', () => {
    const atLimit = new Date(NOW.getTime() - OPT_OUT_MAX_AGE_MS);
    expect(() => evaluateSendGuard(baseFacts({ optOut: { exists: false, checkedAt: atLimit } }))).not.toThrow();
  });
});

describe('evaluateSendGuard — G11 opt-out (o portão inegociável)', () => {
  it('bloqueia com OPTED_OUT quando o telefone está na blacklist — e isto vem ANTES de qualquer escrita, pois evaluateSendGuard é puro/síncrono e não escreve nada', () => {
    const verdict = evaluateSendGuard(baseFacts({ optOut: { exists: true, checkedAt: NOW } }));
    expect(verdict.allow).toBe(false);
    if (!verdict.allow) expect(verdict.reason).toBe('OPTED_OUT');
  });

  it('opt-out vence mesmo se todos os outros gates estivessem OK', () => {
    const verdict = evaluateSendGuard(
      baseFacts({ optOut: { exists: true, checkedAt: NOW }, instance: { status: 'connected', isDegraded: false, warmupDay: 22, dailyLimitOverride: null } }),
    );
    expect(verdict.allow).toBe(false);
  });
});

describe('evaluateSendGuard — G4 celular', () => {
  it('bloqueia LEAD_NOT_MOBILE para telefone fixo sem confirmação', () => {
    const verdict = evaluateSendGuard(baseFacts({ phone: { e164: '+551133334444', type: 'landline' } }));
    expect(verdict.allow).toBe(false);
    if (!verdict.allow) expect(verdict.reason).toBe('LEAD_NOT_MOBILE');
  });

  it('permite fixo COM allowNonMobile, mas adiciona warning', () => {
    const verdict = evaluateSendGuard(
      baseFacts({ phone: { e164: '+551133334444', type: 'landline' }, overrides: { allowNonMobile: true, confirmOutsideBusinessWindow: false } }),
    );
    expect(verdict.allow).toBe(true);
    if (verdict.allow) expect(verdict.warnings.map((w) => w.code)).toContain('NON_MOBILE_CONFIRMED');
  });
});

describe('evaluateSendGuard — G5/G6 janela de envio', () => {
  it('bloqueia QUIET_HOURS fora do piso duro (22h)', () => {
    const lateNight = new Date('2026-09-23T01:00:00.000Z'); // 22:00 em SP
    const verdict = evaluateSendGuard(baseFacts({ now: lateNight, optOut: { exists: false, checkedAt: lateNight } }));
    expect(verdict.allow).toBe(false);
    if (!verdict.allow) expect(verdict.reason).toBe('QUIET_HOURS');
  });

  it('bloqueia QUIET_HOURS no domingo, mesmo em horário comercial', () => {
    const sunday10am = new Date('2026-09-20T13:00:00.000Z'); // domingo, 10h em SP
    const verdict = evaluateSendGuard(baseFacts({ now: sunday10am, optOut: { exists: false, checkedAt: sunday10am } }));
    expect(verdict.allow).toBe(false);
    if (!verdict.allow) expect(verdict.reason).toBe('QUIET_HOURS');
  });

  it('QUIET_HOURS não tem override possível — confirmar as duas flags não muda o resultado', () => {
    const lateNight = new Date('2026-09-23T01:00:00.000Z');
    const verdict = evaluateSendGuard(
      baseFacts({
        now: lateNight,
        optOut: { exists: false, checkedAt: lateNight },
        overrides: { allowNonMobile: true, confirmOutsideBusinessWindow: true },
      }),
    );
    expect(verdict.allow).toBe(false);
  });

  it('bloqueia OUTSIDE_BUSINESS_WINDOW no sábado sem confirmação (dentro do piso duro)', () => {
    const saturday10am = new Date('2026-09-19T13:00:00.000Z');
    const verdict = evaluateSendGuard(baseFacts({ now: saturday10am, optOut: { exists: false, checkedAt: saturday10am } }));
    expect(verdict.allow).toBe(false);
    if (!verdict.allow) expect(verdict.reason).toBe('OUTSIDE_BUSINESS_WINDOW');
  });

  it('permite sábado COM confirmOutsideBusinessWindow, e avisa', () => {
    const saturday10am = new Date('2026-09-19T13:00:00.000Z');
    const verdict = evaluateSendGuard(
      baseFacts({
        now: saturday10am,
        optOut: { exists: false, checkedAt: saturday10am },
        overrides: { allowNonMobile: false, confirmOutsideBusinessWindow: true },
      }),
    );
    expect(verdict.allow).toBe(true);
    if (verdict.allow) expect(verdict.warnings.map((w) => w.code)).toContain('OUTSIDE_BUSINESS_WINDOW_CONFIRMED');
  });
});

describe('evaluateSendGuard — G7 instância', () => {
  it('bloqueia INSTANCE_NOT_CONNECTED quando status !== connected', () => {
    const verdict = evaluateSendGuard(baseFacts({ instance: { status: 'disconnected', isDegraded: false, warmupDay: 22, dailyLimitOverride: null } }));
    expect(verdict.allow).toBe(false);
    if (!verdict.allow) expect(verdict.reason).toBe('INSTANCE_NOT_CONNECTED');
  });

  it('bloqueia INSTANCE_BANNED quando status === banned (reason específico, não genérico)', () => {
    const verdict = evaluateSendGuard(baseFacts({ instance: { status: 'banned', isDegraded: false, warmupDay: 22, dailyLimitOverride: null } }));
    expect(verdict.allow).toBe(false);
    if (!verdict.allow) expect(verdict.reason).toBe('INSTANCE_BANNED');
  });
});

describe('evaluateSendGuard — G8 cota diária do warmup', () => {
  it('bloqueia DAILY_LIMIT_REACHED quando sentToday atingiu o teto do dia', () => {
    // dia 1 de warmup → teto 20 (packages/core/src/whatsapp/warmup.ts)
    const verdict = evaluateSendGuard(
      baseFacts({ instance: { status: 'connected', isDegraded: false, warmupDay: 1, dailyLimitOverride: null }, quota: { sentToday: 20 } }),
    );
    expect(verdict.allow).toBe(false);
    if (!verdict.allow) {
      expect(verdict.reason).toBe('DAILY_LIMIT_REACHED');
      expect(verdict.meta).toMatchObject({ dailyLimit: 20, sentToday: 20 });
    }
  });

  it('avisa LOW_QUOTA_REMAINING quando resta <=10% do teto, mas ainda permite', () => {
    const verdict = evaluateSendGuard(
      baseFacts({ instance: { status: 'connected', isDegraded: false, warmupDay: 1, dailyLimitOverride: null }, quota: { sentToday: 19 } }),
    );
    expect(verdict.allow).toBe(true);
    if (verdict.allow) expect(verdict.warnings.map((w) => w.code)).toContain('LOW_QUOTA_REMAINING');
  });

  it('respeita dailyLimitOverride quando ele REDUZ o teto', () => {
    const verdict = evaluateSendGuard(
      baseFacts({ instance: { status: 'connected', isDegraded: false, warmupDay: 22, dailyLimitOverride: 5 }, quota: { sentToday: 5 } }),
    );
    expect(verdict.allow).toBe(false);
    if (!verdict.allow) expect(verdict.reason).toBe('DAILY_LIMIT_REACHED');
  });
});

describe('evaluateSendGuard — G9 anti-duplo-clique', () => {
  it('bloqueia DUPLICATE_SEND quando o último outbound foi há menos de 60s', () => {
    const verdict = evaluateSendGuard(baseFacts({ lastOutboundAt: new Date(NOW.getTime() - 10_000) }));
    expect(verdict.allow).toBe(false);
    if (!verdict.allow) expect(verdict.reason).toBe('DUPLICATE_SEND');
  });

  it('permite quando o último outbound foi há mais de 60s', () => {
    const verdict = evaluateSendGuard(baseFacts({ lastOutboundAt: new Date(NOW.getTime() - 61_000) }));
    expect(verdict.allow).toBe(true);
  });

  it('janela de duplicidade é configurável via options.duplicateWindowMs', () => {
    const verdict = evaluateSendGuard(baseFacts({ lastOutboundAt: new Date(NOW.getTime() - 5_000) }), { duplicateWindowMs: 2_000 });
    expect(verdict.allow).toBe(true);
  });
});

describe('evaluateSendGuard — G10 1º contato frio (conteúdo obrigatório, ARQUITETURA §7.4)', () => {
  it('bloqueia MISSING_OPTOUT_NOTICE quando o texto não tem instrução de descadastro', () => {
    const verdict = evaluateSendGuard(baseFacts({ isColdFirstContact: true, text: 'Olá! Sou da Innova Prospect, tudo bem?' }));
    expect(verdict.allow).toBe(false);
    if (!verdict.allow) expect(verdict.reason).toBe('MISSING_OPTOUT_NOTICE');
  });

  it('bloqueia MISSING_COMPANY_NAME quando o texto não menciona a empresa configurada', () => {
    const verdict = evaluateSendGuard(
      baseFacts({ isColdFirstContact: true, text: 'Olá! Se não quiser mais receber, responda SAIR.', companyName: 'Innova Prospect' }),
    );
    expect(verdict.allow).toBe(false);
    if (!verdict.allow) expect(verdict.reason).toBe('MISSING_COMPANY_NAME');
  });

  it('bloqueia MISSING_COMPANY_NAME quando companyName é null (APP_COMPANY_NAME não configurado) mesmo com aviso de descadastro presente', () => {
    const verdict = evaluateSendGuard(
      baseFacts({ isColdFirstContact: true, text: 'Olá! Se não quiser mais receber, responda SAIR.', companyName: null }),
    );
    expect(verdict.allow).toBe(false);
    if (!verdict.allow) expect(verdict.reason).toBe('MISSING_COMPANY_NAME');
  });

  it('permite quando o 1º contato frio tem aviso de descadastro E menciona a empresa', () => {
    const verdict = evaluateSendGuard(
      baseFacts({
        isColdFirstContact: true,
        text: 'Olá! Aqui é da Innova Prospect. Se não quiser mais receber, responda SAIR.',
        companyName: 'Innova Prospect',
      }),
    );
    expect(verdict.allow).toBe(true);
  });

  it('conversa em curso (não é 1º contato frio) NÃO exige o aviso — só avisa, não bloqueia', () => {
    const verdict = evaluateSendGuard(baseFacts({ isColdFirstContact: false, text: 'Fechado, te mando o link em breve!' }));
    expect(verdict.allow).toBe(true);
    if (verdict.allow) expect(verdict.warnings.map((w) => w.code)).toContain('NO_OPTOUT_NOTICE_IN_REPLY');
  });
});

describe('evaluateSendGuard — instância degradada gera warning, não bloqueio', () => {
  it('permite com warning INSTANCE_DEGRADED quando isDegraded=true mas ainda conectada', () => {
    const verdict = evaluateSendGuard(baseFacts({ instance: { status: 'connected', isDegraded: true, warmupDay: 22, dailyLimitOverride: null } }));
    expect(verdict.allow).toBe(true);
    if (verdict.allow) expect(verdict.warnings.map((w) => w.code)).toContain('INSTANCE_DEGRADED');
  });
});

describe('evaluateSendGuard — caminho feliz', () => {
  it('permite tudo certo; único warning é o informativo de resposta sem aviso de descadastro (não é 1º contato)', () => {
    const verdict = evaluateSendGuard(baseFacts());
    expect(verdict.allow).toBe(true);
    if (verdict.allow) expect(verdict.warnings.map((w) => w.code)).toEqual(['NO_OPTOUT_NOTICE_IN_REPLY']);
  });

  it('sem warning nenhum quando o texto da resposta já repete o aviso de descadastro', () => {
    const verdict = evaluateSendGuard(baseFacts({ text: 'Fechado! Se preferir não receber mais, responda SAIR.' }));
    expect(verdict.allow).toBe(true);
    if (verdict.allow) expect(verdict.warnings).toEqual([]);
  });

  it('usa DEFAULT_SEND_WINDOW_CONFIG quando nenhuma config é passada', () => {
    const verdict = evaluateSendGuard(baseFacts(), {});
    expect(verdict.allow).toBe(true);
  });

  it('aceita um windowConfig customizado (ex.: piso mais estreito)', () => {
    const narrowed = { ...DEFAULT_SEND_WINDOW_CONFIG, quietHours: { startHour: 11, endHour: 18 } };
    const verdict = evaluateSendGuard(baseFacts(), { windowConfig: narrowed });
    expect(verdict.allow).toBe(false); // 10h fica fora do piso estreitado (11-18)
  });
});
