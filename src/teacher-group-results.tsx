import { useEffect, useState } from "react";
import { activityAvailabilityText, attemptsText, judgmentText, type TeacherResultActivity, type TeacherResultBest, type TeacherResultGroup, type TeacherResultJudgment, type TeacherResultStudent } from "./teacher-results-shared";

// La matriz de resultados (C1) sólo representa lo que el backend ya calculó:
// nunca recalcula el juicio. Los tipos y las etiquetas compartidos con el
// detalle por actividad (C2) viven en ./teacher-results-shared.

export type TeacherResultCell = {
  studentId: number;
  activityId: number;
  best: TeacherResultBest | null;
  attemptsUsed: number;
  hasDraft: boolean;
  lastSubmittedAt: string | null;
};

export type TeacherResultsPayload = {
  group: TeacherResultGroup;
  activities: TeacherResultActivity[];
  students: TeacherResultStudent[];
  cells: TeacherResultCell[];
};

type TeacherResultCellState = {
  tone: TeacherResultJudgment | "draft-only" | "empty";
  label: string;
  percentage: number | null;
};

// Deriva el estado visual sin reinterpretar el juicio: usa el valor del backend.
function cellState(cell: TeacherResultCell | undefined): TeacherResultCellState {
  if (cell?.best) {
    return { tone: cell.best.judgment, label: judgmentText[cell.best.judgment], percentage: cell.best.percentage };
  }
  if (cell?.hasDraft) return { tone: "draft-only", label: "En progreso", percentage: null };
  return { tone: "empty", label: "Sin intento", percentage: null };
}

// Etiqueta accesible completa para lectores de pantalla.
function cellAccessibleLabel(student: TeacherResultStudent, activity: TeacherResultActivity, cell: TeacherResultCell | undefined): string {
  const state = cellState(cell);
  const parts = [`${student.displayName}, ${activity.title}: ${state.label}`];
  if (state.percentage !== null) parts.push(`${state.percentage} por ciento`);
  parts.push(attemptsText(cell?.attemptsUsed ?? 0));
  if (cell?.hasDraft && cell.best) parts.push("con borrador en progreso");
  return parts.join(", ");
}

async function get<T>(url: string) {
  const response = await fetch(url);
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "No fue posible consultar los resultados.");
  return body;
}

function MatrixCell({ label, tone, percentage, attemptsUsed, hasDraft }: {
  label: string;
  tone: string;
  percentage: number | null;
  attemptsUsed: number;
  hasDraft: boolean;
}) {
  return (
    <div className={`result-cell result-cell-${tone}`}>
      <span className="result-cell-state">{label}</span>
      {percentage !== null && <span className="result-cell-value">{percentage}%</span>}
      {hasDraft && <span className="result-cell-draft">Borrador</span>}
      <span className="result-cell-attempts">{attemptsText(attemptsUsed)}</span>
    </div>
  );
}

export function TeacherGroupResults({ groupId, onBack, onOpenActivity, onOpenStudent }: { groupId: number; onBack: () => void; onOpenActivity: (activityId: number) => void; onOpenStudent: (studentId: number) => void }) {
  const [data, setData] = useState<TeacherResultsPayload | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    try {
      setData(await get<TeacherResultsPayload>(`/api/teacher/groups/${groupId}/results`));
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  useEffect(() => { void load(); }, [groupId]);

  const cellOf = (studentId: number, activityId: number): TeacherResultCell | undefined =>
    data?.cells.find((cell) => cell.studentId === studentId && cell.activityId === activityId);

  const empty = data !== null && (data.students.length === 0 || data.activities.length === 0);

  return (
    <section className="teacher-view">
      <button className="back-link" onClick={onBack}>← Volver al grupo</button>
      <p className="eyebrow">Grupo docente</p>
      <h1>Resultados</h1>
      {data && <p className="lead">{data.group.name} · {data.group.code} — {data.group.subjectName} · {data.group.editionName} ({data.group.year})</p>}

      {error && (
        <p role="alert">
          {error}{" "}
          <button className="button-secondary" onClick={() => void load()}>Reintentar</button>
        </p>
      )}

      {!error && !data && <p>Cargando resultados…</p>}

      {empty && (
        <div className="course-status">
          <div>
            <h2>Sin datos para mostrar</h2>
            <p>{data!.students.length === 0 ? "El grupo todavía no tiene estudiantes activos." : "La edición todavía no tiene actividades."}</p>
          </div>
        </div>
      )}

      {data && !empty && (
        <div className="results-matrix" role="region" aria-label={`Matriz de resultados del grupo ${data.group.name}`} tabIndex={0}>
          <table className="results-table">
            <caption className="sr-only">Mejor resultado de cada estudiante por actividad</caption>
            <thead>
              <tr>
                <th scope="col" className="results-table-corner">Estudiante</th>
                {data.activities.map((activity) => (
                  <th scope="col" key={activity.id} className="results-table-activity">
                    <button type="button" className="results-activity-link" onClick={() => onOpenActivity(activity.id)} aria-label={`Ver detalle de ${activity.title}`}>
                      <span className="results-activity-title">{activity.title}</span>
                      <span className={`results-activity-status is-${activity.availabilityStatus}`}>{activityAvailabilityText[activity.availabilityStatus]}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.students.map((student) => (
                <tr key={student.id}>
                  <th scope="row" className="results-table-student">
                    <button type="button" className="results-activity-link" onClick={() => onOpenStudent(student.id)} aria-label={`Ver detalle de ${student.displayName}`}>
                      <span className="results-student-name">{student.displayName}</span>
                      <span className="results-student-username">{student.username}</span>
                    </button>
                  </th>
                  {data.activities.map((activity) => {
                    const cell = cellOf(student.id, activity.id);
                    const state = cellState(cell);
                    return (
                      <td key={activity.id} className="results-table-cell" aria-label={cellAccessibleLabel(student, activity, cell)}>
                        <MatrixCell
                          label={state.label}
                          tone={state.tone}
                          percentage={state.percentage}
                          attemptsUsed={cell?.attemptsUsed ?? 0}
                          hasDraft={Boolean(cell?.hasDraft)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}