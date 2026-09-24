'use client';

import { useEffect, useState } from 'react';

import { listLeads } from '@/lib/api/leads';
import { LEAD_PAGE_SIZES } from '@/types/lead';

export type LeadPendingSignals = {
  /** `hasPhone: false` — sem telefone, não há como sequer tentar WhatsApp. */
  noPhone: number;
  /** `offNiche: true` — categoria real diverge do nicho buscado (nunca descartado sozinho, ver `lib/api/leads.ts`/§ niche). */
  offNiche: number;
};

/**
 * Contagens para a faixa de pendências (`PendingBand`) de `/leads` —
 * SEMPRE o total real do filtro (`LeadListResponse.total`), nunca estimado a
 * partir da página carregada na tela. Cada contagem é uma chamada isolada
 * (`pageSize` no mínimo permitido, `LEAD_PAGE_SIZES[0]` — o contrato rejeita
 * qualquer valor fora do enum, não dá pra pedir `pageSize:1`) porque a
 * pendência é sobre TODO o sistema, não sobre o filtro que o operador tem
 * aplicado na tela agora — os dois nunca podem se confundir (ver DESIGN
 * pedido do dono, "fila de trabalho" != filtro atual).
 */
export function useLeadPendingSignals() {
  const [signals, setSignals] = useState<LeadPendingSignals | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listLeads({ hasPhone: false, pageSize: LEAD_PAGE_SIZES[0] }),
      listLeads({ offNiche: true, pageSize: LEAD_PAGE_SIZES[0] }),
    ])
      .then(([noPhoneRes, offNicheRes]) => {
        if (cancelled) return;
        setSignals({ noPhone: noPhoneRes.total, offNiche: offNicheRes.total });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { signals, error };
}
