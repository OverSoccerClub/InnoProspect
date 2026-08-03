import { KNOWN_VARIABLES, VARIABLE_LABEL } from '@/lib/spintax';

/** Barra de variáveis permitidas — evita o usuário ter que adivinhar/decorar quais existem (§4.4). */
export function VariablePicker({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Inserir variável">
      {KNOWN_VARIABLES.map((variable) => (
        <button
          key={variable}
          type="button"
          onClick={() => onInsert(`{{${variable}}}`)}
          className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          title={`Inserir {{${variable}}}`}
        >
          {VARIABLE_LABEL[variable]}
        </button>
      ))}
    </div>
  );
}
