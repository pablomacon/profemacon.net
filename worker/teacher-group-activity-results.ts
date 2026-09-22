import { requireTeacherGroupScope } from "./teacher-group-scope";

// C2 es un endpoint de sólo lectura: expone el detalle de una única actividad
// para todo el grupo, reutilizando exactamente el criterio de "mejor intento" y
// el juicio ya persistido de C1. Nunca recalcula umbrales ni expone datos
// privados (claves, respuestas, snapshots, correcciones, submission_id, etc.).

type ActivityRow = {
  id: number;
  slug: string;
  title: string;
  unitCode: string | null;
  editorialState: string;
  maxAttempts: number;
  availabilityStatus: "disabled" | "not_open" | "closed" | "available";
};

type StudentRow = {
  id: number;
  displayName: string;
  username: string;
};

type AttemptAggregateRow = {
  studentId: number;
  attemptsUsed: number;
  drafts: number;
  lastSubmittedAt: string | null;
};

type BestAttemptRow = {
  studentId: number;
  percentage: number;
  score: number;
  total: number;
  judgment: "inicial" | "en_proceso" | "logrado";
  ordinal: number | null;
  submittedAt: string;
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

export type TeacherActivityResultStudent = {
  studentId: number;
  displayName: string;
  username: string;
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
};

// Redondeo único a 1 decimal. Se evita redondear valores intermedios.
const round1 = (value: number) => Math.round(value * 10) / 10;

export function averagePercentage(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return round1(total / values.length);
}

export function medianPercentage(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return round1((sorted[middle - 1] + sorted[middle]) / 2);
}

export async function getTeacherGroupActivityResults(
  db: D1Database,
  userId: number,
  groupId: number,
  activityId: number,
) {
  // El scope valida rol docente, asignación activa, grupo activo y que la
  // actividad pertenezca a la misma edición anual del grupo.
  const group = await requireTeacherGroupScope(db, userId, groupId, activityId);

  // Cuatro consultas acotadas e independientes de la cantidad de estudiantes:
  // se evita cualquier patrón N+1.
  const [activity, students, aggregates, bestAttempts] = await Promise.all([
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
      LEFT JOIN habilitaciones_actividad h ON h.actividad_id = a.id AND h.grupo_id = ?2
      WHERE a.id = ?1 AND a.edicion_anual_id = ?3
    `).bind(activityId, groupId, group.editionId).first<ActivityRow>(),
    db.prepare(`
      SELECT
        u.id AS id,
        u.nombre_mostrado AS displayName,
        u.nombre_usuario AS username
      FROM inscripciones i
      JOIN usuarios u ON u.id = i.usuario_id
      JOIN usuario_roles ur ON ur.usuario_id = u.id
      JOIN roles r ON r.id = ur.rol_id AND r.codigo = 'estudiante'
      WHERE i.grupo_id = ?1 AND i.estado = 'activa' AND u.estado = 'activo'
      ORDER BY u.nombre_mostrado, u.nombre_usuario, u.id
    `).bind(groupId).all<StudentRow>(),
    db.prepare(`
      SELECT
        i.usuario_id AS studentId,
        SUM(CASE WHEN i.estado <> 'anulado' THEN 1 ELSE 0 END) AS attemptsUsed,
        SUM(CASE WHEN i.estado = 'en_progreso' THEN 1 ELSE 0 END) AS drafts,
        MAX(CASE WHEN i.estado = 'enviado' THEN i.enviado_en END) AS lastSubmittedAt
      FROM intentos_actividad i
      JOIN habilitaciones_actividad h ON h.id = i.habilitacion_id
      WHERE h.grupo_id = ?1 AND i.actividad_id = ?2
      GROUP BY i.usuario_id
    `).bind(groupId, activityId).all<AttemptAggregateRow>(),
    db.prepare(`
      SELECT studentId, percentage, score, total, judgment, ordinal, submittedAt
      FROM (
        SELECT
          i.usuario_id AS studentId,
          i.porcentaje AS percentage,
          i.puntaje_obtenido AS score,
          i.puntaje_total AS total,
          i.juicio AS judgment,
          i.ordinal_efectivo AS ordinal,
          i.enviado_en AS submittedAt,
          ROW_NUMBER() OVER (
            PARTITION BY i.usuario_id
            ORDER BY i.porcentaje DESC, i.puntaje_obtenido DESC, i.enviado_en ASC
          ) AS rn
        FROM intentos_actividad i
        JOIN habilitaciones_actividad h ON h.id = i.habilitacion_id
        WHERE h.grupo_id = ?1 AND i.actividad_id = ?2 AND i.estado = 'enviado'
      )
      WHERE rn = 1
    `).bind(groupId, activityId).all<BestAttemptRow>(),
  ]);

  const aggregateByStudent = new Map(aggregates.results.map((row) => [row.studentId, row]));
  const bestByStudent = new Map(bestAttempts.results.map((row) => [row.studentId, row]));

  const summary: TeacherActivityResultsSummary = {
    totalStudents: students.results.length,
    withoutAttempt: 0,
    inProgress: 0,
    inicial: 0,
    en_proceso: 0,
    logrado: 0,
    averageBestPercentage: null,
    medianBestPercentage: null,
  };

  const studentsPayload: TeacherActivityResultStudent[] = [];
  const bestPercentages: number[] = [];

  for (const student of students.results) {
    const aggregate = aggregateByStudent.get(student.id);
    const best = bestByStudent.get(student.id);
    const hasDraft = (aggregate?.drafts ?? 0) > 0;

    // Categorías mutuamente excluyentes: la suma siempre equivale a totalStudents.
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

    studentsPayload.push({
      studentId: student.id,
      displayName: student.displayName,
      username: student.username,
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
    });
  }

  summary.averageBestPercentage = averagePercentage(bestPercentages);
  summary.medianBestPercentage = medianPercentage(bestPercentages);

  return {
    group,
    activity: activity ? {
      id: activity.id,
      slug: activity.slug,
      title: activity.title,
      unitCode: activity.unitCode,
      editorialState: activity.editorialState,
      maxAttempts: activity.maxAttempts,
      availabilityStatus: activity.availabilityStatus,
    } : null,
    summary,
    students: studentsPayload,
  };
}