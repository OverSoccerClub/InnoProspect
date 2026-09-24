import type { Metadata } from 'next';

import { NewCampaignForm } from '@/components/campaigns/new-campaign-form';

export const metadata: Metadata = {
  title: 'Nova campanha — InnoProspect',
};

export default function NewCampaignPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Nova campanha</h1>
        <p className="text-sm text-muted-foreground">
          Monte o público, escolha o template e as instâncias. A campanha nasce em rascunho — nada é enviado até você iniciar.
        </p>
      </div>
      <NewCampaignForm />
    </div>
  );
}
