/**
 * test/fake-retention-db.ts — banco falso, em memória, dedicado a
 * `jobs/retention.job.ts`. Formato de consulta MUITO diferente de
 * `fake-dispatch-db.ts` (o `$queryRaw` de candidatos de exclusão de Lead faz
 * um `LEFT JOIN` agregado contra `messages`, e não há equivalente de claim
 * atômico aqui) — por isso um fake PRÓPRIO, mesmo critério já usado no
 * projeto (`fake-db.ts` vs. `fake-dispatch-db.ts`: um fake por família de
 * consultas, não um mock genérico do Prisma inteiro).
 *
 * ⚠️ `optOut` é DELIBERADAMENTE ausente deste fake — nenhum método
 * `findMany`/`delete`/`deleteMany`. Se `retention.job.ts` algum dia tentar
 * apagar um `OptOut` (regressão contra a regra "nunca apaga", ARQUITETURA
 * §7.5), o teste falha imediatamente com "is not a function", não com uma
 * asserção que alguém pode esquecer de escrever. `resetFakeRetentionDb`
 * ainda aceita semear `optOuts` (lista simples, sem cascade simulado — a
 * proteção real é do SCHEMA, `OptOut.leadId onDelete: SetNull`, não deste
 * fake) só para o teste comprovar que a lista nunca é tocada pelo job.
 */
import { vi } from 'vitest';

export interface FakeLead {
  id: string;
  collectedAt: Date;
}

export interface FakeMessage {
  id: string;
  leadId: string;
  body: string;
  /** "Metadados agregados" que a retenção de conteúdo precisa PRESERVAR — usado no teste que prova que só `body`/`contentRedactedAt` mudam. */
  direction: string;
  status: string;
  instanceId: string;
  createdAt: Date;
  contentRedactedAt: Date | null;
}

export interface FakeOptOut {
  id: string;
  phoneE164: string;
  leadId: string | null;
}

export interface FakeDbSeed {
  leads?: FakeLead[];
  messages?: FakeMessage[];
  optOuts?: FakeOptOut[];
}

const store = {
  leads: [] as FakeLead[],
  messages: [] as FakeMessage[],
  optOuts: [] as FakeOptOut[],
};

export function resetFakeRetentionDb(seed: FakeDbSeed = {}): void {
  store.leads = seed.leads ? seed.leads.map((l) => ({ ...l })) : [];
  store.messages = seed.messages ? seed.messages.map((m) => ({ ...m })) : [];
  store.optOuts = seed.optOuts ? seed.optOuts.map((o) => ({ ...o })) : [];
}

export function getFakeRetentionDbState() {
  return store;
}

export const fakePrismaClient = {
  message: {
    count: vi.fn(async ({ where }: { where: { createdAt: { lt: Date }; contentRedactedAt: null } }) => {
      const cutoff = where.createdAt.lt.getTime();
      return store.messages.filter((m) => m.contentRedactedAt === null && m.createdAt.getTime() < cutoff).length;
    }),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { createdAt: { lt: Date }; contentRedactedAt: null };
        data: { body: string; contentRedactedAt: Date };
      }) => {
        const cutoff = where.createdAt.lt.getTime();
        const matched = store.messages.filter((m) => m.contentRedactedAt === null && m.createdAt.getTime() < cutoff);
        for (const m of matched) {
          m.body = data.body;
          m.contentRedactedAt = data.contentRedactedAt;
        }
        return { count: matched.length };
      },
    ),
  },

  lead: {
    /** Simula o CASCADE real do schema (`Message.leadId`/`LeadActivity.leadId`/`CampaignTarget.leadId` são `onDelete: Cascade`) — aqui só `messages`, que é o que os testes deste job precisam provar. `P2025` (não encontrado) no mesmo formato que o Prisma real usa. */
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      const idx = store.leads.findIndex((l) => l.id === where.id);
      if (idx === -1) {
        const err = new Error('fake-retention-db: lead não encontrado') as Error & { code: string };
        err.code = 'P2025';
        throw err;
      }
      const [removed] = store.leads.splice(idx, 1);
      store.messages = store.messages.filter((m) => m.leadId !== where.id);
      return removed;
    }),
  },

  /**
   * Simula `findExpiredLeadCandidates` (`retention.job.ts`) por CONTEÚDO da
   * query (mesmo padrão de `dashboard.test.ts`/`fake-dispatch-db.ts`):
   * calcula `COALESCE(MAX(message.createdAt), lead.collectedAt)` por lead em
   * JS, ordena por id (mesmo `ORDER BY` da query real, para o `LIMIT`
   * cortar de forma determinística) e aplica o `limit` recebido.
   */
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    if (sql.includes('FROM leads') && sql.includes('last_message_at')) {
      const cutoff = (values[0] as Date).getTime();
      const limit = values[1] as number;

      const rows = store.leads
        .map((lead) => {
          const leadMessages = store.messages.filter((m) => m.leadId === lead.id);
          const lastMessageAt = leadMessages.length > 0 ? Math.max(...leadMessages.map((m) => m.createdAt.getTime())) : null;
          const effective = lastMessageAt ?? lead.collectedAt.getTime();
          return { id: lead.id, had_interaction: lastMessageAt !== null, effective };
        })
        .filter((row) => row.effective < cutoff)
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, limit)
        .map(({ id, had_interaction }) => ({ id, had_interaction }));

      return rows;
    }
    throw new Error(`fake-retention-db: $queryRaw inesperado no teste: ${sql}`);
  }),
} as const;
