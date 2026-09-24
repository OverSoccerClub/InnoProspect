'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { CampaignAudienceBuilder, EMPTY_CAMPAIGN_AUDIENCE, type CampaignAudienceValue } from '@/components/campaigns/campaign-audience-builder';
import { CampaignInstancePicker } from '@/components/campaigns/campaign-instance-picker';
import {
  CampaignSettingsFields,
  DEFAULT_CAMPAIGN_SETTINGS_FORM,
  toCampaignSettingsInput,
  type CampaignSettingsFormState,
} from '@/components/campaigns/campaign-settings-fields';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useTemplates } from '@/hooks/useTemplates';
import { createCampaign } from '@/lib/api/campaigns';
import { saveCampaignCreationSummary } from '@/lib/campaign-creation-cache';
import { ApiRequestError } from '@/lib/fetcher';
import { toApiLeadFilter } from '@/lib/lead-filter-state';
import type { CampaignAudienceSummary } from '@/types/campaign';

const NAME_MIN = 3;
const NAME_MAX = 120;

function describeCreateError(err: ApiRequestError): string {
  switch (err.reason) {
    case 'EMPTY_AUDIENCE':
      return 'Nenhum lead elegível sobrou depois dos filtros de exclusão — ajuste o público antes de tentar de novo.';
    case 'AUDIENCE_TOO_LARGE':
      return err.message;
    case 'TEMPLATE_NOT_FOUND':
      return 'O template escolhido não foi encontrado — atualize a página e escolha outro.';
    case 'INSTANCE_NOT_FOUND':
      return 'Uma das instâncias escolhidas não foi encontrada — atualize a página e revise a seleção.';
    default:
      return err.message;
  }
}

export function NewCampaignForm() {
  const router = useRouter();
  const { response: templatesResponse, isLoading: isLoadingTemplates } = useTemplates();
  const activeTemplates = (templatesResponse?.data ?? []).filter((t) => t.isActive);

  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [instanceIds, setInstanceIds] = useState<string[]>([]);
  const [audience, setAudience] = useState<CampaignAudienceValue>(EMPTY_CAMPAIGN_AUDIENCE);
  const [audienceSummary, setAudienceSummary] = useState<CampaignAudienceSummary | null>(null);
  const [settings, setSettings] = useState<CampaignSettingsFormState>(DEFAULT_CAMPAIGN_SETTINGS_FORM);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedTemplate = activeTemplates.find((t) => t.id === templateId) ?? null;

  function validate(): boolean {
    const errors: Record<string, string> = {};
    const trimmed = name.trim();
    if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) {
      errors.name = `O nome precisa ter entre ${NAME_MIN} e ${NAME_MAX} caracteres.`;
    }
    if (!templateId) errors.templateId = 'Escolha um template.';
    if (instanceIds.length === 0) errors.instanceIds = 'Escolha pelo menos uma instância de WhatsApp conectada.';
    if (settings.jitterMax < settings.jitterMin) errors.jitterSeconds = 'O intervalo máximo precisa ser maior ou igual ao mínimo.';
    if (settings.daysOfWeek.length === 0) errors.daysOfWeek = 'Escolha pelo menos um dia da semana.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const response = await createCampaign({
        name: name.trim(),
        templateId,
        instanceIds,
        audience: audience.mode === 'ids' ? { mode: 'ids', leadIds: audience.leadIds } : { mode: 'filter', filter: toApiLeadFilter(audience.filter) },
        settings: toCampaignSettingsInput(settings),
      });
      saveCampaignCreationSummary(response);
      router.push(`/campanhas/${response.id}`);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === 'VALIDATION_ERROR' && err.details) {
          const errors: Record<string, string> = {};
          for (const d of err.details) errors[d.path] = d.message;
          setFieldErrors((prev) => ({ ...prev, ...errors }));
        }
        setFormError(describeCreateError(err));
      } else {
        setFormError('Não foi possível criar a campanha agora. Tente novamente.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const canSubmit = Boolean(name.trim() && templateId && instanceIds.length > 0 && audienceSummary && audienceSummary.eligible > 0);

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      {formError && (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <Alert variant="warning">
        <AlertDescription>
          Esta campanha monta o público e materializa a lista de alvos — ela <strong>não dispara sozinha</strong>. Depois de criada, você inicia
          manualmente e envia cada mensagem com um clique (não existe motor automático nesta versão).
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detalhes da campanha</CardTitle>
          <CardDescription>Nome, template e instâncias que vão disparar.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-name">Nome *</Label>
            <Input
              id="campaign-name"
              placeholder="Ex.: Clínicas odontológicas — SP, setembro"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? 'campaign-name-error' : undefined}
            />
            {fieldErrors.name && (
              <p id="campaign-name-error" className="text-sm text-destructive">
                {fieldErrors.name}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-template">Template *</Label>
            {isLoadingTemplates ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select
                id="campaign-template"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                aria-invalid={Boolean(fieldErrors.templateId)}
              >
                <option value="">Selecione…</option>
                {activeTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.spintaxVariations} variação(ões)
                  </option>
                ))}
              </Select>
            )}
            {fieldErrors.templateId && <p className="text-sm text-destructive">{fieldErrors.templateId}</p>}
            {selectedTemplate && selectedTemplate.spintaxVariations < 10 && (
              <p className="text-xs text-warning">
                Este template gera só {selectedTemplate.spintaxVariations} variação(ões) — campanhas com mais de 50 alvos exigem pelo menos 10
                para não parecer robô. O início será recusado se o público final passar disso.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Instâncias de WhatsApp *</Label>
            <CampaignInstancePicker selected={instanceIds} onChange={setInstanceIds} />
            {fieldErrors.instanceIds && <p className="text-sm text-destructive">{fieldErrors.instanceIds}</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Público</CardTitle>
          <CardDescription>Quem entra na campanha — o corte é mostrado com cada motivo de exclusão, antes de criar.</CardDescription>
        </CardHeader>
        <CardContent>
          <CampaignAudienceBuilder
            value={audience}
            onChange={setAudience}
            skipRecentlyContactedDays={settings.skipRecentlyContactedDays}
            onSummaryChange={setAudienceSummary}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cadência</CardTitle>
          <CardDescription>Ritmo de envio anti-ban — pré-preenchido com valores seguros.</CardDescription>
        </CardHeader>
        <CardContent>
          <CampaignSettingsFields value={settings} onChange={setSettings} errors={fieldErrors} />
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isSubmitting || !canSubmit}>
          {isSubmitting && <Loader2 className="animate-spin" aria-hidden="true" />}
          {isSubmitting ? 'Criando…' : 'Criar campanha'}
        </Button>
        <p className="text-sm text-muted-foreground">Cria em rascunho — você ainda decide quando iniciar.</p>
      </div>
    </form>
  );
}
