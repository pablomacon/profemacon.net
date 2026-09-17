export type CourseAccess = "estudiante" | "docente" | "practicante";

export type CourseSummary = {
  subjectCode: string;
  subjectName: string;
  year: number;
  editionName: string;
  groupCode: string;
  groupName: string;
  access: CourseAccess;
};

type CourseRow = {
  subjectCode: string;
  subjectName: string;
  year: number;
  editionName: string;
  groupCode: string;
  groupName: string;
  access: CourseAccess;
};

export async function listCoursesForUser(db: D1Database, userId: number): Promise<CourseSummary[]> {
  const result = await db.prepare(`
    SELECT
      a.codigo AS subjectCode,
      a.nombre AS subjectName,
      ea.anio AS year,
      ea.nombre AS editionName,
      g.codigo AS groupCode,
      g.nombre AS groupName,
      'estudiante' AS access
    FROM inscripciones i
    JOIN grupos g ON g.id = i.grupo_id
    JOIN ediciones_anuales ea ON ea.id = g.edicion_anual_id
    JOIN asignaturas a ON a.id = ea.asignatura_id
    WHERE i.usuario_id = ?1
      AND i.estado = 'activa'
      AND g.estado = 'activo'
      AND ea.estado = 'activa'
      AND a.activa = 1

    UNION ALL

    SELECT
      a.codigo AS subjectCode,
      a.nombre AS subjectName,
      ea.anio AS year,
      ea.nombre AS editionName,
      g.codigo AS groupCode,
      g.nombre AS groupName,
      ag.tipo AS access
    FROM asignaciones_grupo ag
    JOIN grupos g ON g.id = ag.grupo_id
    JOIN ediciones_anuales ea ON ea.id = g.edicion_anual_id
    JOIN asignaturas a ON a.id = ea.asignatura_id
    WHERE ag.usuario_id = ?1
      AND ag.estado = 'activa'
      AND g.estado = 'activo'
      AND ea.estado = 'activa'
      AND a.activa = 1

    ORDER BY subjectName, year DESC, groupName, access
  `).bind(userId).all<CourseRow>();

  return result.results;
}
