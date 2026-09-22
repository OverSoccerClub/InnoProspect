import Link from 'next/link';
import { ArrowRight, Megaphone } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Stage = {
  title: string;
  description: string;
};

/**
 * As 6 entregas da Fase 4 (ARQUITETURA.md §8, "Campanha com anti-ban de
 * verdade") traduzidas pra linguagem de quem opera o produto, não de quem
 * programa — sem os códigos internos (4.A–4.H) nem nome de responsável.
 * Nenhuma tem data: a ordem é a dependência real entre elas (o motor de
 * disparo, item 5, só pode vir depois da API de campanha e da cadência
 * estarem prontas), não uma promessa de prazo que ninguém confirmou.
 */
const STAGES: Stage[] = [
  {
    title: 'Regras de cadência anti-ban',
    description:
      'A base que decide o ritmo de envio: intervalo variável entre mensagens, micro-pausas e o que é aceitável dentro da janela de horário configurada.',
  },
  {
    title: 'Cadência aplicada ao envio manual',
    description:
      'As mesmas regras passam a valer também pra mensagem avulsa na ficha do lead, com um humano acompanhando — antes de confiar isso a um disparo em massa.',
  },
  {
    title: 'Criar, pausar e cancelar campanhas',
    description:
      'A base de uma campanha (quem entra, quem fica de fora e por quê) sem disparo automático ainda — só a organização.',
  },
  {
    title: 'Montagem e acompanhamento nesta tela',
    description:
      'Ver o alcance antes de criar, iniciar, pausar e retomar uma campanha, com atualização ao vivo do que já foi enviado.',
  },
  {
    title: 'Disparo automático',
    description:
      'O sistema passa a enviar sozinho, respeitando cota diária e janela de horário, e reagindo na hora a um número desconectado ou banido.',
  },
  {
    title: 'Testes de aceite e revisão de segurança',
    description:
      'Confirmar, com número real, que opt-out é respeitado na hora, que ninguém recebe mensagem em dobro se o sistema cair no meio, e que não existe um segundo caminho de envio por fora da checagem de segurança.',
  },
];

export function CampaignRoadmap() {
  return (
    <div className="flex flex-col gap-6">
      <Card variant="flat" className="border-dashed bg-muted/30">
        <CardContent className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Megaphone className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Campanhas ainda não existe — é a Fase 4 do produto.</p>
              <p className="text-sm text-muted-foreground">
                Nenhuma das etapas abaixo tem data confirmada. Hoje você já pode buscar leads e conversar com
                cada um manualmente pelo WhatsApp.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2 text-sm">
            <Link
              href="/leads"
              className="flex items-center gap-1 font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Ver leads
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
        </CardContent>
      </Card>

      <ol className="flex flex-col">
        {STAGES.map((stage, index) => {
          const isLast = index === STAGES.length - 1;
          return (
            <li key={stage.title} className="flex gap-4">
              <div className="flex flex-col items-center">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-border bg-card text-sm font-semibold tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                {!isLast && <span className="my-1 w-px flex-1 bg-border" aria-hidden="true" />}
              </div>
              <div className={cn('flex flex-col gap-1', !isLast && 'pb-6')}>
                <p className="text-sm font-semibold text-foreground">{stage.title}</p>
                <p className="max-w-xl text-sm text-muted-foreground">{stage.description}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
