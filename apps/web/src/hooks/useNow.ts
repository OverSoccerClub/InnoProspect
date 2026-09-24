'use client';

import { useEffect, useState } from 'react';

/**
 * Relógio de re-render: devolve `Date.now()` e se atualiza a cada
 * `intervalMs`, só para forçar quem o usa a recalcular textos relativos
 * (`formatRelative`, `getStatusFreshnessLevel`) sem precisar buscar dados de
 * novo. Sem isto, "confirmado há 2 min" fica CONGELADO no valor do render
 * que buscou o dado — se a pessoa deixar a tela aberta, o texto mente por
 * omissão (fica cada vez mais velho que o rótulo diz).
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
