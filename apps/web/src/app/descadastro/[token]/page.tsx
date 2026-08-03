import type { Metadata } from 'next';

import { UnsubscribeView } from '@/components/public/unsubscribe-view';

export const metadata: Metadata = {
  title: 'Cancelar recebimento de mensagens — InnoProspect',
  robots: { index: false, follow: false },
};

export default async function DescadastroPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <UnsubscribeView token={token} />;
}
