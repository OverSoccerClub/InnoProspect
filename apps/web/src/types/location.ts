// TODO: trocar por import de @inno/contracts quando o Vega publicar (ARQUITETURA.md §4.1)

export type Uf = {
  id: string;
  sigla: string;
  nome: string;
  cityCount: number;
};

export type City = {
  ibgeCode: string;
  nome: string;
  slug: string;
  population: number;
};
