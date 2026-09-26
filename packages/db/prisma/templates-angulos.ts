/**
 * Semeia os 7 templates de ÂNGULO de abordagem (ARQUITETURA §8.11.2).
 *
 * POR QUE EXISTE
 * O catálogo de ângulos é o coração da Fase 6: cada ângulo é um predicado
 * determinístico sobre campos coletados ("sem site", "bem avaliado e sem
 * site", "muito movimento"...), e o texto base de cada um é o que o sistema
 * envia quando não há IA no caminho — ou quando ela falha (A33: "IA é
 * conselho, nunca engrenagem"). Sem os textos, o motor de ângulos da 6.1 não
 * tem o que enviar.
 *
 * ⚠️ O DONO JÁ TEM TEMPLATES PRÓPRIOS EM PRODUÇÃO, criados pela tela. Este
 * script foi escrito DEPOIS de saber disso, e por isso ele é estruturalmente
 * incapaz de atropelá-los:
 *   - NUNCA faz `update`. NUNCA faz `delete`. Só `create`.
 *   - Pula qualquer ângulo cujo NOME já exista (comparação exata).
 *   - O modo padrão é `plan`: mostra o que faria e não escreve nada. Criar é
 *     a exceção que se pede explicitamente (`apply`) — mesma postura do
 *     `retention.job`, e pela mesma razão: entre um script que escreve por
 *     acidente e um que não escreveu nada hoje, o segundo é preferível.
 *
 * ⚠️ O pulo é por NOME, não por conteúdo. Se você já tiver um template seu
 * com a mesma ideia ("sem site") com outro nome, este script vai criar o
 * dele do lado — de propósito, porque decidir que dois textos são "a mesma
 * coisa" é julgamento seu, não de um `===`. Rode `list` antes e olhe.
 *
 * USO (dentro do container, a partir de packages/db):
 *   node ../../node_modules/.bin/tsx prisma/templates-angulos.ts list
 *   node ../../node_modules/.bin/tsx prisma/templates-angulos.ts        # plan (não escreve)
 *   node ../../node_modules/.bin/tsx prisma/templates-angulos.ts apply
 *
 * SOBRE A COLUNA `angle`
 * Ela ainda NÃO existe (é migração da Fase 6.1, §8.11.5). O vínculo
 * ângulo→template está hoje só no NOME e neste arquivo. Quando a coluna
 * entrar, a migração de dados pode ler o mapa `TEMPLATES` daqui — é por isso
 * que o campo `angle` está no objeto mesmo sem ir para o banco.
 */
import { prisma } from '../src/client.js';

/**
 * Espelha `TEMPLATE_ALLOWED_VARIABLES` (`@inno/contracts`) — DUPLICADO de
 * propósito. Scripts desta pasta importam apenas `../src/client.js`, porque
 * é o único caminho copiado para a imagem de produção do `apps/web`
 * (incidente de 2026-09-23: script que importava fora daqui morria no
 * container com `Cannot find module`). Se a lista de variáveis mudar lá, a
 * conferência abaixo passa a recusar — e falhar alto é o comportamento certo
 * para um script operacional.
 */
const VARIAVEIS_PERMITIDAS = ['nome', 'primeiro_nome', 'cidade', 'uf', 'categoria', 'site', 'telefone', 'minha_empresa'];

type TemplateDeAngulo = {
  /** Chave do ângulo (ARQUITETURA §8.11.2). Não vai para o banco ainda — ver cabeçalho. */
  angle: string;
  name: string;
  body: string;
};

/**
 * Os sete textos. Conferidos contra as funções REAIS do sistema antes de
 * entrarem aqui (`validateTemplateVariables`, `parseSpintax`,
 * `hasOptOutNotice`, `hasCompanyNameMention`, `countSpintaxVariations`):
 * todos passam, e nenhum cai abaixo do limiar de 3 variações que dispara o
 * aviso `LOW_VARIATION` (geram 16, 8, 8, 4, 4, 16 e 8).
 *
 * Três regras de escrita que não são estilo e não devem ser desfeitas sem
 * pensar:
 *
 *   1. **Nenhum número é citado.** A regra de frescor (§8.11.2, regra 3) tira
 *      `rating`/`reviewCount` do conjunto de fatos citáveis quando a coleta
 *      passa de 60 dias. Um texto base que dissesse "180 avaliações"
 *      quebraria sozinho com o tempo, afirmando em público um número que o
 *      destinatário conhece melhor que nós. As observações são qualitativas
 *      ou sobre a AUSÊNCIA de site, que é estável.
 *
 *   2. **`{{nome}}` nunca é usado como vocativo.** É razão social com ruído
 *      (`LTDA`, `- Matriz`, emoji) — "Oi, {{primeiro_nome}}" renderizaria
 *      "Oi, Clínica". Todos usam a construção "vi a {{nome}} no Google", que
 *      tolera o ruído.
 *
 *   3. **A primeira mensagem não vende** (§8.11.2): faz uma pergunta que a
 *      pessoa responde em cinco segundos. Conversa iniciada protege o
 *      número; proposta não solicitada o queima.
 */
const TEMPLATES: readonly TemplateDeAngulo[] = [
  {
    angle: 'reputation_no_website',
    name: 'Angulo — Bem avaliado e sem site',
    body: `{Oi|Olá}! {Tudo bem|Tudo certo}?

Vi a {{nome}} no Google, aí em {{cidade}} — e vocês são {bem falados|bem comentados} por lá. Só que não achei nenhum site de vocês.

{É proposital|Foi escolha de vocês} ou é algo que estava na lista pra fazer?

Sou da {{minha_empresa}}. Se não fizer sentido, é só responder SAIR que eu não mando mais nada.`,
  },
  {
    angle: 'no_website',
    name: 'Angulo — Sem site',
    body: `{Oi|Olá}! Vi a {{nome}} {aqui no|pelo} Google Maps, em {{cidade}}.

Não encontrei site de vocês — {fiquei na dúvida|queria entender}: hoje, quando alguém procura vocês na internet, o que aparece?

{{minha_empresa}} aqui. Se preferir não receber mais, responda SAIR.`,
  },
  {
    angle: 'high_volume',
    name: 'Angulo — Muito movimento',
    body: `{Oi|Olá}! Vi a {{nome}} no Google e dá pra ver que o movimento aí em {{cidade}} é {grande|forte}.

Pergunta rápida: quem responde o WhatsApp de vocês {no fim de semana|fora do horário}?

Sou da {{minha_empresa}} — se não for o momento, responda SAIR que eu paro por aqui.`,
  },
  {
    angle: 'site_low_traction',
    name: 'Angulo — Tem site, pouca tracao',
    body: `{Oi|Olá}! Encontrei o site de vocês ({{site}}) e a {{nome}} no Maps também.

Queria entender uma coisa: vocês {chegam a receber|recebem} contato pelo site, ou quase tudo entra pelo WhatsApp mesmo?

{{minha_empresa}}. Se não quiser receber mais, é só responder SAIR.`,
  },
  {
    angle: 'low_visibility',
    name: 'Angulo — Pouca presenca digital',
    body: `{Oi|Olá}! Achei a {{nome}} no Google Maps, aí em {{cidade}}.

Vocês recebem mais cliente {por indicação ou pela internet|no boca a boca ou por busca}?

Sou da {{minha_empresa}}. Responda SAIR se não quiser mais contato.`,
  },
  {
    angle: 'local_reference',
    name: 'Angulo — Referencia na cidade',
    body: `{Oi|Olá}! Vi a {{nome}} no Google e vocês estão {entre os mais bem avaliados|entre os melhores avaliados} de {{cidade}}. Parabéns, {é raro|não é comum} ver isso.

Fiquei curioso: hoje vocês {dão conta de|conseguem responder} todo contato que chega?

{{minha_empresa}} aqui — se preferir, responda SAIR e eu não escrevo mais.`,
  },
  {
    /**
     * O fallback, e ele é o mais BURRO dos sete de propósito: não diz o que a
     * empresa faz, não elogia, não cita nada. É o ângulo que recebe todo lead
     * marcado `offNiche` (§8.11.2, regra 2), cuja `category` é sabidamente
     * não confiável — foi assim que "escritório de arquitetura" trouxe a
     * Magazine Luiza. Uma frase do tipo "vi que vocês trabalham com
     * arquitetura" para a loja errada é exatamente o detalhe inventado que
     * esta fase existe para evitar.
     */
    angle: 'generic',
    name: 'Angulo — Generico (fallback e fora do nicho)',
    body: `{Oi|Olá}! {Tudo bem|Tudo certo}? Vi a {{nome}} {aqui no|pelo} Google Maps, em {{cidade}}.

Só uma pergunta rápida: hoje, como chega cliente novo pra vocês?

Sou da {{minha_empresa}}. Se não fizer sentido, responda SAIR.`,
  },
];

/** Mesma extração que `extractKnownVariables` faz no serviço — só as conhecidas, sem duplicata, na ordem de aparição. */
function variaveisUsadas(body: string): string[] {
  const encontradas = [...body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]!);
  return [...new Set(encontradas)].filter((v) => VARIAVEIS_PERMITIDAS.includes(v));
}

/**
 * Conferência mínima e LOCAL (este arquivo não pode importar `@inno/core` —
 * ver cabeçalho). Não reimplementa o parser de spintax: só pega o erro que
 * um `create` cego deixaria passar em silêncio, que é variável inventada.
 * O spintax destes sete já foi validado contra `parseSpintax` de verdade
 * antes de o arquivo existir.
 */
function conferirOuExplodir(t: TemplateDeAngulo): void {
  const desconhecidas = [...t.body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)]
    .map((m) => m[1]!)
    .filter((v) => !VARIAVEIS_PERMITIDAS.includes(v));
  if (desconhecidas.length > 0) {
    throw new Error(`Template "${t.name}" usa variável(is) que o sistema não conhece: ${[...new Set(desconhecidas)].join(', ')}`);
  }
}

async function listar(): Promise<void> {
  const existentes = await prisma.messageTemplate.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, isActive: true, usageCount: true, createdAt: true, variablesUsed: true },
  });

  if (existentes.length === 0) {
    console.log('Nenhum template no banco.');
    return;
  }

  console.log(`${existentes.length} template(s) no banco:\n`);
  for (const t of existentes) {
    const estado = t.isActive ? 'ativo  ' : 'inativo';
    const data = t.createdAt.toISOString().slice(0, 10);
    console.log(`  [${estado}] ${t.name}`);
    console.log(`            usos: ${t.usageCount} · criado em ${data} · variáveis: ${t.variablesUsed.join(', ') || '(nenhuma)'}`);
  }
}

async function planejarOuAplicar(aplicar: boolean): Promise<void> {
  for (const t of TEMPLATES) conferirOuExplodir(t);

  const nomesExistentes = new Set(
    (await prisma.messageTemplate.findMany({ select: { name: true } })).map((t) => t.name),
  );

  const aCriar = TEMPLATES.filter((t) => !nomesExistentes.has(t.name));
  const pulados = TEMPLATES.filter((t) => nomesExistentes.has(t.name));

  if (pulados.length > 0) {
    console.log(`\nJá existem (pulados, NADA é alterado neles):`);
    for (const t of pulados) console.log(`  · ${t.name}`);
  }

  if (aCriar.length === 0) {
    console.log('\nNada a criar — os 7 ângulos já estão no banco.');
    return;
  }

  console.log(`\n${aCriar.length} ângulo(s) ${aplicar ? 'sendo criado(s)' : 'que SERIAM criados'}:`);
  for (const t of aCriar) console.log(`  · ${t.name}   (${t.angle})`);

  if (!aplicar) {
    console.log('\n── SIMULAÇÃO. Nada foi escrito. ──');
    console.log('Confira antes com:  list');
    console.log('Para criar de fato: apply');
    return;
  }

  // `createdById` é obrigatório (FK `Restrict`). Qualquer admin serve — o
  // template não "pertence" a ninguém em termos de permissão; o campo existe
  // para auditoria. Falhar aqui é melhor que inventar um usuário.
  const admin = await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' }, select: { id: true, email: true } });
  if (!admin) {
    throw new Error('Nenhum usuário admin no banco — rode o seed antes (packages/db/prisma/seed.ts).');
  }

  let criados = 0;
  for (const t of aCriar) {
    await prisma.messageTemplate.create({
      data: {
        name: t.name,
        body: t.body,
        isActive: true,
        variablesUsed: variaveisUsadas(t.body),
        createdById: admin.id,
      },
    });
    criados += 1;
    console.log(`  ✓ ${t.name}`);
  }

  console.log(`\n${criados} template(s) criado(s), atribuído(s) a ${admin.email}.`);
  console.log('Nenhum template preexistente foi alterado.');
}

async function main(): Promise<void> {
  const comando = process.argv[2] ?? 'plan';

  switch (comando) {
    case 'list':
      await listar();
      return;
    case 'plan':
      await planejarOuAplicar(false);
      return;
    case 'apply':
      await planejarOuAplicar(true);
      return;
    default:
      console.error(`Comando desconhecido: "${comando}". Use: list | plan | apply`);
      process.exitCode = 1;
  }
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
