import { USE_MOCKS } from '@/lib/config';
import { apiGet } from '@/lib/fetcher';
import { mockDelay } from '@/mocks/utils';
import { mockListCities, mockListUfs } from '@/mocks/locations';
import type { City, Uf } from '@/types/location';

export async function listUfs(): Promise<Uf[]> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockListUfs();
  }
  const res = await apiGet<{ data: Uf[] }>('/api/v1/locations/ufs');
  return res.data;
}

export async function listCities(uf: string, query?: string): Promise<City[]> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockListCities(uf, query);
  }
  const res = await apiGet<{ data: City[] }>(`/api/v1/locations/ufs/${uf}/cities`, { q: query });
  return res.data;
}
