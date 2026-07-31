import { MessageCircle } from 'lucide-react';

import { ComingSoon } from '@/components/common/coming-soon';

export default function WhatsappPage() {
  return (
    <ComingSoon
      icon={MessageCircle}
      title="WhatsApp"
      phase="Chega na Fase 3"
      description="Conectar números via QR Code, acompanhar saúde da conexão e aquecimento (warmup) entram junto com a Evolution API."
    />
  );
}
