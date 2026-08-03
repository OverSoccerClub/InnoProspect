'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Info, Loader2 } from 'lucide-react';

import { ErrorState } from '@/components/common/error-state';
import { TemplatePreview } from '@/components/templates/template-preview';
import { VariablePicker } from '@/components/templates/variable-picker';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { createTemplate, getTemplate, patchTemplate } from '@/lib/api/templates';
import { ApiRequestError } from '@/lib/fetcher';
import { checkSpintaxSyntax, findUnknownVariables } from '@/lib/spintax';
import { cn } from '@/lib/utils';

const NAME_MIN = 3;
const NAME_MAX = 80;
const BODY_MIN = 10;
const BODY_MAX = 4000;

export function TemplateEditor({ id }: { id: string }) {
  const router = useRouter();
  const isCreate = id === 'novo';

  const [isLoading, setIsLoading] = useState(!isCreate);
  const [loadError, setLoadError] = useState<Error | null>(null);

  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [formWarning, setFormWarning] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isCreate) return;
    let cancelled = false;
    setIsLoading(true);
    getTemplate(id)
      .then((template) => {
        if (cancelled) return;
        setName(template.name);
        setBody(template.body);
        setIsActive(template.isActive);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err : new Error('Não foi possível carregar o template.'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, isCreate]);

  function insertVariable(token: string) {
    const textarea = textareaRef.current;
    if (!textarea) {
      setBody((prev) => prev + token);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + token.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  function validate(): boolean {
    const errors: Record<string, string> = {};
    const trimmedName = name.trim();
    if (trimmedName.length < NAME_MIN || trimmedName.length > NAME_MAX) {
      errors.name = `O nome precisa ter entre ${NAME_MIN} e ${NAME_MAX} caracteres.`;
    }
    if (body.trim().length < BODY_MIN || body.length > BODY_MAX) {
      errors.body = `A mensagem precisa ter entre ${BODY_MIN} e ${BODY_MAX} caracteres.`;
    }
    const syntaxIssues = checkSpintaxSyntax(body);
    if (syntaxIssues.length > 0) {
      errors.body = syntaxIssues[0]?.message ?? 'Sintaxe de variação inválida.';
    }
    const unknown = findUnknownVariables(body);
    if (unknown.length > 0) {
      errors.body = `Variável desconhecida: {{${unknown[0]}}}. Use uma das variáveis sugeridas abaixo.`;
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFormWarning(null);
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const result = isCreate
        ? await createTemplate({ name: name.trim(), body, isActive })
        : await patchTemplate(id, { name: name.trim(), body, isActive });

      if (result.warnings && result.warnings.length > 0) {
        // fica na tela em vez de navegar — o aviso só é útil se o usuário conseguir vê-lo e ajustar ali mesmo
        setFormWarning(result.warnings[0]?.message ?? null);
        if (isCreate) router.replace(`/templates/${result.id}`);
        return;
      }
      router.push('/templates');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === 'VALIDATION_ERROR' && err.details) {
          const errors: Record<string, string> = {};
          for (const d of err.details) errors[d.path] = d.message;
          setFieldErrors((prev) => ({ ...prev, ...errors }));
        }
        setFormError(err.message);
      } else {
        setFormError('Não foi possível salvar o template agora. Tente novamente.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (loadError) {
    const notFound = loadError instanceof ApiRequestError && loadError.code === 'NOT_FOUND';
    return (
      <ErrorState
        title={notFound ? 'Template não encontrado' : 'Não foi possível carregar o template'}
        message={loadError.message}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {isCreate ? 'Novo template' : 'Editar template'}
        </h1>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => router.push('/templates')}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" aria-hidden="true" />}
            {isSubmitting ? 'Salvando…' : 'Salvar template'}
          </Button>
        </div>
      </div>

      {formError && (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      {formWarning && (
        <Alert variant="warning">
          <AlertTitle>Salvo, mas com um alerta</AlertTitle>
          <AlertDescription>{formWarning}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-name">Nome *</Label>
            <Input
              id="template-name"
              placeholder="Ex.: Primeiro contato — clínicas"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? 'template-name-error' : undefined}
            />
            {fieldErrors.name && (
              <p id="template-name-error" className="text-sm text-destructive">
                {fieldErrors.name}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="template-body">Mensagem *</Label>
              <span className="text-xs text-muted-foreground">{body.length}/{BODY_MAX}</span>
            </div>
            <VariablePicker onInsert={insertVariable} />
            <textarea
              id="template-body"
              ref={textareaRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder="Ex.: {Olá|Oi}, tudo bem? Aqui é da {{minha_empresa}}. Vi que a {{nome}} atua em {{cidade}}..."
              aria-invalid={Boolean(fieldErrors.body)}
              aria-describedby={fieldErrors.body ? 'template-body-error' : 'template-body-hint'}
              className={cn(
                'flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm leading-relaxed shadow-xs transition-shadow placeholder:text-muted-foreground hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
                fieldErrors.body && 'border-destructive focus-visible:ring-destructive',
              )}
            />
            {fieldErrors.body ? (
              <p id="template-body-error" className="text-sm text-destructive">
                {fieldErrors.body}
              </p>
            ) : (
              <p id="template-body-hint" className="text-sm text-muted-foreground">
                Use {'{opção a|opção b}'} para variar o texto a cada envio — dificulta que o WhatsApp identifique a
                mensagem como disparo em massa.
              </p>
            )}
          </div>

          <label className="flex w-fit items-center gap-2 text-sm">
            <Checkbox checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Template ativo (disponível para novas campanhas)
          </label>

          <Alert>
            <Info />
            <AlertTitle>Se este for o primeiro contato de uma campanha</AlertTitle>
            <AlertDescription>
              Inclua <code>{'{{minha_empresa}}'}</code> e uma instrução clara de descadastro, ex.: &ldquo;Se
              preferir não receber mais mensagens, responda SAIR.&rdquo; O sistema exige isso antes de iniciar a
              campanha (LGPD, ARQUITETURA.md §7.4).
            </AlertDescription>
          </Alert>
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <TemplatePreview body={body} />
        </div>
      </div>
    </form>
  );
}
