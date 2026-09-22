// Tipos y etiquetas compartidos por las vistas docentes de resultados (matriz
// C1, detalle de actividad C2 y detalle de estudiante C3). Sólo representan lo
// que el backend ya calculó: ninguna de estas piezas recalcula juicios, umbrales
// ni estadísticas.

export type TeacherResultGroup = {
  id: number;
  code: string;
  name: string;
  subjectCode: string;
  subjectName: string;
  editionId: number;
  editionName: string;
  year: number;
  activeStudents: number;
};

export type TeacherResultActivity = {
  id: number;
  slug: string;
  title: string;
  unitCode: string | null;
  editorialState: string;
  availabilityStatus: "disabled" | "not_open" | "closed" | "available";
  maxAttempts: number;
};

export type TeacherResultStudent = {
  id: number;
  displayName: string;
  username: string;
};

export type TeacherResultJudgment = "inicial" | "en_proceso" | "logrado";

export type TeacherResultBest = {
  percentage: number;
  score: number;
  total: number;
  judgment: TeacherResultJudgment;
  ordinal: number | null;
  submittedAt: string;
};

export const activityAvailabilityText: Record<TeacherResultActivity["availabilityStatus"], string> = {
  disabled: "No habilitada",
  not_open: "Todavía no abierta",
  closed: "Cerrada",
  available: "Disponible",
};

export const judgmentText: Record<TeacherResultJudgment, string> = {
  inicial: "Inicial",
  en_proceso: "En proceso",
  logrado: "Logrado",
};

export function attemptsText(attemptsUsed: number): string {
  return attemptsUsed === 1 ? "1 intento" : `${attemptsUsed} intentos`;
}

// Los porcentajes llegan ya redondeados por el backend: acá sólo se agrega el
// símbolo y el guion de dato ausente.
export function percentText(percentage: number | null): string {
  return percentage === null ? "—" : `${percentage}%`;
}

// Fecha legible en hora local del dispositivo; nunca se muestra el ISO crudo.
export function formatLocalDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}
