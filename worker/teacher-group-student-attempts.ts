import { publicCorrectAnswerForReview, type ActivityQuestionForGrading, type PublicCorrectAnswer } from "./activity-grading";
import { requireTeacherGroupStudentActivityScope } from "./teacher-group-scope";

// C4 es un endpoint de sólo lectura para diagnóstico docente: muestra qué hizo
// exactamente un estudiante en cada intento enviado de una actividad.
// Reconstruye la historia exclusivamente desde los snapshots del intento y desde
// el resultado ya persistido: nunca desde la versión actual de la pregunta, nunca
// recalculando el juicio y nunca exponiendo la clave privada de corrección. Los
// intentos anulados y el borrador aportan sólo trazabilidad, sin evidencia
// parcial: un anulado nunca fue entregado y un borrador todavía no lo fue.

type AttemptHeaderRow = {
  attemptId: number;
  number: number;
  ordinal: number | null;
  state: "en_progreso" | "enviado" | "anulado";
  score: number;
  total: number;
  percentage: number;
  judgment: "inicial" | "en_proceso" | "logrado";
  submittedAt: string;
};

type AttemptQuestionRow = {
  attemptId: number;
  number: number;
  type: TeacherAttemptQuestionType;
  prompt: string;
  maxPoints: number;
  optionsJson: string;
  keyJson: string | null;
  explanation: string | null;
  answerJson: string | null;
  correct: number | null;
  pointsAwarded: number | null;
};

export type TeacherAttemptQuestionType = "radio" | "checkbox" | "text" | "ordenar" | "relacionar";

type TeacherAttemptActivityRow = {
  activityId: number;
  slug: string;
  title: string;
  unitCode: string | null;
  editorialState: string;
  availabilityStatus: "disabled" | "not_open" | "closed" | "available";
  maxAttempts: number;
};

// Representación pedagógica de una respuesta: sólo texto visible o listas de
// textos del snapshot. Nunca la estructura privada de corrección.
export type TeacherAttemptAnswer = { value: string } | { values: string[] };

export type TeacherAttemptQuestion = {
  number: number;
  type: TeacherAttemptQuestionType;
  prompt: string;
  maxPoints: number;
  answered: boolean;
  correct: boolean;
  pointsAwarded: number;
  answer: TeacherAttemptAnswer | null;
  expected: TeacherAttemptAnswer | null;
  explanation: string | null;
};

export type TeacherSubmittedAttempt = {
  attemptId: number;
  number: number;
  ordinal: number | null;
  score: number;
  total: number;
  percentage: number;
  judgment: "inicial" | "en_proceso" | "logrado";
  submittedAt: string;
  isBest: boolean;
  questions: TeacherAttemptQuestion[];
};

export type TeacherAnnulledAttempt = {
  attemptId: number;
  number: number;
  ordinal: number | null;
  state: "anulado";
  // El esquema no guarda el momento de la anulación: para estos intentos
  // `enviado_en` es la fecha de alta del intento y nunca una entrega.
  startedAt: string;
  countsForResults: false;
};

export type TeacherAttemptsSummary = {
  attemptsUsed: number;
  submittedCount: number;
  annulledCount: number;
  best: null | {
    attemptId: number;
    ordinal: number | null;
    percentage: number;
    score: number;
    total: number;
    judgment: "inicial" | "en_proceso" | "logrado";
    submittedAt: string;
  };
  judgment: "inicial" | "en_proceso" | "logrado" | null;
  lastSubmittedAt: string | null;
  hasDraft: boolean;
  draftStartedAt: string | null;
};

function jsonArray(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function optionRaw(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    const item = entry as { valor?: unknown; value?: unknown };
    if (typeof item.valor === "string") return item.valor;
    if (typeof item.value === "string") return item.value;
  }
  return null;
}

function optionPosition(options: unknown[], value: string): number {
  return options.findIndex((entry) => optionRaw(entry) === value);
}

// Resuelve el valor interno de una opción a su texto visible usando el snapshot
// del intento. Sólo lee `opciones_snapshot_json`, que ya era público para el
// estudiante, y no expone ninguna otra metadata.
function optionLabel(options: unknown[], value: string): string {
  const position = optionPosition(options, value);
  if (position < 0) return value;
  const entry = options[position];
  if (entry && typeof entry === "object") {
    const item = entry as { texto?: unknown; label?: unknown };
    const label = typeof item.texto === "string" ? item.texto : typeof item.label === "string" ? item.label : null;
    if (label && label.trim().length > 0) return label;
  }
  return value;
}

// Orden estable y pedagógicamente coherente: el orden de las opciones del
// snapshot. Los valores ausentes del snapshot quedan al final sin reordenarse.
function labelsFor(options: unknown[], values: string[]): string[] {
  return values
    .map((value, index) => ({ value, index, position: optionPosition(options, value) }))
    .sort((left, right) => {
      const leftMissing = left.position < 0;
      const rightMissing = right.position < 0;
      if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
      if (!leftMissing && left.position !== right.position) return left.position - right.position;
      return left.index - right.index;
    })
    .map((entry) => optionLabel(options, entry.value));
}

function parseStoredAnswer(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

// La ausencia de respuesta es explícita: nunca se representa con cadena vacía.
function isMissingAnswer(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function publicStoredAnswer(type: TeacherAttemptQuestionType, stored: unknown, options: unknown[]): TeacherAttemptAnswer | null {
  if (isMissingAnswer(stored)) return null;
  if (typeof stored === "string") return { value: optionLabel(options, stored) };
  if (Array.isArray(stored) && stored.every((item) => typeof item === "string")) {
    const values = stored as string[];
    // El checkbox es un conjunto: se muestra en el orden de las opciones del
    // snapshot. Cualquier otra lista es una secuencia (por ejemplo `ordenar`) y se
    // conserva tal como quedó almacenada, sin reinterpretarla.
    return {
      values: type === "checkbox" ? labelsFor(options, values) : values.map((value) => optionLabel(options, value)),
    };
  }
  // Formas no representables de forma segura (por ejemplo un tipo todavía sin
  // revisión): se omite la representación en lugar de inventar estructura.
  return null;
}

// Frontera privada -> pedagógica: se reutiliza `publicCorrectAnswerForReview`,
// la única función autorizada a interpretar la clave privada. Si el tipo todavía
// no tiene revisión pública, o el snapshot no trae una clave válida, la pregunta
// se degrada con `expected: null` sin romper el resto de la respuesta.
function publicExpected(question: ActivityQuestionForGrading, options: unknown[]): TeacherAttemptAnswer | null {
  let expected: PublicCorrectAnswer;
  try {
    expected = publicCorrectAnswerForReview(question);
  } catch {
    return null;
  }
  if ("value" in expected) return { value: optionLabel(options, expected.value) };
  return { values: labelsFor(options, expected.values) };
}

function publicQuestion(row: AttemptQuestionRow): TeacherAttemptQuestion {
  const options = jsonArray(row.optionsJson);
  const answer = publicStoredAnswer(row.type, parseStoredAnswer(row.answerJson), options);
  const gradingQuestion: ActivityQuestionForGrading = {
    id: row.number,
    numero: row.number,
    tipo: row.type,
    puntaje: row.maxPoints,
    claveCorreccionJson: row.keyJson,
    retroalimentacionCorrecta: "",
    retroalimentacionIncorrecta: "",
  };
  return {
    number: row.number,
    type: row.type,
    prompt: row.prompt,
    maxPoints: row.maxPoints,
    answered: answer !== null,
    correct: row.correct === 1,
    pointsAwarded: row.pointsAwarded ?? 0,
    answer,
    expected: publicExpected(gradingQuestion, options),
    explanation: row.explanation,
  };
}

export async function getTeacherGroupStudentAttempts(db: D1Database, userId: number, groupId: number, studentId: number, activityId: number) {
  // El alcance compone grupo autorizado + membresía activa del estudiante +
  // actividad de la misma edición anual antes de leer cualquier intento.
  const { group, student } = await requireTeacherGroupStudentActivityScope(db, userId, groupId, studentId, activityId);

  // Tres consultas acotadas e independientes de la cantidad de intentos y
  // preguntas: encabezado de la actividad, cabeceras de los intentos y el detalle
  // de todos los intentos enviados en una sola lectura. Se evita cualquier N+1 y
  // toda consulta vuelve a filtrar grupo + estudiante + actividad (nunca sólo el
  // id del intento).
  const [activity, attempts, questionRows] = await Promise.all([
    db.prepare(`
      SELECT
        a.id AS activityId, a.slug, a.titulo AS title, a.unidad_codigo AS unitCode,
        a.estado AS editorialState, a.maximo_intentos AS maxAttempts,
        CASE
          WHEN h.id IS NULL OR h.habilitada = 0 THEN 'disabled'
          WHEN h.disponible_desde IS NOT NULL AND datetime(h.disponible_desde) > datetime('now') THEN 'not_open'
          WHEN h.disponible_hasta IS NOT NULL AND datetime(h.disponible_hasta) < datetime('now') THEN 'closed'
          ELSE 'available'
        END AS availabilityStatus
      FROM actividades a
      LEFT JOIN habilitaciones_actividad h ON h.actividad_id = a.id AND h.grupo_id = ?1
      WHERE a.id = ?2
    `).bind(groupId, activityId).first<TeacherAttemptActivityRow>(),
    db.prepare(`
      SELECT
        i.id AS attemptId, i.numero_intento AS number, i.ordinal_efectivo AS ordinal,
        i.estado AS state, i.puntaje_obtenido AS score, i.puntaje_total AS total,
        i.porcentaje AS percentage, i.juicio AS judgment, i.enviado_en AS submittedAt
      FROM intentos_actividad i
      JOIN habilitaciones_actividad h ON h.id = i.habilitacion_id
      WHERE h.grupo_id = ?1 AND i.usuario_id = ?2 AND i.actividad_id = ?3
      ORDER BY i.enviado_en ASC, i.id ASC
    `).bind(groupId, studentId, activityId).all<AttemptHeaderRow>(),
    db.prepare(`
      SELECT
        i.id AS attemptId, p.numero_pregunta AS number, p.tipo_pregunta AS type,
        p.enunciado_snapshot AS prompt, p.puntaje_maximo AS maxPoints,
        p.opciones_snapshot_json AS optionsJson, p.clave_correccion_snapshot_json AS keyJson,
        p.explicacion_revision_final_snapshot AS explanation,
        r.respuesta_dada_json AS answerJson, r.correcta AS correct, r.puntaje_obtenido AS pointsAwarded
      FROM intentos_actividad i
      JOIN habilitaciones_actividad h ON h.id = i.habilitacion_id
      JOIN preguntas_intento_actividad p ON p.intento_id = i.id
      LEFT JOIN respuestas_intento_actividad r
        ON r.intento_id = i.id AND r.pregunta_id = p.pregunta_origen_id
      WHERE h.grupo_id = ?1 AND i.usuario_id = ?2 AND i.actividad_id = ?3 AND i.estado = 'enviado'
      ORDER BY i.enviado_en ASC, i.id ASC, p.numero_pregunta ASC
    `).bind(groupId, studentId, activityId).all<AttemptQuestionRow>(),
  ]);

  const questionsByAttempt = new Map<number, AttemptQuestionRow[]>();
  for (const row of questionRows.results) {
    const list = questionsByAttempt.get(row.attemptId);
    if (list) list.push(row);
    else questionsByAttempt.set(row.attemptId, [row]);
  }

  const submitted = attempts.results.filter((attempt) => attempt.state === "enviado");
  const annulled = attempts.results.filter((attempt) => attempt.state === "anulado");
  const draft = attempts.results.find((attempt) => attempt.state === "en_progreso") ?? null;

  // Mismo criterio de mejor intento que C1/C2/C3 (porcentaje DESC, puntaje DESC,
  // entrega ASC) con id ASC como desempate técnico final. Se evalúa sobre el
  // conjunto completo de enviados, que ya está en memoria.
  const best = [...submitted].sort((left, right) => (
    right.percentage - left.percentage
    || right.score - left.score
    || left.submittedAt.localeCompare(right.submittedAt)
    || left.attemptId - right.attemptId
  ))[0] ?? null;

  const submittedAttempts: TeacherSubmittedAttempt[] = submitted.map((attempt) => ({
    attemptId: attempt.attemptId,
    number: attempt.number,
    ordinal: attempt.ordinal,
    score: attempt.score,
    total: attempt.total,
    percentage: attempt.percentage,
    judgment: attempt.judgment,
    submittedAt: attempt.submittedAt,
    isBest: best !== null && best.attemptId === attempt.attemptId,
    questions: (questionsByAttempt.get(attempt.attemptId) ?? []).map(publicQuestion),
  }));

  const summary: TeacherAttemptsSummary = {
    attemptsUsed: attempts.results.filter((attempt) => attempt.state !== "anulado").length,
    submittedCount: submitted.length,
    annulledCount: annulled.length,
    best: best ? {
      attemptId: best.attemptId,
      ordinal: best.ordinal,
      percentage: best.percentage,
      score: best.score,
      total: best.total,
      judgment: best.judgment,
      submittedAt: best.submittedAt,
    } : null,
    judgment: best ? best.judgment : null,
    lastSubmittedAt: submitted.length > 0 ? submitted[submitted.length - 1].submittedAt : null,
    hasDraft: draft !== null,
    draftStartedAt: draft ? draft.submittedAt : null,
  };

  return {
    group,
    student,
    activity,
    summary,
    submittedAttempts,
    annulledAttempts: annulled.map((attempt): TeacherAnnulledAttempt => ({
      attemptId: attempt.attemptId,
      number: attempt.number,
      ordinal: attempt.ordinal,
      state: "anulado",
      startedAt: attempt.submittedAt,
      countsForResults: false,
    })),
    defaultAttemptId: best ? best.attemptId : null,
  };
}
