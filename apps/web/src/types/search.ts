// TODO: trocar por import de @inno/contracts quando o Vega publicar (ARQUITETURA.md §4.2)

export type SearchJobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type CreateSearchRequest = {
  niche: string;
  uf: string;
  cityIbgeCodes?: string[];
  maxResultsPerCity?: number;
  name?: string;
};

export type CreateSearchResponse = {
  id: string;
  name: string;
  niche: string;
  uf: string;
  status: 'queued';
  totalTasks: number;
  doneTasks: 0;
  leadsFound: 0;
  leadsNew: 0;
  createdAt: string;
  estimatedDurationMinutes: number;
};

export type SearchJobSummary = {
  id: string;
  name: string;
  niche: string;
  uf: string;
  status: SearchJobStatus;
  progress: { total: number; done: number; failed: number; percent: number };
  leadsFound: number;
  leadsNew: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type SearchTaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export type SearchTaskItem = {
  id: string;
  cityName: string;
  ibgeCode: string;
  status: SearchTaskStatus;
  resultCount: number;
  attempt: number;
  errorCode: string | null;
  finishedAt: string | null;
};

export type SearchJobDetail = SearchJobSummary & {
  tasks: SearchTaskItem[];
  error?: string;
};
