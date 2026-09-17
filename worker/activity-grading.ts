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

type CorrectionKey = {
  modo: "opcion" | "seleccion-exacta" | "texto-exacto";
  correctas?: string[];
  aceptadas?: string[];
};

const normalizeText = (value: unknown) => typeof value === "string" ? value.trim() : "";
const normalizedSelection = (value: unknown) => Array.isArray(value) ? [...new Set(value.map(normalizeText).filter(Boolean))].sort() : [];
const sameList = (left: string[], right: string[]) => left.length === right.length && left.every((item, index) => item === right[index]);

export function gradeActivity(questions: ActivityQuestionForGrading[], answers: Record<string, unknown>) {
  const gradedAnswers: GradedAnswer[] = questions.map((question) => {
    if (!question.claveCorreccionJson) throw new Error(`La pregunta ${question.numero} no tiene una clave privada de corrección.`);
    const key = JSON.parse(question.claveCorreccionJson) as CorrectionKey;
    const answer = answers[String(question.numero)];
    const normalized = question.tipo === "checkbox" ? normalizedSelection(answer) : normalizeText(answer);
    const correct = key.modo === "seleccion-exacta"
      ? sameList(normalizedSelection(answer), [...(key.correctas ?? [])].sort())
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
  return { gradedAnswers, score, total, percentage: Math.round((score / total) * 100) };
}
