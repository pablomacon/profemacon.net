import { requireTeacherGroupScope } from "./teacher-group-scope";

// C1 es un endpoint de sólo lectura: expone la matriz de resultados del grupo
// reutilizando el juicio ya persistido y el mismo criterio de "mejor intento"
// del resto del sistema. Nunca recalcula umbrales ni expone datos privados.

type ResultActivityRow = {
  id: number;
  slug: string;
  title: string;
  unitCode: string | null;
  editorialState: string;
  maxAttempts: number;
  availabilityStatus: "disabled" | "not_open" | "closed" | "available";
};

type ResultStudentRow = {
  id: number;
  displayName: string;
  username: string;
};

type AttemptAggregateRow = {
  studentId: number;
  activityId: number;
  attemptsUsed: number;
  drafts: number;
  lastSubmittedAt: string | null;
};

type BestAttemptRow = {
  studentId: number;
  activityId: number;
  percentage: number;
  score: number;
  total: number;
  judgment: "inicial" | "en_proceso" | "logrado";
  ordinal: number | null;
  submittedAt: string;
};

export type TeacherGroupResultBest = {
  percentage: number;
  score: number;
  total: number;
  judgment: "inicial" | "en_proceso" | "logrado";
  ordinal: number | null;
  submittedAt: string;
};

export type TeacherGroupResultCell = {
  studentId: number;
  activityId: number;
  best: TeacherGroupResultBest | null;
  attemptsUsed: number;
  hasDraft: boolean;
  lastSubmittedAt: string | null;
};

const cellKey = (studentId: number, activityId: number) => `${studentId}:${activityId}`;

export async function getTeacherGroupResults(db: D1Database, userId: number, groupId: number) {
  const group = await requireTeacherGroupScope(db, userId, groupId);

  // Cuatro consultas acotadas e independientes de la cantidad de estudiantes y
  // actividades: se evita cualquier patrón N+1.
  const [activities, students, aggregates, bestAttempts] = await Promise.all([
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
    `).bind(groupId, group.editionId).all<ResultActivityRow>(),
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
    `).bind(groupId).all<ResultStudentRow>(),
    db.prepare(`
      SELECT
        i.usuario_id AS studentId,
        i.actividad_id AS activityId,
        SUM(CASE WHEN i.estado <> 'anulado' THEN 1 ELSE 0 END) AS attemptsUsed,
        SUM(CASE WHEN i.estado = 'en_progreso' THEN 1 ELSE 0 END) AS drafts,
        MAX(CASE WHEN i.estado = 'enviado' THEN i.enviado_en END) AS lastSubmittedAt
      FROM intentos_actividad i
      JOIN habilitaciones_actividad h ON h.id = i.habilitacion_id
      WHERE h.grupo_id = ?1
      GROUP BY i.usuario_id, i.actividad_id
    `).bind(groupId).all<AttemptAggregateRow>(),
    db.prepare(`
      SELECT studentId, activityId, percentage, score, total, judgment, ordinal, submittedAt
      FROM (
        SELECT
          i.usuario_id AS studentId,
          i.actividad_id AS activityId,
          i.porcentaje AS percentage,
          i.puntaje_obtenido AS score,
          i.puntaje_total AS total,
          i.juicio AS judgment,
          i.ordinal_efectivo AS ordinal,
          i.enviado_en AS submittedAt,
          ROW_NUMBER() OVER (
            PARTITION BY i.usuario_id, i.actividad_id
            ORDER BY i.porcentaje DESC, i.puntaje_obtenido DESC, i.enviado_en ASC
          ) AS rn
        FROM intentos_actividad i
        JOIN habilitaciones_actividad h ON h.id = i.habilitacion_id
        WHERE h.grupo_id = ?1 AND i.estado = 'enviado'
      )
      WHERE rn = 1
    `).bind(groupId).all<BestAttemptRow>(),
  ]);

  const aggregateByKey = new Map(aggregates.results.map((row) => [cellKey(row.studentId, row.activityId), row]));
  const bestByKey = new Map(bestAttempts.results.map((row) => [cellKey(row.studentId, row.activityId), row]));

  const cells: TeacherGroupResultCell[] = [];
  for (const student of students.results) {
    for (const activity of activities.results) {
      const key = cellKey(student.id, activity.id);
      const aggregate = aggregateByKey.get(key);
      const best = bestByKey.get(key);
      cells.push({
        studentId: student.id,
        activityId: activity.id,
        best: best ? {
          percentage: best.percentage,
          score: best.score,
          total: best.total,
          judgment: best.judgment,
          ordinal: best.ordinal,
          submittedAt: best.submittedAt,
        } : null,
        attemptsUsed: aggregate?.attemptsUsed ?? 0,
        hasDraft: (aggregate?.drafts ?? 0) > 0,
        lastSubmittedAt: aggregate?.lastSubmittedAt ?? null,
      });
    }
  }

  return {
    group,
    activities: activities.results.map((activity) => ({
      id: activity.id,
      slug: activity.slug,
      title: activity.title,
      unitCode: activity.unitCode,
      editorialState: activity.editorialState,
      availabilityStatus: activity.availabilityStatus,
      maxAttempts: activity.maxAttempts,
    })),
    students: students.results.map((student) => ({
      id: student.id,
      displayName: student.displayName,
      username: student.username,
    })),
    cells,
  };
}