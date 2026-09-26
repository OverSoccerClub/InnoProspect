/**
 * Consertos pontuais nos 12 templates que já existem em produção.
 *
 * POR QUE EXISTE
 * Revisão dos templates do dono (26/09/2026) achou quatro problemas, três
 * deles mecânicos — dá para consertar sem reescrever o texto nem mudar o tom.
 * Editar 12 templates à mão na tela é lento e, pior, é onde se erra: basta
 * apagar um caractere a mais num deles.
 *
 * O QUE ELE CONSERTA, E POR QUÊ CADA UM
 *
 *   A. O VOCATIVO QUEBRADO (nos 12). Todos abrem com
 *      `{Olá|Oi|Bom dia}, {{primeiro_nome}}!`. Mas `{{primeiro_nome}}` é o
 *      PRIMEIRO TOKEN DA RAZÃO SOCIAL, não o nome de uma pessoa — "Clínica
 *      Sorriso Ltda" vira "Olá, Clínica!"; "Dr. João Odontologia" vira "Olá,
 *      Dr.!"; "3D Print Soluções" vira "Olá, 3D!". É a PRIMEIRA LINHA de toda
 *      mensagem enviada, e nenhuma pessoa real escreveria isso — denuncia
 *      disparo automático antes do segundo parágrafo. A correção não perde
 *      personalização: `{{nome}}` completo já aparece na frase seguinte, e
 *      ali ele funciona bem ("Encontrei a Clínica Sorriso Ltda no Google").
 *
 *   B. `{{minha_empresa}}` NOS QUATRO DE FOLLOW-UP/ENCERRAMENTO. Hoje eles
 *      passam, porque o portão G10 (identificar o remetente) só vale no
 *      PRIMEIRO CONTATO FRIO — e `isColdFirstContact` é `lastOutbound ===
 *      null`, então quem já recebeu mensagem não dispara o gate. Correto por
 *      desenho. A armadilha é outra: se uma campanha de follow-up incluir UM
 *      lead que nunca foi contatado, aquele alvo devolve
 *      `MISSING_COMPANY_NAME` — e pela tabela §6.8.5 esse motivo **halta a
 *      campanha inteira**, não só o alvo. Um lead errado no público para
 *      tudo. Uma linha de texto elimina a armadilha para sempre.
 *
 *   C. A CONCORDÂNCIA DO BOT-02. "Posso te mostrar um exemplo aplicado à
 *      {{categoria}}" — a categoria do Google Maps é substantivo de gênero
 *      variável, então sai "aplicado à Dentista", "aplicado à Restaurante".
 *      O "à" acerta em metade dos casos. `{{nome}}` sempre concorda.
 *
 *   D. VARIAÇÃO EM BOT-06 E SITE-04. Os dois geram 2 variações — abaixo do
 *      limiar de 3 do próprio sistema, que já os marca em vermelho na tela.
 *      São mensagens que saem quase idênticas para todo mundo, que é
 *      exatamente o padrão que o spintax existe para quebrar (§6.4).
 *
 * O QUE ELE NÃO FAZ, DE PROPÓSITO
 *   - Não mexe no comprimento nem no fato de a 1ª mensagem vender. Isso é
 *     discordância aberta entre o texto do dono e a §8.11.2, e quem resolve
 *     é a medição, não um script.
 *   - Não tira `{{categoria}}` dos BOT-01/03/04 (risco de lead fora do
 *     nicho). Isso muda a mensagem de verdade e é decisão do dono.
 *   - Não toca em nenhum template fora da lista abaixo.
 *
 * SEGURANÇA
 *   - Modo padrão é `plan`: mostra o antes/depois e NÃO escreve nada.
 *   - Casa por `id` E confere o `name`: se qualquer um dos dois divergir, o
 *     template é pulado inteiro.
 *   - Cada conserto declara o TRECHO EXATO que espera encontrar. Se o dono
 *     editou o template desde a revisão, o trecho não bate, o conserto é
 *     pulado e reportado — nunca "força" uma substituição aproximada.
 *   - Nunca cria, nunca apaga.
 *
 * USO (dentro do container, working dir `/app`):
 *   node node_modules/tsx/dist/cli.mjs packages/db/prisma/templates-consertos.ts        # plan
 *   node node_modules/tsx/dist/cli.mjs packages/db/prisma/templates-consertos.ts apply
 *
 * ⚠️ NÃO use `node node_modules/.bin/tsx`: o `.bin/tsx` é um shell script
 * wrapper e o `node` tenta interpretá-lo como JavaScript, morrendo com
 * `SyntaxError: missing ) after argument list`.
 */
import { prisma } from '../src/client.js';

/** Espelha `TEMPLATE_ALLOWED_VARIABLES` (`@inno/contracts`) — duplicado porque scripts desta pasta só podem importar `../src/client.js` (é o único caminho copiado para a imagem do `apps/web`). */
const VARIAVEIS_PERMITIDAS = ['nome', 'primeiro_nome', 'cidade', 'uf', 'categoria', 'site', 'telefone', 'minha_empresa'];

/** Espelha `OPT_OUT_NOTICE_PATTERNS` (`@inno/core`) — a conferência pós-conserto não pode depender de import proibido aqui. */
const PADROES_DESCADASTRO: readonly RegExp[] = [
  /respond\w*[^.!?]{0,20}\bsair\b/i,
  /descadastr\w*/i,
  /unsubscribe/i,
  /n[aã]o\s+(quer\w*\s+)?receber\s+mais/i,
];

type Conserto = {
  /** O que este conserto resolve — aparece no `plan`. */
  label: string;
  /** Trecho EXATO esperado no corpo atual. Não bateu = template foi editado; pula e reporta. */
  de: string;
  para: string;
};

type AlvoDeConserto = {
  id: string;
  /** Conferido contra o banco — id certo com nome diferente é sinal de que algo mudou, e aí não se toca. */
  name: string;
  consertos: readonly Conserto[];
};

/**
 * O conserto A (vocativo) é o MESMO trecho nos 12, então mora numa função em
 * vez de ser repetido doze vezes. Todos os corpos contêm literalmente
 * `, {{primeiro_nome}}!` — conferido no dump de 26/09.
 */
const CONSERTO_VOCATIVO: Conserto = {
  label: 'A · vocativo: remove `, {{primeiro_nome}}` (razão social não é nome de pessoa)',
  de: ', {{primeiro_nome}}!',
  para: '!',
};

const ALVOS: readonly AlvoDeConserto[] = [
  {
    id: 'u10tn0463yyl32aodg0bw9bi',
    name: 'SITE-01 | Primeiro contato — Sem site',
    consertos: [CONSERTO_VOCATIVO],
  },
  {
    id: 'kum8izaxmuf0f61o75nc7x41',
    name: 'SITE-02 | Primeiro contato — Abordagem curta',
    consertos: [CONSERTO_VOCATIVO],
  },
  {
    id: 'zdb1dlg4lxqj9jnvt9ir4wzf',
    name: 'SITE-03 | Follow-up — Sem resposta',
    consertos: [
      CONSERTO_VOCATIVO,
      {
        label: 'B · identifica o remetente (evita halt se o público incluir lead nunca contatado)',
        de: '{Olá|Oi}! Tudo bem?\n\n{Passando para retomar',
        para: '{Olá|Oi}! Tudo bem?\n\nAqui é da {{minha_empresa}}.\n\n{Passando para retomar',
      },
    ],
  },
  {
    id: 'mueqtcy6dmrlfynbd6saryz6',
    name: 'SITE-04 | Encerramento — Sem resposta',
    consertos: [
      CONSERTO_VOCATIVO,
      {
        label: 'B · identifica o remetente',
        de: '{Olá|Oi}!\n\nVou encerrar',
        para: '{Olá|Oi}!\n\nAqui é da {{minha_empresa}}.\n\nVou encerrar',
      },
      {
        label: 'D · variação (2 → 16): três blocos fixos ganham alternativa',
        de: 'Vou encerrar meu contato por aqui para não ficar insistindo. 🙂',
        para: '{Vou encerrar meu contato por aqui|Este é meu último contato} para não ficar insistindo. 🙂',
      },
      {
        label: 'D · variação (continuação)',
        de: 'Caso esse projeto entre nos planos de vocês futuramente, ficaremos à disposição.',
        para: '{Caso esse projeto entre nos planos de vocês futuramente|Se isso passar a fazer sentido mais pra frente}, ficaremos à disposição.',
      },
      {
        label: 'D · variação (continuação)',
        de: 'Desejo sucesso para a {{nome}}!',
        para: '{Desejo sucesso para a {{nome}}!|Sucesso para vocês!}',
      },
    ],
  },
  {
    id: 'u55eua9utvxma4awhaa8987a',
    name: 'SITE-05 | Site existente — Melhoria',
    consertos: [CONSERTO_VOCATIVO],
  },
  {
    id: 'zrwdv5pc1dfwwtc2a9lcdfhh',
    name: 'BOT-01 | Atendimento e agendamento',
    consertos: [CONSERTO_VOCATIVO],
  },
  {
    id: 'yvh8z8d4pyvq7leuopctb5wt',
    name: 'BOT-02 | Alto volume de atendimento',
    consertos: [
      CONSERTO_VOCATIVO,
      {
        label: 'C · concordância: "aplicado à {{categoria}}" erra o gênero em metade dos casos',
        de: 'Posso te mostrar um exemplo aplicado à {{categoria}}.',
        para: 'Posso te mostrar um exemplo aplicado à realidade da {{nome}}.',
      },
    ],
  },
  {
    id: 'vhalh1wbovaokjhm64pjzzp3',
    name: 'BOT-03 | Oportunidade de não perder atendimento',
    consertos: [CONSERTO_VOCATIVO],
  },
  {
    id: 'mtwz4lms4n8xkfhgjh3s51oi',
    name: 'BOT-04 | Agendamento específico',
    consertos: [CONSERTO_VOCATIVO],
  },
  {
    id: 'fr50vfnq44b7u5rkq5n6ff78',
    name: 'BOT-05 | Follow-up',
    consertos: [
      CONSERTO_VOCATIVO,
      {
        label: 'B · identifica o remetente',
        de: '{Olá|Oi}!\n\nSó passando para retomar',
        para: '{Olá|Oi}!\n\nAqui é da {{minha_empresa}}.\n\nSó passando para retomar',
      },
    ],
  },
  {
    id: 'u9qpezups4mhgjfp04ehbvhv',
    name: 'BOT-06 | Encerramento',
    consertos: [
      CONSERTO_VOCATIVO,
      {
        label: 'B · identifica o remetente',
        de: '{Olá|Oi}!\n\nVou encerrar',
        para: '{Olá|Oi}!\n\nAqui é da {{minha_empresa}}.\n\nVou encerrar',
      },
      {
        label: 'D · variação (2 → 16): três blocos fixos ganham alternativa',
        de: 'Vou encerrar meu contato por aqui para não ficar insistindo. 🙂',
        para: '{Vou encerrar meu contato por aqui|Este é meu último contato} para não ficar insistindo. 🙂',
      },
      {
        label: 'D · variação (continuação)',
        de: 'Caso vocês decidam automatizar esse processo futuramente, ficaremos à disposição.',
        para: '{Caso vocês decidam automatizar esse processo futuramente|Se isso passar a fazer sentido mais pra frente}, ficaremos à disposição.',
      },
      {
        label: 'D · variação (continuação)',
        de: 'Desejo sucesso para vocês!',
        para: '{Desejo sucesso para vocês!|Sucesso para a {{nome}}!}',
      },
    ],
  },
  {
    id: 'seb61aiwcybcsdemxrgxjt23',
    name: 'IA-01 | Assistente comercial',
    consertos: [CONSERTO_VOCATIVO],
  },
];

/** Mesma extração de `extractKnownVariables` no serviço — `primeiro_nome` sai da lista quando o vocativo é removido, e a coluna precisa acompanhar. */
function variaveisUsadas(body: string): string[] {
  const encontradas = [...body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]!);
  return [...new Set(encontradas)].filter((v) => VARIAVEIS_PERMITIDAS.includes(v));
}

/**
 * Conta variações de spintax. Simplificação assumida e VERDADEIRA para estes
 * 12 templates: nenhum tem spintax aninhado. Blocos `{{variável}}` são
 * removidos antes da contagem para não serem confundidos com `{a|b}`.
 * Serve para MOSTRAR o efeito do conserto D — não é o contador oficial do
 * sistema (esse é `countSpintaxVariations` em `@inno/core`).
 */
function contarVariacoes(body: string): number {
  const semVariaveis = body.replace(/\{\{[^}]*\}\}/g, '');
  const blocos = [...semVariaveis.matchAll(/\{([^{}]*\|[^{}]*)\}/g)];
  return blocos.reduce((total, b) => total * (b[1]!.split('|').length), 1);
}

function temAvisoDescadastro(body: string): boolean {
  return PADROES_DESCADASTRO.some((p) => p.test(body));
}

/** Mostra só o que mudou, com um pouco de contexto — diff inteiro de 12 templates seria ilegível. */
function trechoComContexto(texto: string, alvo: string): string {
  const i = texto.indexOf(alvo);
  if (i < 0) return '(não encontrado)';
  const inicio = Math.max(0, i - 40);
  const fim = Math.min(texto.length, i + alvo.length + 40);
  return `${inicio > 0 ? '…' : ''}${texto.slice(inicio, fim).replace(/\n/g, '⏎')}${fim < texto.length ? '…' : ''}`;
}

type Resultado = {
  name: string;
  aplicados: string[];
  pulados: string[];
  bodyNovo: string | null;
  variacoesAntes: number;
  variacoesDepois: number;
  variaveisAntes: string[];
  variaveisDepois: string[];
};

async function executar(aplicar: boolean): Promise<void> {
  const resultados: Resultado[] = [];
  let naoEncontrados = 0;

  for (const alvo of ALVOS) {
    const atual = await prisma.messageTemplate.findUnique({
      where: { id: alvo.id },
      select: { id: true, name: true, body: true, variablesUsed: true },
    });

    if (!atual) {
      console.log(`\n⚠ NÃO ENCONTRADO: ${alvo.name} (id ${alvo.id}) — pulado inteiro.`);
      naoEncontrados += 1;
      continue;
    }
    if (atual.name !== alvo.name) {
      console.log(`\n⚠ NOME DIVERGENTE no id ${alvo.id}: banco diz "${atual.name}", eu esperava "${alvo.name}" — pulado inteiro, por segurança.`);
      naoEncontrados += 1;
      continue;
    }

    let body = atual.body;
    const aplicados: string[] = [];
    const pulados: string[] = [];

    for (const c of alvo.consertos) {
      if (!body.includes(c.de)) {
        pulados.push(`${c.label}  ← trecho esperado não encontrado (template editado desde a revisão?)`);
        continue;
      }
      // Aplica em memória nos DOIS modos — é o que permite o `plan` mostrar o
      // resultado final de verdade (contagem de variações, variáveis que
      // saem/entram) em vez de uma previsão. O que o `plan` não faz é gravar.
      body = body.split(c.de).join(c.para);
      aplicados.push(c.label);
    }

    resultados.push({
      name: atual.name,
      aplicados,
      pulados,
      bodyNovo: body === atual.body ? null : body,
      variacoesAntes: contarVariacoes(atual.body),
      variacoesDepois: contarVariacoes(body),
      variaveisAntes: atual.variablesUsed,
      variaveisDepois: variaveisUsadas(body),
    });

    // Rede de segurança: o conserto NUNCA pode remover o aviso de
    // descadastro. Se removesse, a campanha seria barrada no G10 — e pior,
    // a mensagem sairia sem a saída que a LGPD exige se o gate mudasse.
    if (!temAvisoDescadastro(body)) {
      throw new Error(`ABORTADO: o conserto removeria o aviso de descadastro de "${atual.name}". Nada foi escrito.`);
    }
  }

  console.log('\n' + '='.repeat(72));
  for (const r of resultados) {
    const mudou = r.bodyNovo !== null;
    console.log(`\n${mudou ? '✎' : '·'} ${r.name}`);
    for (const a of r.aplicados) console.log(`    ✓ ${a}`);
    for (const p of r.pulados) console.log(`    ⚠ ${p}`);
    if (!mudou && r.pulados.length === 0) console.log('    (nada a fazer)');
    if (r.variacoesAntes !== r.variacoesDepois) {
      console.log(`    variações: ${r.variacoesAntes} → ${r.variacoesDepois}`);
    }
    const saiu = r.variaveisAntes.filter((v) => !r.variaveisDepois.includes(v));
    const entrou = r.variaveisDepois.filter((v) => !r.variaveisAntes.includes(v));
    if (saiu.length || entrou.length) {
      console.log(`    variáveis: ${saiu.length ? `− ${saiu.join(', ')}` : ''}${saiu.length && entrou.length ? '  ' : ''}${entrou.length ? `+ ${entrou.join(', ')}` : ''}`);
    }
  }
  console.log('\n' + '='.repeat(72));

  const comMudanca = resultados.filter((r) => r.bodyNovo !== null);
  const comPulo = resultados.filter((r) => r.pulados.length > 0);

  console.log(`\n${comMudanca.length} template(s) a alterar · ${comPulo.length} com conserto pulado · ${naoEncontrados} não encontrado(s).`);

  if (!aplicar) {
    console.log('\n── SIMULAÇÃO. Nada foi escrito no banco. ──');
    console.log('Para aplicar: acrescente `apply` ao final do comando.');
    return;
  }

  for (const alvo of ALVOS) {
    const r = resultados.find((x) => x.name === alvo.name);
    if (!r || r.bodyNovo === null) continue;
    await prisma.messageTemplate.update({
      where: { id: alvo.id },
      data: { body: r.bodyNovo, variablesUsed: r.variaveisDepois },
    });
    console.log(`  ✓ gravado: ${r.name}`);
  }

  console.log(`\n${comMudanca.length} template(s) atualizado(s). Nenhum criado, nenhum apagado.`);
  console.log('Confira na tela de Templates — a contagem de variações deve bater com a listada acima.');
}

async function main(): Promise<void> {
  const comando = process.argv[2] ?? 'plan';
  if (comando !== 'plan' && comando !== 'apply') {
    console.error(`Comando desconhecido: "${comando}". Use: plan | apply`);
    process.exitCode = 1;
    return;
  }
  await executar(comando === 'apply');
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
