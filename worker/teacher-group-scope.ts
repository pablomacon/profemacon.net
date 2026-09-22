import { listUserRoles } from "./auth";

export class TeacherGroupScopeError extends Error {
  constructor(public readonly status: 403 | 404, public readonly code: "TEACHER_ROLE_REQUIRED" | "TEACHER_GROUP_REQUIRED" | "GROUP_NOT_FOUND" | "STUDENT_NOT_FOUND", message: string) { super(message); }
}

export type TeacherGroupScope = { id: number; code: string; name: string; subjectCode: string; subjectName: string; editionId: number; editionName: string; year: number; activeStudents: number };

export type TeacherGroupStudentScope = { id: number; displayName: string; username: string };

export async function requireTeacherGroupScope(db: D1Database, userId: number, groupId: number, activityId?: number) {
  if (!(await listUserRoles(db, userId)).includes("docente")) throw new TeacherGroupScopeError(403, "TEACHER_ROLE_REQUIRED", "Se requiere el rol docente.");
  const group = await db.prepare(`
    SELECT g.id, g.codigo AS code, g.nombre AS name, a.codigo AS subjectCode, a.nombre AS subjectName,
      ea.id AS editionId, ea.nombre AS editionName, ea.anio AS year,
      COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM usuario_roles ur JOIN roles r ON r.id=ur.rol_id WHERE ur.usuario_id=i.usuario_id AND r.codigo='estudiante') THEN i.usuario_id END) AS activeStudents
    FROM grupos g JOIN ediciones_anuales ea ON ea.id=g.edicion_anual_id JOIN asignaturas a ON a.id=ea.asignatura_id
    JOIN asignaciones_grupo ag ON ag.grupo_id=g.id AND ag.usuario_id=?1 AND ag.tipo='docente' AND ag.estado='activa'
    LEFT JOIN inscripciones i ON i.grupo_id=g.id AND i.estado='activa'
    WHERE g.id=?2 AND g.estado='activo' GROUP BY g.id
  `).bind(userId, groupId).first<TeacherGroupScope>();
  if (!group) {
    const exists = await db.prepare("SELECT 1 FROM grupos WHERE id=?1").bind(groupId).first();
    throw new TeacherGroupScopeError(exists ? 403 : 404, exists ? "TEACHER_GROUP_REQUIRED" : "GROUP_NOT_FOUND", exists ? "No tenés acceso a este grupo." : "El grupo no fue encontrado.");
  }
  if (activityId) {
    const matches = await db.prepare("SELECT 1 FROM actividades WHERE id=?1 AND edicion_anual_id=?2").bind(activityId, group.editionId).first();
    if (!matches) throw new TeacherGroupScopeError(403, "TEACHER_GROUP_REQUIRED", "La actividad no corresponde a este grupo.");
  }
  return group;
}

// C3: el estudiante se valida dentro del grupo ya autorizado. `studentId` es
// sólo un selector de routing: la autorización sale de la inscripción activa,
// del rol `estudiante` y del usuario activo dentro de ese grupo. El error nunca
// revela si el estudiante pertenece a otro grupo.
export async function requireTeacherGroupStudentScope(db: D1Database, userId: number, groupId: number, studentId: number) {
  const group = await requireTeacherGroupScope(db, userId, groupId);
  const student = await db.prepare(`
    SELECT u.id, u.nombre_mostrado AS displayName, u.nombre_usuario AS username
    FROM inscripciones i
    JOIN usuarios u ON u.id = i.usuario_id
    JOIN usuario_roles ur ON ur.usuario_id = u.id
    JOIN roles r ON r.id = ur.rol_id AND r.codigo = 'estudiante'
    WHERE i.grupo_id = ?1 AND i.estado = 'activa' AND u.estado = 'activo' AND u.id = ?2
    LIMIT 1
  `).bind(groupId, studentId).first<TeacherGroupStudentScope>();
  if (!student) {
    const exists = await db.prepare("SELECT 1 FROM usuarios WHERE id = ?1").bind(studentId).first();
    throw new TeacherGroupScopeError(exists ? 403 : 404, exists ? "TEACHER_GROUP_REQUIRED" : "STUDENT_NOT_FOUND", exists ? "El estudiante no pertenece a este grupo." : "El estudiante no fue encontrado.");
  }
  return { group, student };
}

export async function listTeacherGroups(db: D1Database, userId: number) {
  if (!(await listUserRoles(db, userId)).includes("docente")) throw new TeacherGroupScopeError(403, "TEACHER_ROLE_REQUIRED", "Se requiere el rol docente.");
  const result = await db.prepare(`
    SELECT g.id, g.codigo AS code, g.nombre AS name, a.codigo AS subjectCode, a.nombre AS subjectName,
      ea.id AS editionId, ea.nombre AS editionName, ea.anio AS year, COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM usuario_roles ur JOIN roles r ON r.id=ur.rol_id WHERE ur.usuario_id=i.usuario_id AND r.codigo='estudiante') THEN i.usuario_id END) AS activeStudents
    FROM asignaciones_grupo ag JOIN grupos g ON g.id=ag.grupo_id JOIN ediciones_anuales ea ON ea.id=g.edicion_anual_id JOIN asignaturas a ON a.id=ea.asignatura_id
    LEFT JOIN inscripciones i ON i.grupo_id=g.id AND i.estado='activa'
    WHERE ag.usuario_id=?1 AND ag.tipo='docente' AND ag.estado='activa' AND g.estado='activo'
    GROUP BY g.id ORDER BY ea.anio DESC, a.nombre, g.codigo, g.nombre
  `).bind(userId).all<TeacherGroupScope>();
  return { groups: result.results };
}
