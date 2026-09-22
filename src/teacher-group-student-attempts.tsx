import { useEffect, useMemo, useState } from "react";
import {
  activityAvailabilityText,
  formatLocalDateTime,
  judgmentText,
  percentText,
  type TeacherResultActivity,
  type TeacherResultGroup,
  type TeacherResultJudgment,
  type TeacherResultStudent,
} from "./teacher-results-shared";

// Detalle de los intentos y respuestas de un estudiante en una actividad (C4).
// Es una vista de sólo lectura para diagnóstico docente: muestra exactamente lo
// que el backend ya persistió y saneó. No recalcula juicios, no interpreta la
// evolución, no compara intentos, no ofrece acciones administrativas y no
// inventa retroalimentación.

export type TeacherAttemptQuestionType = "radio" | "checkbox" | "text" | "ordenar" | "relacionar";

// Representación pedagógica: valor o lista de textos visibles. Nunca la
// estructura privada de corrección.
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
  judgment: TeacherResultJudgment;
  submittedAt: string;
  isBest: boolean;
  questions: TeacherAttemptQuestion[];
};

export type TeacherAnnulledAttempt = {
  attemptId: number;
  number: number;
  ordinal: number | null;
  state: "anulado";
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
    judgment: TeacherResultJudgment;
    submittedAt: string;
  };
  judgment: TeacherResultJudgment | null;
  lastSubmittedAt: string | null;
  hasDraft: boolean;
  draftStartedAt: string | null;
};

export type TeacherAttemptsPayload = {
  group: TeacherResultGroup;
  student: TeacherResultStudent;
  activity: Omit<TeacherResultActivity, "id"> & { activityId: number };
  summary: TeacherAttemptsSummary;
  submittedAttempts: TeacherSubmittedAttempt[];
  annulledAttempts: TeacherAnnulledAttempt[];
  defaultAttemptId: number | null;
};

const questionTypeText: Record<TeacherAttemptQuestionType, string> = {
  radio: "Opción única",
  checkbox: "Selección múltiple",
  text: "Respuesta escrita",
  ordenar: "Ordenamiento",
  relacionar: "Relacionar",
};

// `ordinal` es el rótulo pedagógico visible y puede reutilizarse tras una
// anulación; `number` es la secuencia histórica del registro. No se asumen
// equivalentes: cuando el ordinal no existe se rotula como registro.
function attemptLabel(attempt: { ordinal: number | null; number: number }): string {
  return attempt.ordinal === null ? `Registro de intento ${attempt.number}` : `Intento ${attempt.ordinal}`;
}

// La lista de referencias aceptadas sólo se anuncia como tal cuando hay más de
// una: con una sola, es la respuesta esperada.
function expectedLabel(question: TeacherAttemptQuestion): string {
  if (question.type === "text" && question.expected !== null && "values" in question.expected && question.expected.values.length > 1) {
    return "Referencias aceptadas";
  }
  return "Respuesta esperada";
}

async function get<T>(url: string) {
  const response = await fetch(url);
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "No fue posible consultar los intentos del estudiante.");
  return body;
}

// La respuesta dada y la esperada se distinguen por su encabezado y por el texto
// visible; el color nunca es la única señal.
function AnswerBody({ answer, emptyText }: { answer: TeacherAttemptAnswer | null; emptyText: string }) {
  if (answer === null) return <span className="attempt-answer-empty">{emptyText}</span>;
  if ("value" in answer) return <span className="attempt-answer-value">{answer.value}</span>;
  return (
    <ul className="attempt-answer-list">
      {answer.values.map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}
    </ul>
  );
}

function QuestionCard({ question }: { question: TeacherAttemptQuestion }) {
  return (
    <article className="activity-question attempt-question">
      <div className="attempt-question-heading">
        <h3>Pregunta {question.number}</h3>
        <span className={`attempt-question-result ${question.correct ? "is-correct" : "is-incorrect"}`}>
          {question.correct ? "Correcta" : "Incorrecta"}
        </span>
        <span className="attempt-question-points">{question.pointsAwarded} / {question.maxPoints} puntos</span>
        <span className="attempt-question-type">{questionTypeText[question.type] ?? question.type}</span>
      </div>
      <p className="attempt-question-prompt">{question.prompt}</p>
      <dl className="attempt-question-answers">
        <dt>Respuesta del estudiante</dt>
        <dd><AnswerBody answer={question.answer} emptyText="Sin respuesta" /></dd>
        <dt>{expectedLabel(question)}</dt>
        <dd>
          <AnswerBody
            answer={question.expected}
            emptyText="Respuesta esperada no disponible para este tipo de pregunta"
          />
        </dd>
      </dl>
      {question.explanation !== null && question.explanation.trim().length > 0 && (
        <p className="attempt-question-explanation"><strong>Explicación:</strong> {question.explanation}</p>
      )}
    </article>
  );
}

export function TeacherGroupStudentAttempts({ groupId, studentId, activityId, onBack }: { groupId: number; studentId: number; activityId: number; onBack: () => void }) {
  const [data, setData] = useState<TeacherAttemptsPayload | null>(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showAnnulled, setShowAnnulled] = useState(false);

  const load = async () => {
    setError("");
    try {
      setData(await get<TeacherAttemptsPayload>(`/api/teacher/groups/${groupId}/students/${studentId}/activities/${activityId}/attempts`));
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  useEffect(() => { void load(); }, [groupId, studentId, activityId]);

  // El intento abierto es el elegido localmente o, si esa elección no está en el
  // payload, el sugerido por el backend. Cambiar de intento nunca vuelve a
  // consultar: todo ocurre sobre los datos ya recibidos y en el orden recibido.
  const selected = useMemo(() => {
    if (!data) return null;
    const wanted = selectedId ?? data.defaultAttemptId;
    return data.submittedAttempts.find((attempt) => attempt.attemptId === wanted)
      ?? data.submittedAttempts.find((attempt) => attempt.attemptId === data.defaultAttemptId)
      ?? null;
  }, [data, selectedId]);

  const summary = data?.summary ?? null;

  return (
    <section className="teacher-view">
      <button className="back-link" onClick={onBack}>← Volver a resultados del estudiante</button>
      <p className="eyebrow">Grupo docente · Intentos del estudiante</p>
      <h1>{data?.student.displayName ?? "Intentos del estudiante"}</h1>
      {data && <p className="lead">{data.student.username}</p>}
      {data && (
        <p className="student-results-group">
          {data.group.name} · {data.group.code} — {data.group.subjectName} · {data.group.editionName} ({data.group.year})
        </p>
      )}
      {data && (
        <p className="activity-results-meta attempt-activity-meta">
          {data.activity.title}{data.activity.unitCode ? ` · ${data.activity.unitCode}` : ""} · {data.activity.editorialState} ·{" "}
          <span className={`results-activity-status is-${data.activity.availabilityStatus}`}>{activityAvailabilityText[data.activity.availabilityStatus]}</span>
        </p>
      )}

      {error && (
        <p role="alert">
          {error}{" "}
          <button className="button-secondary" onClick={() => void load()}>Reintentar</button>
        </p>
      )}

      {!error && !data && <p>Cargando intentos del estudiante…</p>}

      {data && summary && (
        <>
          <dl className="activity-results-summary" aria-label="Resumen de los intentos">
            <div className="activity-results-summary-item">
              <dt>Mejor resultado</dt>
              <dd>{summary.best ? percentText(summary.best.percentage) : "—"}</dd>
            </div>
            <div className="activity-results-summary-item">
              <dt>Estado</dt>
              <dd>{summary.judgment ? judgmentText[summary.judgment] : "—"}</dd>
            </div>
            <div className="activity-results-summary-item">
              <dt>Intentos usados</dt>
              <dd>{summary.attemptsUsed} de {data.activity.maxAttempts}</dd>
            </div>
            <div className="activity-results-summary-item">
              <dt>Intentos enviados</dt>
              <dd>{summary.submittedCount}</dd>
            </div>
            <div className="activity-results-summary-item">
              <dt>Último envío</dt>
              <dd>{formatLocalDateTime(summary.lastSubmittedAt)}</dd>
            </div>
            <div className="activity-results-summary-item">
              <dt>Borrador</dt>
              <dd>{summary.hasDraft ? "En progreso" : "Sin borrador"}</dd>
            </div>
          </dl>

          {summary.hasDraft && (
            <p className="attempt-draft">
              <strong>Borrador en progreso.</strong>
              {summary.draftStartedAt !== null && <> Iniciado: {formatLocalDateTime(summary.draftStartedAt)}.</>}
            </p>
          )}

          {summary.submittedCount === 0 ? (
            <p className="attempt-empty">
              Todavía no hay intentos enviados.{summary.hasDraft ? " Hay un borrador en progreso." : ""}
            </p>
          ) : (
            <>
              <div className="attempt-selector" role="group" aria-label="Intentos enviados">
                {data.submittedAttempts.map((attempt) => (
                  <button
                    type="button"
                    key={attempt.attemptId}
                    className={`attempt-choice ${selected?.attemptId === attempt.attemptId ? "is-selected" : ""}`}
                    aria-pressed={selected?.attemptId === attempt.attemptId}
                    onClick={() => setSelectedId(attempt.attemptId)}
                  >
                    <span className="attempt-choice-label">{attemptLabel(attempt)}</span>
                    <span className="attempt-choice-score">{percentText(attempt.percentage)}</span>
                    {attempt.isBest && <span className="attempt-choice-best">Mejor intento</span>}
                  </button>
                ))}
              </div>

              {selected && (
                <section
                  className="attempt-detail"
                  aria-label={`Detalle de ${attemptLabel(selected)}${selected.isBest ? " (mejor intento)" : ""}`}
                >
                  <h2>{attemptLabel(selected)}</h2>
                  <p className="attempt-detail-meta">
                    {percentText(selected.percentage)} · {selected.score}/{selected.total} puntos ·{" "}
                    {judgmentText[selected.judgment]} · {formatLocalDateTime(selected.submittedAt)}
                  </p>
                  <div className="attempt-questions">
                    {selected.questions.map((question) => <QuestionCard key={question.number} question={question} />)}
                  </div>
                </section>
              )}
            </>
          )}

          {summary.annulledCount > 0 && (
            <div className="attempt-annulled">
              <button
                type="button"
                className="button-secondary"
                aria-expanded={showAnnulled}
                onClick={() => setShowAnnulled((current) => !current)}
              >
                {showAnnulled ? "Ocultar intentos anulados" : `Ver intentos anulados (${summary.annulledCount})`}
              </button>
              {showAnnulled && (
                <ul className="attempt-annulled-list">
                  {data.annulledAttempts.map((attempt) => (
                    <li key={attempt.attemptId}>
                      <p className="attempt-annulled-title">
                        Intento anulado{attempt.ordinal === null ? "" : ` · Intento ${attempt.ordinal}`}
                      </p>
                      <p className="attempt-annulled-meta">Iniciado: {formatLocalDateTime(attempt.startedAt)}</p>
                      <p className="attempt-annulled-meta">Registro histórico: intento {attempt.number}</p>
                      <p className="attempt-annulled-note">No cuenta para resultados</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
