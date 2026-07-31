import { Megaphone } from 'lucide-react';

import { ComingSoon } from '@/components/common/coming-soon';

export default function CampanhasPage() {
  return (
    <ComingSoon
      icon={Megaphone}
      title="Campanhas"
      phase="Chega na Fase 4"
      description="Montagem de campanha, cadência anti-ban e acompanhamento ao vivo do disparo entram depois que o envio manual (Fase 3) estiver validado."
    />
  );
}
