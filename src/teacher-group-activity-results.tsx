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
} from "./teacher-results-shared";

// Detalle de una actividad para todo el grupo (C2). La vista sólo representa lo
// que el backend ya calculó: muestra el juicio persistido del mejor intento y no
// recalcula el juicio, el promedio ni la mediana. El ordenamiento de la tabla es
// local: nunca dispara consultas nuevas.

export type TeacherActivityResultStudent = {
  studentId: number;
  displayName: string;
  username: string;
  best: TeacherResultBest | null;
  attemptsUsed: number;
  hasDraft: boolean;
  lastSubmittedAt: string | null;
};

export type TeacherActivityResultsSummary = {
  totalStudents: number;
  withoutAttempt: number;
  inProgress: number;
  inicial: number;
  en_proceso: number;
  logrado: number;
  averageBestPercentage: number | null;
  medianBestPercentage: number | null;
};

export type TeacherActivityResultsPayload = {
  group: TeacherResultGroup;
  activity: TeacherResultActivity | null;
  summary: TeacherActivityResultsSummary;
  students: TeacherActivityResultStudent[];
};

export type ActivityResultsSort = "name" | "score-asc" | "score-desc";

const sortOptions: { value: ActivityResultsSort; label: string }[] = [
  { value: "name", label: "Nombre A–Z" },
  { value: "score-asc", label: "Resultado menor→mayor" },
  { value: "score-desc", label: "Resultado mayor→menor" },
];

const columns = [
  { key: "best", label: "Mejor resultado" },
  { key: "state", label: "Estado" },
  { key: "attempts", label: "Intentos" },
  { key: "draft", label: "Borrador" },
  { key: "submitted", label: "Último envío" },
] as const;

type StudentRowState = { tone: TeacherResultJudgment | "draft-only" | "empty"; label: string };

// El mejor intento manda siempre: el borrador sólo describe un intento en curso
// cuando todavía no hay ningún envío para esa actividad.
export function studentRowState(student: TeacherActivityResultStudent): StudentRowState {
  if (student.best) return { tone: student.best.judgment, label: judgmentText[student.best.judgment] };
  if (student.hasDraft) return { tone: "draft-only", label: "En progreso" };
  return { tone: "empty", label: "Sin intento" };
}

const byName = (a: TeacherActivityResultStudent, b: TeacherActivityResultStudent) =>
  a.displayName.localeCompare(b.displayName, "es") || a.username.localeCompare(b.username, "es") || a.studentId - b.studentId;

// Ordenamiento local y estable: los empates se resuelven por nombre y los
// estudiantes sin mejor intento quedan siempre al final, en ambos sentidos.
export function sortStudents(students: TeacherActivityResultStudent[], sort: ActivityResultsSort): TeacherActivityResultStudent[] {
  if (sort === "name") return [...students].sort(byName);
  const withBest = students.filter((student): student is TeacherActivityResultStudent & { best: TeacherResultBest } => student.best !== null);
  const withoutBest = students.filter((student) => student.best === null);
  withBest.sort((a, b) => {
    const difference = a.best.percentage - b.best.percentage;
    if (difference !== 0) return sort === "score-asc" ? difference : -difference;
    return byName(a, b);
  });
  withoutBest.sort(byName);
  return [...withBest, ...withoutBest];
}

async function get<T>(url: string) {
  const response = await fetch(url);
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "No fue posible consultar los resultados de la actividad.");
  return body;
}

// El formato de porcentajes y de fechas locales vive en el módulo compartido.
export function TeacherGroupActivityResults({ groupId, activityId, onBack, onOpenStudent }: { groupId: number; activityId: number; onBack: () => void; onOpenStudent: (studentId: number) => void }) {
  const [data, setData] = useState<TeacherActivityResultsPayload | null>(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<ActivityResultsSort>("name");

  const load = async () => {
    setError("");
    try {
      setData(await get<TeacherActivityResultsPayload>(`/api/teacher/groups/${groupId}/activities/${activityId}/results`));
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  useEffect(() => { void load(); }, [groupId, activityId]);

  const sortedStudents = useMemo(() => sortStudents(data?.students ?? [], sort), [data, sort]);
  const summary = data?.summary ?? null;
  const activity = data?.activity ?? null;
  const empty = data !== null && data.students.length === 0;
  const withoutSubmittedAttempts = summary !== null && summary.inicial + summary.en_proceso + summary.logrado === 0;

  // Los ocho indicadores salen del contrato: React no calcula promedio ni mediana.
  const indicators = summary ? [
    { label: "Total", value: String(summary.totalStudents) },
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
      <p className="eyebrow">Grupo docente · Detalle de actividad</p>
      <h1>{activity?.title ?? "Detalle de actividad"}</h1>
      {data && <p className="lead">{data.group.name} · {data.group.code} — {data.group.subjectName} · {data.group.editionName} ({data.group.year})</p>}
      {activity && (
        <p className="activity-results-availability">
          Estado de disponibilidad:{" "}
          <span className={`results-activity-status is-${activity.availabilityStatus}`}>{activityAvailabilityText[activity.availabilityStatus]}</span>
        </p>
      )}
      {activity && (
        <p className="activity-results-meta">
          Unidad: {activity.unitCode ?? "Sin unidad"} · Estado editorial: {activity.editorialState} · Intentos máximos: {activity.maxAttempts}
        </p>
      )}

      {error && (
        <p role="alert">
          {error}{" "}
          <button className="button-secondary" onClick={() => void load()}>Reintentar</button>
        </p>
      )}

      {!error && !data && <p>Cargando resultados de la actividad…</p>}

      {empty && (
        <div className="course-status">
          <div>
            <h2>Sin datos para mostrar</h2>
            <p>El grupo todavía no tiene estudiantes activos.</p>
          </div>
        </div>
      )}

      {data && !empty && (
        <>
          <dl className="activity-results-summary" aria-label="Resumen de la actividad">
            {indicators.map((indicator) => (
              <div className="activity-results-summary-item" key={indicator.label}>
                <dt>{indicator.label}</dt>
                <dd>{indicator.value}</dd>
              </div>
            ))}
          </dl>

          {withoutSubmittedAttempts && (
            <p className="activity-results-note">
              Todavía no hay intentos enviados en esta actividad; sólo se muestran los intentos en curso o pendientes.
            </p>
          )}

          <div className="activity-results-controls">
            <label htmlFor="activity-results-sort">Ordenar por</label>
            <select id="activity-results-sort" value={sort} onChange={(event) => setSort(event.target.value as ActivityResultsSort)}>
              {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>

          <div className="results-matrix activity-results-matrix" role="region" aria-label={`Detalle de ${activity?.title ?? "la actividad"} en el grupo ${data.group.name}`} tabIndex={0}>
            <table className="results-table activity-results-table">
              <caption className="sr-only">Mejor resultado, estado, intentos, borrador y último envío de cada estudiante</caption>
              <thead>
                <tr>
                  <th scope="col" className="results-table-student">Estudiante</th>
                  {columns.map((column) => <th scope="col" key={column.key}>{column.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {sortedStudents.map((student) => {
                  const state = studentRowState(student);
                  return (
                    <tr key={student.studentId}>
                      <th scope="row" className="results-table-student">
                        <button type="button" className="results-activity-link" onClick={() => onOpenStudent(student.studentId)} aria-label={`Ver detalle de ${student.displayName}`}>
                          <span className="results-student-name">{student.displayName}</span>
                          <span className="results-student-username">{student.username}</span>
                        </button>
                      </th>
                      <td>
                        {student.best ? (
                          <>
                            <span className="activity-results-best-value">{percentText(student.best.percentage)}</span>
                            <span className="activity-results-best-detail">{student.best.score}/{student.best.total} puntos</span>
                          </>
                        ) : (
                          <span className="activity-results-empty">—</span>
                        )}
                      </td>
                      <td>
                        <div className={`result-cell result-cell-${state.tone} activity-results-state`}>
                          <span className="result-cell-state">{state.label}</span>
                          {student.best && student.hasDraft && <span className="result-cell-draft">Borrador</span>}
                        </div>
                      </td>
                      <td>{attemptsText(student.attemptsUsed)}</td>
                      <td>{student.hasDraft ? "Sí" : "No"}</td>
                      <td>{formatLocalDateTime(student.lastSubmittedAt)}</td>
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
