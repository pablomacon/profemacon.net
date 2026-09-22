import { requireTeacherGroupStudentScope } from "./teacher-group-scope";

// C3 es un endpoint de sólo lectura que cambia el eje de C2: expone todas las
// actividades del grupo desde la perspectiva de un único estudiante. Reutiliza
// exactamente el criterio de "mejor intento" y el juicio ya persistido de C1/C2,
// y agrega la secuencia real de intentos enviados (evolución) sin interpretarla,
// sin recalcular juicios y sin exponer datos privados.

type StudentActivityRow = {
  id: number;
  slug: string;
  title: string;
  unitCode: string | null;
  editorialState: string;
  maxAttempts: number;
  availabilityStatus: "disabled" | "not_open" | "closed" | "available";
};

type StudentAttemptAggregateRow = {
  activityId: number;
  attemptsUsed: number;
  drafts: number;
  lastSubmittedAt: string | null;
};

type StudentBestAttemptRow = {
  activityId: number;
  percentage: number;
  score: number;
  total: number;
  judgment: "inicial" | "en_proceso" | "logrado";
  ordinal: number | null;
  submittedAt: string;
};

type StudentSubmittedAttemptRow = {
  activityId: number;
  ordinal: number | null;
  percentage: number;
  judgment: "inicial" | "en_proceso" | "logrado";
  submittedAt: string;
};

export type TeacherStudentSubmittedAttempt = {
  ordinal: number | null;
  percentage: number;
  judgment: "inicial" | "en_proceso" | "logrado";
  submittedAt: string;
};

export type TeacherStudentActivityResult = {
  activityId: number;
  slug: string;
  title: string;
  unitCode: string | null;
  editorialState: string;
  availabilityStatus: StudentActivityRow["availabilityStatus"];
  maxAttempts: number;
  best: {
    percentage: number;
    score: number;
    total: number;
    judgment: "inicial" | "en_proceso" | "logrado";
    ordinal: number | null;
    submittedAt: string;
  } | null;
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

// Redondeo único a 1 decimal, con el mismo criterio que C1/C2. Se duplica de
// forma deliberada: esta tarea no refactoriza los módulos ya cerrados.
const round1 = (value: number) => Math.round(value * 10) / 10;

function averagePercentage(values: number[]): number | null {
  if (values.length === 0) return null;
  return round1(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function medianPercentage(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return round1((sorted[middle - 1] + sorted[middle]) / 2);
}

export async function getTeacherGroupStudentResults(db: D1Database, userId: number, groupId: number, studentId: number) {
  // El alcance valida grupo autorizado y membresía activa del estudiante antes
  // de leer cualquier dato académico.
  const { group, student } = await requireTeacherGroupStudentScope(db, userId, groupId, studentId);

  // Cuatro consultas acotadas e independientes de la cantidad de actividades e
  // intentos: se evita cualquier patrón N+1.
  const [activities, aggregates, bestAttempts, submittedAttempts] = await Promise.all([
    db.prepare(`
      SELECT
        a.id,
        a.slug,
        a.titulo AS title,
        a.unidad_codigo AS unitCode,
        a.estado AS editorialState,
        a.maximo_intentos AS maxAttempts,
        CASE
          WHEN h.id IS NULL OR h.habilitada = 0 THEN 'disabled'
          WHEN h.disponible_desde IS NOT NULL AND datetime(h.disponible_desde) > datetime('now') THEN 'not_open'
          WHEN h.disponible_hasta IS NOT NULL AND datetime(h.disponible_hasta) < datetime('now') THEN 'closed'
          ELSE 'available'
        END AS availabilityStatus
      FROM actividades a
      LEFT JOIN habilitaciones_actividad h ON h.actividad_id = a.id AND h.grupo_id = ?1
      WHERE a.edicion_anual_id = ?2
      ORDER BY a.orden, a.titulo
    `).bind(groupId, group.editionId).all<StudentActivityRow>(),
    db.prepare(`
      SELECT
        i.actividad_id AS activityId,
        SUM(CASE WHEN i.estado <> 'anulado' THEN 1 ELSE 0 END) AS attemptsUsed,
        SUM(CASE WHEN i.estado = 'en_progreso' THEN 1 ELSE 0 END) AS drafts,
        MAX(CASE WHEN i.estado = 'enviado' THEN i.enviado_en END) AS lastSubmittedAt
      FROM intentos_actividad i
      JOIN habilitaciones_actividad h ON h.id = i.habilitacion_id
      WHERE h.grupo_id = ?1 AND i.usuario_id = ?2
      GROUP BY i.actividad_id
    `).bind(groupId, studentId).all<StudentAttemptAggregateRow>(),
    db.prepare(`
      SELECT activityId, percentage, score, total, judgment, ordinal, submittedAt
      FROM (
        SELECT
          i.actividad_id AS activityId,
          i.porcentaje AS percentage,
          i.puntaje_obtenido AS score,
          i.puntaje_total AS total,
          i.juicio AS judgment,
          i.ordinal_efectivo AS ordinal,
          i.enviado_en AS submittedAt,
          ROW_NUMBER() OVER (
            PARTITION BY i.actividad_id
            ORDER BY i.porcentaje DESC, i.puntaje_obtenido DESC, i.enviado_en ASC
          ) AS rn
        FROM intentos_actividad i
        JOIN habilitaciones_actividad h ON h.id = i.habilitacion_id
        WHERE h.grupo_id = ?1 AND i.usuario_id = ?2 AND i.estado = 'enviado'
      )
      WHERE rn = 1
    `).bind(groupId, studentId).all<StudentBestAttemptRow>(),
    db.prepare(`
      SELECT
        i.actividad_id AS activityId,
        i.ordinal_efectivo AS ordinal,
        i.porcentaje AS percentage,
        i.juicio AS judgment,
        i.enviado_en AS submittedAt
      FROM intentos_actividad i
      JOIN habilitaciones_actividad h ON h.id = i.habilitacion_id
      WHERE h.grupo_id = ?1 AND i.usuario_id = ?2 AND i.estado = 'enviado'
      ORDER BY i.actividad_id ASC, i.enviado_en ASC, i.id ASC
    `).bind(groupId, studentId).all<StudentSubmittedAttemptRow>(),
  ]);

  const aggregateByActivity = new Map(aggregates.results.map((row) => [row.activityId, row]));
  const bestByActivity = new Map(bestAttempts.results.map((row) => [row.activityId, row]));

  // La secuencia se agrupa respetando el orden que devolvió SQL (cronológico
  // real por `enviado_en` y luego por id); nunca por `ordinal_efectivo`, que
  // puede reutilizarse después de una anulación.
  const submittedByActivity = new Map<number, TeacherStudentSubmittedAttempt[]>();
  for (const row of submittedAttempts.results) {
    const attempt: TeacherStudentSubmittedAttempt = {
      ordinal: row.ordinal,
      percentage: row.percentage,
      judgment: row.judgment,
      submittedAt: row.submittedAt,
    };
    const list = submittedByActivity.get(row.activityId);
    if (list) list.push(attempt);
    else submittedByActivity.set(row.activityId, [attempt]);
  }

  const summary: TeacherStudentResultsSummary = {
    totalActivities: activities.results.length,
    withoutAttempt: 0,
    inProgress: 0,
    inicial: 0,
    en_proceso: 0,
    logrado: 0,
    averageBestPercentage: null,
    medianBestPercentage: null,
  };

  const bestPercentages: number[] = [];
  const activitiesPayload: TeacherStudentActivityResult[] = [];

  for (const activity of activities.results) {
    const aggregate = aggregateByActivity.get(activity.id);
    const best = bestByActivity.get(activity.id);
    const hasDraft = (aggregate?.drafts ?? 0) > 0;

    // Categorías mutuamente excluyentes: la suma siempre equivale a totalActivities.
    if (best) {
      if (best.judgment === "inicial") summary.inicial += 1;
      else if (best.judgment === "en_proceso") summary.en_proceso += 1;
      else summary.logrado += 1;
      bestPercentages.push(best.percentage);
    } else if (hasDraft) {
      summary.inProgress += 1;
    } else {
      summary.withoutAttempt += 1;
    }

    activitiesPayload.push({
      activityId: activity.id,
      slug: activity.slug,
      title: activity.title,
      unitCode: activity.unitCode,
      editorialState: activity.editorialState,
      availabilityStatus: activity.availabilityStatus,
      maxAttempts: activity.maxAttempts,
      best: best ? {
        percentage: best.percentage,
        score: best.score,
        total: best.total,
        judgment: best.judgment,
        ordinal: best.ordinal,
        submittedAt: best.submittedAt,
      } : null,
      attemptsUsed: aggregate?.attemptsUsed ?? 0,
      hasDraft,
      lastSubmittedAt: aggregate?.lastSubmittedAt ?? null,
      submittedAttempts: submittedByActivity.get(activity.id) ?? [],
    });
  }

  summary.averageBestPercentage = averagePercentage(bestPercentages);
  summary.medianBestPercentage = medianPercentage(bestPercentages);

  return { group, student, summary, activities: activitiesPayload };
}
