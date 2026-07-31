import type { City, Uf } from '@/types/location';
import { mulberry32, pick } from './utils';

const UF_SEED: Array<{ sigla: string; nome: string; capital: string; sizeTier: number }> = [
  { sigla: 'AC', nome: 'Acre', capital: 'Rio Branco', sizeTier: 22 },
  { sigla: 'AL', nome: 'Alagoas', capital: 'Maceió', sizeTier: 102 },
  { sigla: 'AP', nome: 'Amapá', capital: 'Macapá', sizeTier: 16 },
  { sigla: 'AM', nome: 'Amazonas', capital: 'Manaus', sizeTier: 62 },
  { sigla: 'BA', nome: 'Bahia', capital: 'Salvador', sizeTier: 417 },
  { sigla: 'CE', nome: 'Ceará', capital: 'Fortaleza', sizeTier: 184 },
  { sigla: 'DF', nome: 'Distrito Federal', capital: 'Brasília', sizeTier: 1 },
  { sigla: 'ES', nome: 'Espírito Santo', capital: 'Vitória', sizeTier: 78 },
  { sigla: 'GO', nome: 'Goiás', capital: 'Goiânia', sizeTier: 246 },
  { sigla: 'MA', nome: 'Maranhão', capital: 'São Luís', sizeTier: 217 },
  { sigla: 'MT', nome: 'Mato Grosso', capital: 'Cuiabá', sizeTier: 141 },
  { sigla: 'MS', nome: 'Mato Grosso do Sul', capital: 'Campo Grande', sizeTier: 79 },
  { sigla: 'MG', nome: 'Minas Gerais', capital: 'Belo Horizonte', sizeTier: 853 },
  { sigla: 'PA', nome: 'Pará', capital: 'Belém', sizeTier: 144 },
  { sigla: 'PB', nome: 'Paraíba', capital: 'João Pessoa', sizeTier: 223 },
  { sigla: 'PR', nome: 'Paraná', capital: 'Curitiba', sizeTier: 399 },
  { sigla: 'PE', nome: 'Pernambuco', capital: 'Recife', sizeTier: 184 },
  { sigla: 'PI', nome: 'Piauí', capital: 'Teresina', sizeTier: 224 },
  { sigla: 'RJ', nome: 'Rio de Janeiro', capital: 'Rio de Janeiro', sizeTier: 92 },
  { sigla: 'RN', nome: 'Rio Grande do Norte', capital: 'Natal', sizeTier: 167 },
  { sigla: 'RS', nome: 'Rio Grande do Sul', capital: 'Porto Alegre', sizeTier: 497 },
  { sigla: 'RO', nome: 'Rondônia', capital: 'Porto Velho', sizeTier: 52 },
  { sigla: 'RR', nome: 'Roraima', capital: 'Boa Vista', sizeTier: 15 },
  { sigla: 'SC', nome: 'Santa Catarina', capital: 'Florianópolis', sizeTier: 295 },
  { sigla: 'SP', nome: 'São Paulo', capital: 'São Paulo', sizeTier: 645 },
  { sigla: 'SE', nome: 'Sergipe', capital: 'Aracaju', sizeTier: 75 },
  { sigla: 'TO', nome: 'Tocantins', capital: 'Palmas', sizeTier: 139 },
];

const NAME_PARTS_A = [
  'Santa',
  'São',
  'Bom',
  'Novo',
  'Alto',
  'Boa',
  'Porto',
  'Vila',
  'Serra',
  'Rio',
  'Campo',
  'Monte',
];
const NAME_PARTS_B = [
  'Vista',
  'Esperança',
  'Alegre',
  'Verde',
  'Grande',
  'Formoso',
  'do Sul',
  'Bonito',
  'das Flores',
  'Novo',
  'Fundo',
  'Alto',
];

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function buildCitiesForUf(sigla: string, capital: string, count: number): City[] {
  const random = mulberry32(sigla.charCodeAt(0) * 1000 + sigla.charCodeAt(1));
  const cities: City[] = [
    {
      ibgeCode: `${sigla}0000001`,
      nome: capital,
      slug: slugify(capital),
      population: Math.floor(300_000 + random() * 11_000_000),
    },
  ];
  const used = new Set([capital]);
  for (let i = 1; i < count; i++) {
    let name = `${pick(NAME_PARTS_A, random)} ${pick(NAME_PARTS_B, random)}`;
    let attempts = 0;
    while (used.has(name) && attempts < 5) {
      name = `${pick(NAME_PARTS_A, random)} ${pick(NAME_PARTS_B, random)} ${i}`;
      attempts++;
    }
    used.add(name);
    cities.push({
      ibgeCode: `${sigla}${String(1000 + i).padStart(7, '0')}`,
      nome: name,
      slug: slugify(name),
      population: Math.floor(1_500 + random() * 250_000),
    });
  }
  return cities.sort((a, b) => b.population - a.population);
}

export const MOCK_UFS: Uf[] = UF_SEED.map((uf) => ({
  id: `uf_${uf.sigla.toLowerCase()}`,
  sigla: uf.sigla,
  nome: uf.nome,
  cityCount: uf.sizeTier,
})).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

// Gera no máximo 40 cidades "de verdade" por UF pro mock (a cityCount informado
// no /ufs continua sendo o total real — o backend de verdade lista todas).
const CITIES_CACHE = new Map<string, City[]>();
function citiesForUf(sigla: string): City[] {
  const cached = CITIES_CACHE.get(sigla);
  if (cached) return cached;
  const seed = UF_SEED.find((u) => u.sigla === sigla);
  if (!seed) return [];
  const list = buildCitiesForUf(seed.sigla, seed.capital, Math.min(40, seed.sizeTier));
  CITIES_CACHE.set(sigla, list);
  return list;
}

export function mockListUfs(): Uf[] {
  return MOCK_UFS;
}

export function mockListCities(uf: string, query?: string, limit = 50): City[] {
  const all = citiesForUf(uf.toUpperCase());
  const filtered = query
    ? all.filter((c) => c.nome.toLowerCase().includes(query.toLowerCase()))
    : all;
  return filtered.slice(0, limit);
}
