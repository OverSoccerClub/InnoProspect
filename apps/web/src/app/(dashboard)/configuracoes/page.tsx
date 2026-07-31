import { Settings } from 'lucide-react';

import { ComingSoon } from '@/components/common/coming-soon';

export default function ConfiguracoesPage() {
  return (
    <ComingSoon
      icon={Settings}
      title="Configurações"
      phase="Chega nas próximas fases"
      description="Preferências da conta, opt-outs e outras configurações do sistema vão aparecer aqui conforme as áreas relacionadas forem entregues."
    />
  );
}
