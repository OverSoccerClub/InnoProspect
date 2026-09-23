import { describe, expect, it } from 'vitest';

import { isOptOutActivity } from '@/types/lead';

// Bug real de produção (2026-09-23): o backend grava `LeadActivity.type` como
// `'opt_out'` (`lib/services/optouts.ts`/`lib/services/webhook.ts`), enquanto
// a UI só reconhecia `'opted_out'` — todo opt-out por resposta automática
// caía no fallback genérico da linha do tempo. `isOptOutActivity` precisa
// aceitar as duas grafias.
describe('isOptOutActivity', () => {
  it('reconhece a grafia usada pelo backend real', () => {
    expect(isOptOutActivity('opt_out')).toBe(true);
  });

  it('reconhece a grafia histórica desta tela/dos mocks', () => {
    expect(isOptOutActivity('opted_out')).toBe(true);
  });

  it('não reconhece outros tipos de atividade', () => {
    expect(isOptOutActivity('status_changed')).toBe(false);
    expect(isOptOutActivity('message_received')).toBe(false);
  });
});
