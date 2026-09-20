export type ActivityQuestionForGrading = {
  id: number;
  numero: number;
  tipo: "radio" | "checkbox" | "text" | "ordenar" | "relacionar";
  puntaje: number;
  claveCorreccionJson: string | null;
  retroalimentacionCorrecta: string;
  retroalimentacionIncorrecta: string;
};

export type GradedAnswer = {
  preguntaId: number;
  numeroPregunta: number;
  respuestaDada: unknown;
  respuestaNormalizada: unknown;
  correcta: boolean;
  puntajeObtenido: number;
  retroalimentacion: string;
};

export type PublicCorrectAnswer =
  | { value: string }
  | { values: string[] };

type CorrectionKey = {
  modo: "opcion" | "seleccion-exacta" | "texto-exacto";
  correctas?: string[];
  aceptadas?: string[];
};

const normalizeText = (value: unknown) => typeof value === "string" ? value.trim() : "";
const normalizedSelection = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim().length > 0)) return null;
  const normalized = value.map((item) => item.trim());
  if (new Set(normalized).size !== normalized.length) return null;
  return normalized.sort();
};
const sameList = (left: string[], right: string[]) => left.length === right.length && left.every((item, index) => item === right[index]);

function correctionKeyFor(question: ActivityQuestionForGrading): CorrectionKey {
  if (!question.claveCorreccionJson) {
    throw new Error(`La pregunta ${question.numero} no tiene una clave privada de corrección.`);
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(question.claveCorreccionJson);
  } catch {
    throw new Error(`La pregunta ${question.numero} tiene una clave privada de corrección inválida.`);
  }

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`La pregunta ${question.numero} tiene una clave privada de corrección inválida.`);
  }

  const key = candidate as Partial<CorrectionKey>;
  const nonEmptyStrings = (values: unknown): values is string[] => Array.isArray(values)
    && values.length > 0
    && values.every((value) => typeof value === "string" && value.length > 0 && value === value.trim());

  const valid = question.tipo === "radio"
    ? key.modo === "opcion" && nonEmptyStrings(key.correctas) && key.correctas.length === 1
    : question.tipo === "checkbox"
      ? key.modo === "seleccion-exacta" && nonEmptyStrings(key.correctas) && new Set(key.correctas).size === key.correctas.length
      : question.tipo === "text"
        ? key.modo === "texto-exacto" && nonEmptyStrings(key.aceptadas)
        : false;

  if (!valid) {
    throw new Error(`La pregunta ${question.numero} combina un tipo y una clave de corrección incompatibles.`);
  }

  return key as CorrectionKey;
}

// Frontera explícita entre la clave privada del corrector y la solución que
// puede mostrarse, sólo tras la autorización de revisión final.
export function publicCorrectAnswerForReview(question: ActivityQuestionForGrading): PublicCorrectAnswer {
  const key = correctionKeyFor(question);
  if (question.tipo === "radio") return { value: key.correctas![0] };
  if (question.tipo === "checkbox") return { values: [...key.correctas!].sort() };
  if (question.tipo === "text") return { values: [...key.aceptadas!] };
  throw new Error(`El tipo de pregunta ${question.tipo} todavía no tiene revisión pública.`);
}

export function gradeActivity(questions: ActivityQuestionForGrading[], answers: Record<string, unknown>) {
  if (questions.length === 0) throw new Error("La actividad no contiene preguntas para corregir.");

  const gradedAnswers: GradedAnswer[] = questions.map((question) => {
    if (!Number.isSafeInteger(question.puntaje) || question.puntaje <= 0) {
      throw new Error(`La pregunta ${question.numero} tiene un puntaje inválido.`);
    }
    const key = correctionKeyFor(question);
    const answer = answers[String(question.numero)];
    const selection = question.tipo === "checkbox" ? normalizedSelection(answer) : null;
    const normalized = question.tipo === "checkbox" ? selection : normalizeText(answer);
    const correct = key.modo === "seleccion-exacta"
      ? selection !== null && sameList(selection, [...(key.correctas ?? [])].sort())
      : key.modo === "texto-exacto"
        ? (key.aceptadas ?? []).includes(normalizeText(answer))
        : (key.correctas ?? []).includes(normalizeText(answer));

    return {
      preguntaId: question.id,
      numeroPregunta: question.numero,
      respuestaDada: answer ?? null,
      respuestaNormalizada: normalized,
      correcta: correct,
      puntajeObtenido: correct ? question.puntaje : 0,
      retroalimentacion: correct ? question.retroalimentacionCorrecta : question.retroalimentacionIncorrecta,
    };
  });

  const score = gradedAnswers.reduce((total, answer) => total + answer.puntajeObtenido, 0);
  const total = questions.reduce((sum, question) => sum + question.puntaje, 0);
  if (!Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(score)) {
    throw new Error("La actividad tiene un puntaje total inválido.");
  }
  return { gradedAnswers, score, total, percentage: Math.round((score / total) * 100) };
}
