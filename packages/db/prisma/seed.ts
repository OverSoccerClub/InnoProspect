/**
 * Seed do InnoProspect — Fase 1.
 *
 * O QUE FAZ:
 *   1. Popula `Uf` com as 27 unidades federativas (lista estática — nunca
 *      muda, por isso não é buscada em nenhuma API: menos uma dependência
 *      de rede que pode falhar).
 *   2. Popula `City` a partir do IBGE — UMA vez, aqui no seed. O scraper e
 *      o resto do sistema NUNCA chamam o IBGE em runtime (ARQUITETURA.md
 *      §5.2). Endpoint por UF:
 *      https://servicodados.ibge.gov.br/api/v1/localidades/estados/{UF}/municipios
 *   3. Enriquece `City.population` com a API de estimativas populacionais
 *      do IBGE (agregados/SIDRA, tabela 6579) — usada só para PRIORIZAR o
 *      fanout de busca por população decrescente (ARQUITETURA §5.2). Best
 *      effort: se essa chamada falhar, o seed CONTINUA com population = 0
 *      para as cidades atingidas (fila de busca cai para ordem arbitrária,
 *      mas nada quebra) — só a etapa 2 (a lista de municípios em si) é
 *      obrigatória para o seed ser considerado bem-sucedido.
 *   4. Garante 1 usuário admin (`upsert` só por e-mail, NUNCA sobrescreve
 *      senha de um admin já existente).
 *
 * IDEMPOTÊNCIA: tudo usa `upsert` por chave natural (sigla / ibgeCode /
 * email). Rodar 2x não duplica nada e não corrompe dado humano já editado
 * (o `update` do upsert de City só toca nome/slug/uf/population — nunca em
 * nada que não exista nesta tabela, já que City não tem campo humano).
 *
 * RESILIÊNCIA: cada request HTTP tem timeout + retry com backoff. Se a API
 * de municípios do IBGE estiver fora do ar mesmo após as tentativas, o seed
 * FALHA com uma mensagem clara dizendo qual UF e qual URL, e sai com código
 * de erro != 0 — não se pode silenciar isso e seguir com dado geográfico
 * incompleto.
 */

import { prisma } from '../src/client.js';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────
// UFs — lista estática (fonte: IBGE, mas não muda; hardcode é uma escolha
// consciente de resiliência, não preguiça).
// ─────────────────────────────────────────────────────────────────────────
const UFS: Array<{ sigla: string; nome: string; regiao: string }> = [
  { sigla: 'AC', nome: 'Acre', regiao: 'Norte' },
  { sigla: 'AL', nome: 'Alagoas', regiao: 'Nordeste' },
  { sigla: 'AP', nome: 'Amapá', regiao: 'Norte' },
  { sigla: 'AM', nome: 'Amazonas', regiao: 'Norte' },
  { sigla: 'BA', nome: 'Bahia', regiao: 'Nordeste' },
  { sigla: 'CE', nome: 'Ceará', regiao: 'Nordeste' },
  { sigla: 'DF', nome: 'Distrito Federal', regiao: 'Centro-Oeste' },
  { sigla: 'ES', nome: 'Espírito Santo', regiao: 'Sudeste' },
  { sigla: 'GO', nome: 'Goiás', regiao: 'Centro-Oeste' },
  { sigla: 'MA', nome: 'Maranhão', regiao: 'Nordeste' },
  { sigla: 'MT', nome: 'Mato Grosso', regiao: 'Centro-Oeste' },
  { sigla: 'MS', nome: 'Mato Grosso do Sul', regiao: 'Centro-Oeste' },
  { sigla: 'MG', nome: 'Minas Gerais', regiao: 'Sudeste' },
  { sigla: 'PA', nome: 'Pará', regiao: 'Norte' },
  { sigla: 'PB', nome: 'Paraíba', regiao: 'Nordeste' },
  { sigla: 'PR', nome: 'Paraná', regiao: 'Sul' },
  { sigla: 'PE', nome: 'Pernambuco', regiao: 'Nordeste' },
  { sigla: 'PI', nome: 'Piauí', regiao: 'Nordeste' },
  { sigla: 'RJ', nome: 'Rio de Janeiro', regiao: 'Sudeste' },
  { sigla: 'RN', nome: 'Rio Grande do Norte', regiao: 'Nordeste' },
  { sigla: 'RS', nome: 'Rio Grande do Sul', regiao: 'Sul' },
  { sigla: 'RO', nome: 'Rondônia', regiao: 'Norte' },
  { sigla: 'RR', nome: 'Roraima', regiao: 'Norte' },
  { sigla: 'SC', nome: 'Santa Catarina', regiao: 'Sul' },
  { sigla: 'SP', nome: 'São Paulo', regiao: 'Sudeste' },
  { sigla: 'SE', nome: 'Sergipe', regiao: 'Nordeste' },
  { sigla: 'TO', nome: 'Tocantins', regiao: 'Norte' },
];

const IBGE_MUNICIPIOS_URL = (uf: string) =>
  `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`;

// Tabela 6579 (Estimativas de população), variável 9324, período -1 (mais
// recente disponível), nível N6 = município, "all" = todos de uma vez —
// 1 request para o país inteiro, em vez de 1 por UF ou 1 por município.
const IBGE_POPULACAO_URL =
  'https://servicodados.ibge.gov.br/api/v3/agregados/6579/periodos/-1/variaveis/9324?localidades=N6[all]';

type IbgeMunicipio = { id: number; nome: string };

// ─────────────────────────────────────────────────────────────────────────
// HTTP helpers — timeout + retry com backoff. A API do IBGE é pública e
// gratuita, mas instável o suficiente para merecer isso num seed que roda
// (idealmente) 1x por ambiente.
// ─────────────────────────────────────────────────────────────────────────
async function fetchJsonWithRetry(
  url: string,
  { retries = 3, timeoutMs = 20_000 }: { retries?: number; timeoutMs?: number } = {},
): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const backoffMs = attempt * 1500;
        console.warn(
          `  [aviso] falha ao buscar ${url} (tentativa ${attempt}/${retries}): ${
            err instanceof Error ? err.message : String(err)
          }. Tentando de novo em ${backoffMs}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(
    `Não foi possível buscar ${url} após ${retries} tentativas. Última falha: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '') // remove acentos (marcas diacriticas combinantes)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ─────────────────────────────────────────────────────────────────────────
// Etapa 1 — UFs
// ─────────────────────────────────────────────────────────────────────────
async function seedUfs() {
  console.log(`\n[1/4] Semeando ${UFS.length} UFs...`);
  for (const uf of UFS) {
    await prisma.uf.upsert({
      where: { sigla: uf.sigla },
      update: { nome: uf.nome, regiao: uf.regiao },
      create: uf,
    });
  }
  console.log('  ✔ UFs ok.');
}

// ─────────────────────────────────────────────────────────────────────────
// Etapa 2 — população estimada (best-effort; ver cabeçalho do arquivo)
// ─────────────────────────────────────────────────────────────────────────
async function fetchPopulationMap(): Promise<Map<string, number>> {
  console.log('\n[2/4] Buscando estimativas de população (IBGE, tabela 6579)...');
  const map = new Map<string, number>();

  try {
    const data = (await fetchJsonWithRetry(IBGE_POPULACAO_URL, { retries: 2 })) as Array<{
      resultados: Array<{ series: Array<{ localidade: { id: string }; serie: Record<string, string> }> }>;
    }>;

    const series = data?.[0]?.resultados?.[0]?.series ?? [];
    for (const item of series) {
      const ibgeCode = item.localidade.id;
      const values = Object.values(item.serie ?? {});
      const latest = values[values.length - 1];
      const population = latest ? Number.parseInt(latest, 10) : 0;
      if (ibgeCode && Number.isFinite(population)) {
        map.set(ibgeCode, population);
      }
    }
    console.log(`  ✔ População obtida para ${map.size} municípios.`);
  } catch (err) {
    console.warn(
      `  [aviso] não foi possível obter estimativas de população (${
        err instanceof Error ? err.message : String(err)
      }). Seguindo com population=0 — a priorização do fanout de busca fica sem efeito até isso ser corrigido.`,
    );
  }

  return map;
}

// ─────────────────────────────────────────────────────────────────────────
// Etapa 3 — Cities (obrigatório; falha aqui derruba o seed)
// ─────────────────────────────────────────────────────────────────────────
async function seedCities(populationByIbgeCode: Map<string, number>) {
  console.log(`\n[3/4] Semeando municípios (IBGE, por UF)...`);
  let totalCities = 0;

  for (const uf of UFS) {
    const url = IBGE_MUNICIPIOS_URL(uf.sigla);
    let municipios: IbgeMunicipio[];

    try {
      municipios = (await fetchJsonWithRetry(url)) as IbgeMunicipio[];
    } catch (err) {
      // Falha clara e imediata — sem isso, o fanout de busca desta UF (e
      // possivelmente das seguintes) fica quebrado silenciosamente.
      throw new Error(
        `Seed abortado: falha ao buscar municípios de ${uf.sigla} em ${url}. ` +
          `A API de localidades do IBGE parece estar fora do ar ou inacessível ` +
          `deste ambiente. Causa: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    for (const m of municipios) {
      const ibgeCode = String(m.id);
      await prisma.city.upsert({
        where: { ibgeCode },
        update: {
          name: m.nome,
          slug: slugify(m.nome),
          uf: uf.sigla,
          population: populationByIbgeCode.get(ibgeCode) ?? 0,
        },
        create: {
          ibgeCode,
          name: m.nome,
          slug: slugify(m.nome),
          uf: uf.sigla,
          population: populationByIbgeCode.get(ibgeCode) ?? 0,
        },
      });
    }

    totalCities += municipios.length;
    console.log(`  ✔ ${uf.sigla}: ${municipios.length} municípios (total acumulado: ${totalCities}).`);
  }

  console.log(`  ✔ ${totalCities} municípios semeados no total.`);
}

// ─────────────────────────────────────────────────────────────────────────
// Etapa 4 — Usuário admin
// ─────────────────────────────────────────────────────────────────────────
async function seedAdmin() {
  console.log('\n[4/4] Garantindo usuário admin...');

  // `.toLowerCase()` é OBRIGATÓRIO aqui, não estilo: o `authorize` de
  // apps/web/src/lib/auth.ts normaliza com `.trim().toLowerCase()` antes do
  // findUnique. Gravar "Admin@Empresa.com" e procurar "admin@empresa.com" faz
  // o login falhar para sempre, com a senha certa, sem mensagem que ajude —
  // o Auth.js só devolve CredentialsSignin genérico.
  const email = (process.env.ADMIN_EMAIL?.trim() || 'admin@innoprospect.local').toLowerCase();
  // Ecoar o e-mail EFETIVAMENTE usado: quando o login falha com o
  // CredentialsSignin genérico, esta linha do log é o jeito mais rápido de
  // ver que o ADMIN_EMAIL do ambiente não é o que você pensava.
  console.log(`  → e-mail do admin (normalizado): ${email}`);

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    // Idempotência de verdade: NUNCA resetamos a senha de um admin que já
    // existe só porque o seed rodou de novo (ex.: deploy). Isso trocaria a
    // senha por baixo do usuário sem aviso.
    //
    // A exceção é explícita e temporária: ADMIN_RESET_PASSWORD=true, para
    // recuperar acesso sem terminal no container. Quem liga isso está pedindo
    // a troca conscientemente — e o log manda desligar depois.
    const forceReset = process.env.ADMIN_RESET_PASSWORD?.trim() === 'true';
    const newPassword = process.env.ADMIN_PASSWORD?.trim();

    if (forceReset && newPassword) {
      await prisma.user.update({
        where: { email },
        data: { passwordHash: await bcrypt.hash(newPassword, 12) },
      });
      console.log(`  ✔ Admin "${email}" já existia — senha REDEFINIDA (ADMIN_RESET_PASSWORD=true).`);
      console.log('  ⚠ REMOVA ADMIN_RESET_PASSWORD das envs agora que o acesso foi recuperado.');
      return;
    }

    if (forceReset && !newPassword) {
      console.log('  ⚠ ADMIN_RESET_PASSWORD=true mas ADMIN_PASSWORD está vazio — nada foi alterado.');
    }

    console.log(`  ✔ Admin "${email}" já existe — não tocado.`);
    return;
  }

  let password = process.env.ADMIN_PASSWORD?.trim();
  let generated = false;
  if (!password) {
    // Nunca embutir uma senha padrão conhecida (ex.: "admin123") num seed
    // que pode rodar em produção. Gera uma senha aleatória forte e mostra
    // UMA vez no log — quem estiver rodando o seed precisa capturar ali.
    password = randomBytes(18).toString('base64url');
    generated = true;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.create({
    data: {
      email,
      passwordHash,
      name: process.env.ADMIN_NAME?.trim() || 'Administrador',
      role: 'admin',
    },
  });

  console.log(`  ✔ Admin "${email}" criado.`);
  if (generated) {
    console.log('  ⚠ ADMIN_PASSWORD não veio do ambiente — gerei uma senha aleatória.');
    console.log(`  ⚠ SENHA (mostrada só agora, salve já): ${password}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══ InnoProspect — seed (Fase 1) ═══');

  await seedUfs();
  const populationMap = await fetchPopulationMap();
  await seedCities(populationMap);
  await seedAdmin();

  console.log('\n═══ Seed concluído com sucesso. ═══');
}

main()
  .catch((err) => {
    console.error('\n✖ Seed FALHOU:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
