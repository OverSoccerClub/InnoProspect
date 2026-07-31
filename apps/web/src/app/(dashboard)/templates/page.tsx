import { MessageSquareText } from 'lucide-react';

import { ComingSoon } from '@/components/common/coming-soon';

export default function TemplatesPage() {
  return (
    <ComingSoon
      icon={MessageSquareText}
      title="Templates"
      phase="Chega na Fase 3"
      description="O editor de templates com variáveis, spintax e preview entra junto com a conexão de WhatsApp."
    />
  );
}
