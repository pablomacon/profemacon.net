import { useEffect, useMemo, useState } from "react";
import {
  activityAvailabilityText,
  attemptsText,
  formatLocalDateTime,
  judgmentText,
  percentText,
  type TeacherResultActivity,
  type TeacherResultBest,
  type TeacherResultGroup,
  type TeacherResultJudgment,
  type TeacherResultStudent,
} from "./teacher-results-shared";

// Detalle de un estudiante a través de todas las actividades del grupo (C3).
// Cambia el eje de C2: una fila por actividad. La vista sólo representa lo que el
// backend ya calculó: no recalcula juicios, promedio ni mediana, no interpreta la
// evolución y no compara contra el grupo ni contra la media del grupo.

export type TeacherStudentSubmittedAttempt = {
  ordinal: number | null;
  percentage: number;
  judgment: TeacherResultJudgment;
  submittedAt: string;
};

export type TeacherStudentActivityResult = Omit<TeacherResultActivity, "id"> & {
  activityId: number;
  best: TeacherResultBest | null;
  attemptsUsed: number;
  hasDraft: boolean;
  lastSubmittedAt: string | null;
  submittedAttempts: TeacherStudentSubmittedAttempt[];
};

export type TeacherStudentResultsSummary = {
  totalActivities: number;
  withoutAttempt: number;
  inProgress: number;
  inicial: number;
  en_proceso: number;
  logrado: number;
  averageBestPercentage: number | null;
  medianBestPercentage: number | null;
};

export type TeacherStudentResultsPayload = {
  group: TeacherResultGroup;
  student: TeacherResultStudent;
  summary: TeacherStudentResultsSummary;
  activities: TeacherStudentActivityResult[];
};

export type StudentResultsSort = "natural" | "score-asc" | "score-desc";

const sortOptions: { value: StudentResultsSort; label: string }[] = [
  { value: "natural", label: "Orden natural" },
  { value: "score-asc", label: "Resultado menor→mayor" },
  { value: "score-desc", label: "Resultado mayor→menor" },
];

const columns = [
  { key: "availability", label: "Disponibilidad" },
  { key: "best", label: "Mejor resultado" },
  { key: "state", label: "Estado" },
  { key: "attempts", label: "Intentos" },
  { key: "draft", label: "Borrador" },
  { key: "submitted", label: "Último envío" },
  { key: "evolution", label: "Evolución" },
] as const;

type ActivityRowState = { tone: TeacherResultJudgment | "draft-only" | "empty"; label: string };

// El mejor intento manda siempre: el borrador sólo describe un intento en curso
// cuando todavía no hay ningún envío para esa actividad.
export function activityRowState(activity: TeacherStudentActivityResult): ActivityRowState {
  if (activity.best) return { tone: activity.best.judgment, label: judgmentText[activity.best.judgment] };
  if (activity.hasDraft) return { tone: "draft-only", label: "En progreso" };
  return { tone: "empty", label: "Sin intento" };
}

// Ordenamiento local: "natural" conserva exactamente el orden recibido del
// backend. En los órdenes por resultado las actividades sin mejor intento van
// siempre al final y los empates conservan el orden natural (sort estable).
export function sortActivities(activities: TeacherStudentActivityResult[], sort: StudentResultsSort): TeacherStudentActivityResult[] {
  if (sort === "natural") return activities;
  const withBest = activities.filter((activity): activity is TeacherStudentActivityResult & { best: TeacherResultBest } => activity.best !== null);
  const withoutBest = activities.filter((activity) => activity.best === null);
  withBest.sort((a, b) => {
    const difference = a.best.percentage - b.best.percentage;
    if (difference !== 0) return sort === "score-asc" ? difference : -difference;
    return 0;
  });
  return [...withBest, ...withoutBest];
}

// La evolución se muestra tal como llegó: secuencia completa en el orden
// recibido, sin resumir, sin marcar el mejor intento y sin interpretarla.
function evolutionSequence(attempts: TeacherStudentSubmittedAttempt[]): string {
  return attempts.map((attempt) => `${attempt.percentage}%`).join(" → ");
}

// El «→» no se lee bien en un lector de pantalla: la celda informa la secuencia
// completa en palabras.
function evolutionAccessibleLabel(attempts: TeacherStudentSubmittedAttempt[]): string {
  if (attempts.length === 0) return "Sin envíos";
  const percentages = attempts.map((attempt) => `${attempt.percentage} por ciento`).join(", ");
  return `${attempts.length === 1 ? "1 envío" : `${attempts.length} envíos`}: ${percentages}`;
}

async function get<T>(url: string) {
  const response = await fetch(url);
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "No fue posible consultar los resultados del estudiante.");
  return body;
}

export function TeacherGroupStudentResults({ groupId, studentId, onBack, onOpenActivity }: { groupId: number; studentId: number; onBack: () => void; onOpenActivity: (activityId: number) => void }) {
  const [data, setData] = useState<TeacherStudentResultsPayload | null>(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<StudentResultsSort>("natural");

  const load = async () => {
    setError("");
    try {
      setData(await get<TeacherStudentResultsPayload>(`/api/teacher/groups/${groupId}/students/${studentId}/results`));
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  useEffect(() => { void load(); }, [groupId, studentId]);

  const sortedActivities = useMemo(() => sortActivities(data?.activities ?? [], sort), [data, sort]);
  const summary = data?.summary ?? null;
  const empty = data !== null && data.activities.length === 0;

  // Los ocho indicadores salen del contrato: React no calcula promedio ni mediana.
  const indicators = summary ? [
    { label: "Total de actividades", value: String(summary.totalActivities) },
    { label: "Sin intento", value: String(summary.withoutAttempt) },
    { label: "En progreso", value: String(summary.inProgress) },
    { label: "Inicial", value: String(summary.inicial) },
    { label: "En proceso", value: String(summary.en_proceso) },
    { label: "Logrado", value: String(summary.logrado) },
    { label: "Promedio", value: percentText(summary.averageBestPercentage) },
    { label: "Mediana", value: percentText(summary.medianBestPercentage) },
  ] : [];

  return (
    <section className="teacher-view">
      <button className="back-link" onClick={onBack}>← Volver a resultados</button>
      <p className="eyebrow">Grupo docente · Estudiante</p>
      <h1>{data?.student.displayName ?? "Detalle de estudiante"}</h1>
      {data && <p className="lead">{data.student.username}</p>}
      {data && (
        <p className="student-results-group">
          {data.group.name} · {data.group.code} — {data.group.subjectName} · {data.group.editionName} ({data.group.year})
        </p>
      )}
      {summary && <p className="activity-results-meta">Total de actividades de la edición: {summary.totalActivities}</p>}

      {error && (
        <p role="alert">
          {error}{" "}
          <button className="button-secondary" onClick={() => void load()}>Reintentar</button>
        </p>
      )}

      {!error && !data && <p>Cargando resultados del estudiante…</p>}

      {empty && (
        <div className="course-status">
          <div>
            <h2>Sin datos para mostrar</h2>
            <p>La edición todavía no tiene actividades.</p>
          </div>
        </div>
      )}

      {data && !empty && (
        <>
          <dl className="activity-results-summary" aria-label="Resumen del estudiante">
            {indicators.map((indicator) => (
              <div className="activity-results-summary-item" key={indicator.label}>
                <dt>{indicator.label}</dt>
                <dd>{indicator.value}</dd>
              </div>
            ))}
          </dl>

          <div className="activity-results-controls">
            <label htmlFor="student-results-sort">Ordenar por</label>
            <select id="student-results-sort" value={sort} onChange={(event) => setSort(event.target.value as StudentResultsSort)}>
              {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>

          <div className="results-matrix activity-results-matrix" role="region" aria-label={`Resultados de ${data.student.displayName} en el grupo ${data.group.name}`} tabIndex={0}>
            <table className="results-table student-results-table">
              <caption className="sr-only">Mejor resultado, estado, intentos, borrador, último envío y evolución de cada actividad</caption>
              <thead>
                <tr>
                  <th scope="col" className="results-table-corner">Actividad</th>
                  {columns.map((column) => <th scope="col" key={column.key}>{column.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {sortedActivities.map((activity) => {
                  const state = activityRowState(activity);
                  return (
                    <tr key={activity.activityId}>
                      <th scope="row" className="results-table-student">
                        <button type="button" className="results-activity-link" onClick={() => onOpenActivity(activity.activityId)} aria-label={`Ver intentos de ${activity.title}`}>
                          <span className="results-student-name">{activity.title}</span>
                          <span className="results-student-username">{activity.unitCode ?? "Sin unidad"} · {activity.editorialState}</span>
                        </button>
                      </th>
                      <td>
                        <span className={`results-activity-status is-${activity.availabilityStatus}`}>{activityAvailabilityText[activity.availabilityStatus]}</span>
                      </td>
                      <td>
                        {activity.best ? (
                          <>
                            <span className="activity-results-best-value">{percentText(activity.best.percentage)}</span>
                            <span className="activity-results-best-detail">{activity.best.score}/{activity.best.total} puntos</span>
                          </>
                        ) : (
                          <span className="activity-results-empty">—</span>
                        )}
                      </td>
                      <td>
                        <div className={`result-cell result-cell-${state.tone} activity-results-state`}>
                          <span className="result-cell-state">{state.label}</span>
                          {activity.best && activity.hasDraft && <span className="result-cell-draft">Borrador</span>}
                        </div>
                      </td>
                      <td>{attemptsText(activity.attemptsUsed)} de {activity.maxAttempts}</td>
                      <td>{activity.hasDraft ? "Sí" : "No"}</td>
                      <td>{formatLocalDateTime(activity.lastSubmittedAt)}</td>
                      <td aria-label={evolutionAccessibleLabel(activity.submittedAttempts)}>
                        {activity.submittedAttempts.length === 0 ? (
                          <span className="activity-results-empty">—</span>
                        ) : (
                          <span className="student-results-evolution">{evolutionSequence(activity.submittedAttempts)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
