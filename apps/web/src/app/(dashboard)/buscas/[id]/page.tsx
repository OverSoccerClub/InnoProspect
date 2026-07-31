import { SearchJobProgress } from '@/components/searches/search-job-progress';

export default async function SearchJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SearchJobProgress id={id} />;
}
