/**
 * queues.test.ts — guarda de regressão do NOME das filas.
 *
 * Por que este teste existe: em 2026-09-22 o worker entrou em crash-loop em
 * produção (EasyPanel) com `Error: Queue name cannot contain :`. O nome era
 * `scrape:search` — o BullMQ usa `:` como separador dos seus próprios
 * prefixos de chave no Redis (`bull:<fila>:<id>`) e rejeita o nome no
 * construtor, ou seja, no BOOT, antes de qualquer job. O typecheck passava,
 * o lint passava, a build passava: só o processo real reclamava.
 *
 * Dois riscos distintos, cobertos separadamente aqui:
 *  1. Alguém reintroduzir `:` em qualquer fila — inclusive nas da Fase 4, que
 *     ainda não sobem `Worker` nenhum e por isso não quebrariam hoje (o
 *     `dispatch:tick` original teria explodido só quando a Fase 4 rodasse).
 *  2. Os dois lados divergirem. `apps/web` não pode importar deste app
 *     (ARQUITETURA §2), então ele DUPLICA o literal em
 *     `apps/web/src/lib/queue.ts`. Um rename feito só de um lado não quebra
 *     build nenhuma: o web enfileira numa fila e o worker escuta outra, e a
 *     busca fica em `queued` para sempre — falha silenciosa. Por isso o teste
 *     lê o arquivo do outro app como TEXTO (é a única forma de cruzar a
 *     fronteira sem violar a regra de dependência).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { QUEUES, SCRAPE_SEARCH_JOB_NAME } from './queues.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const QUEUE_TS_DO_WEB = resolve(AQUI, '../../web/src/lib/queue.ts');

describe('nomes de fila', () => {
  it.each(Object.entries(QUEUES))('%s não contém ":" (BullMQ rejeita no construtor)', (_chave, nome) => {
    expect(nome).not.toContain(':');
  });

  it('todas as filas são nomes não-vazios e únicos', () => {
    const nomes = Object.values(QUEUES);
    expect(nomes.every((n) => n.length > 0)).toBe(true);
    expect(new Set(nomes).size).toBe(nomes.length);
  });
});

describe('contrato duplicado com apps/web', () => {
  const fonteDoWeb = readFileSync(QUEUE_TS_DO_WEB, 'utf8');

  it('apps/web enfileira exatamente na fila que o worker consome', () => {
    const encontrado = /SCRAPE_SEARCH_QUEUE_NAME\s*=\s*'([^']+)'/.exec(fonteDoWeb)?.[1];
    expect(encontrado, `não achei SCRAPE_SEARCH_QUEUE_NAME em ${QUEUE_TS_DO_WEB}`).toBeDefined();
    expect(encontrado).toBe(QUEUES.scrapeSearch);
  });

  it('apps/web usa exatamente o mesmo nome de job', () => {
    const encontrado = /SCRAPE_SEARCH_JOB_NAME\s*=\s*'([^']+)'/.exec(fonteDoWeb)?.[1];
    expect(encontrado, `não achei SCRAPE_SEARCH_JOB_NAME em ${QUEUE_TS_DO_WEB}`).toBeDefined();
    expect(encontrado).toBe(SCRAPE_SEARCH_JOB_NAME);
  });
});
