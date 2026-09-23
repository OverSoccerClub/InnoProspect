/**
 * selftest.ts — ENTRYPOINT de linha de comando do auto-teste
 * (`selftest-checks.ts` tem as checagens em si e o porquê de cada uma; leia
 * lá primeiro). Uso:
 *
 *   node dist/selftest.js          # completo (módulos, Postgres, filas, Chromium)
 *   node dist/selftest.js --ping   # leve (Postgres + heartbeat) — HEALTHCHECK do Docker
 *
 * Este arquivo é DE PROPÓSITO só um wrapper fino: `main()` roda
 * INCONDICIONALMENTE no topo do módulo (sem nenhuma checagem de "sou eu o
 * processo principal?"), porque NADA MAIS importa `selftest.ts` — só
 * `index.ts` importa (`runSelfTest`, `formatError`) de `selftest-checks.ts`.
 * Enquanto isso continuar verdade, o `tsup`/esbuild não tem motivo para
 * mover este arquivo para um chunk compartilhado, e `node dist/selftest.js`
 * executa este código de fato. (Foi exatamente o oposto disto — a lógica de
 * CLI misturada com as checagens reutilizadas por `index.ts` no MESMO
 * arquivo — que quebrou silenciosamente na primeira versão desta entrega:
 * o `splitting` do tsup moveu tudo para um chunk compartilhado, e
 * `node dist/selftest.js` saía com código 0 sem rodar UM passo, porque o
 * gatilho ficou preso lá dentro, nunca executado pelo entry real.)
 */
import { formatError, runSelfTest, type SelfTestMode, type SelfTestReport } from './selftest-checks.js';

function printReport(report: SelfTestReport, mode: SelfTestMode): void {
  // CLI de propósito (não evento de aplicação) — texto plano em
  // `stdout`/`stderr`, sem `pino`, é mais rápido de ler no log do
  // EasyPanel/GitHub Actions/`docker inspect` do que uma linha JSON.
  console.log(`[selftest] modo=${mode}`);
  for (const step of report.steps) {
    const status = step.ok ? 'OK' : 'FALHOU';
    const info = step.ok ? step.detail : step.error;
    const linha = `[selftest] ${step.name}: ${status} (${step.durationMs}ms)${info ? ` — ${info}` : ''}`;
    if (step.ok) console.log(linha);
    else console.error(linha);
  }
  if (report.ok) {
    console.log(`[selftest] RESULTADO: ${report.steps.length}/${report.steps.length} passos OK`);
  } else {
    const falhas = report.steps.filter((s) => !s.ok).map((s) => s.name);
    console.error(`[selftest] RESULTADO: FALHOU em: ${falhas.join(', ')}`);
  }
}

async function main(): Promise<void> {
  const mode: SelfTestMode = process.argv.includes('--ping') ? 'ping' : 'full';
  const report = await runSelfTest(mode);
  printReport(report, mode);
  // `process.exit()` explícito, não `process.exitCode` + retorno natural: um
  // passo que venceu o timeout (`DEFAULT_STEP_TIMEOUT_MS`, `selftest-checks.
  // ts`) pode deixar uma conexão/retry pendurada rodando em segundo plano
  // (o `Promise.race` do timeout não CANCELA a promessa perdedora) — sem
  // isto, o processo relataria a falha corretamente e mesmo assim nunca
  // encerraria por conta própria, trocando um hang silencioso por um hang
  // "barulhento", mas ainda um hang.
  process.exit(report.ok ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('[selftest] erro inesperado no próprio selftest (não é um dos passos):', formatError(err));
  process.exit(1);
});
