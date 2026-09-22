import { CampaignRoadmap } from '@/components/campaigns/campaign-roadmap';
import { PageHeader } from '@/components/common/page-header';

export default function CampanhasPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Campanhas"
        description="Disparo em massa de WhatsApp com cadência anti-ban — o que falta construir, em ordem."
      />
      <CampaignRoadmap />
    </div>
  );
}
