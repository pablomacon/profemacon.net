import { QuestionResources } from "./question-resources";

export type PublicQuestion = {
  number: number;
  type: "radio" | "checkbox" | "text" | "ordenar" | "relacionar";
  prompt: string;
  instructions: string;
  options: unknown[];
  resources: unknown[];
  placeholder: string | null;
  points: number;
  answer: unknown;
};

type Props = {
  question: PublicQuestion;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
  status: "idle" | "saving" | "saved" | "error";
  onRetry: () => void;
};

function option(option: unknown, index: number) {
  if (typeof option === "string") return { value: option, label: option };
  if (option && typeof option === "object") {
    const item = option as { valor?: unknown; texto?: unknown; value?: unknown; label?: unknown };
    const value = typeof item.valor === "string" ? item.valor : typeof item.value === "string" ? item.value : String(index);
    const label = typeof item.texto === "string" ? item.texto : typeof item.label === "string" ? item.label : value;
    return { value, label };
  }
  return { value: String(index), label: String(option) };
}

function SaveStatus({ status, onRetry }: Pick<Props, "status" | "onRetry">) {
  if (status === "saving") return <span className="activity-save-status" aria-live="polite">Guardando…</span>;
  if (status === "saved") return <span className="activity-save-status is-saved" aria-live="polite">Guardado</span>;
  if (status === "error") return <span className="activity-save-status is-error" role="alert">No se pudo guardar <button type="button" onClick={onRetry}>Reintentar</button></span>;
  return null;
}

function RadioQuestion({ question, value, disabled, onChange }: Props) {
  return <fieldset className="activity-choice-list" disabled={disabled}>
    <legend className="sr-only">Opciones para la pregunta {question.number}</legend>
    {question.options.map((entry, index) => {
      const item = option(entry, index);
      return <label key={item.value}><input type="radio" name={`question-${question.number}`} checked={value === item.value} onChange={() => onChange(item.value)} />{item.label}</label>;
    })}
  </fieldset>;
}

function CheckboxQuestion({ question, value, disabled, onChange }: Props) {
  const selected = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return <fieldset className="activity-choice-list" disabled={disabled}>
    <legend className="sr-only">Opciones para la pregunta {question.number}</legend>
    {question.options.map((entry, index) => {
      const item = option(entry, index);
      const checked = selected.includes(item.value);
      return <label key={item.value}><input type="checkbox" checked={checked} onChange={() => onChange(checked ? selected.filter((current) => current !== item.value) : [...selected, item.value])} />{item.label}</label>;
    })}
  </fieldset>;
}

function TextQuestion({ question, value, disabled, onChange }: Props) {
  return <label className="activity-text-answer"><span className="sr-only">Respuesta para la pregunta {question.number}</span><textarea value={typeof value === "string" ? value : ""} placeholder={question.placeholder ?? "Escribí tu respuesta"} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></label>;
}

const renderers = {
  radio: RadioQuestion,
  checkbox: CheckboxQuestion,
  text: TextQuestion,
} as const;

export function QuestionRenderer(props: Props) {
  const Renderer = renderers[props.question.type as keyof typeof renderers];
  return <article className="activity-question" data-question-number={props.question.number}>
    <div className="activity-question-heading"><span aria-hidden="true">{props.question.number}</span><div><h2>Pregunta {props.question.number}</h2><p>{props.question.prompt}</p></div></div>
    {props.question.instructions && <p className="activity-instructions">{props.question.instructions}</p>}
    <QuestionResources resources={props.question.resources} />
    {Renderer ? <Renderer {...props} /> : <p role="alert" className="form-error">Este tipo de pregunta todavía no está disponible.</p>}
    <SaveStatus status={props.status} onRetry={props.onRetry} />
  </article>;
}
