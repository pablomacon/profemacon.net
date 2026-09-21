import { requireTeacherGroupScope } from "./teacher-group-scope";

export class TeacherActivityManagementError extends Error {
  constructor(public readonly status: 400 | 403 | 404, public readonly code: string, message: string) { super(message); }
}

const isoUtc = (value: unknown) => {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/.test(value)) throw new TeacherActivityManagementError(400, "INVALID_DATE", "La fecha debe ser ISO UTC válida.");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TeacherActivityManagementError(400, "INVALID_DATE", "La fecha debe ser ISO UTC válida.");
  return parsed.toISOString();
};

export async function listTeacherGroupActivities(db: D1Database, userId: number, groupId: number) {
  const group = await requireTeacherGroupScope(db, userId, groupId);
  const result = await db.prepare(`SELECT a.id,a.slug,a.titulo AS title,a.estado AS editorialState,a.unidad_codigo AS unitCode,a.maximo_intentos AS maxAttempts,h.id AS availabilityId,h.habilitada AS enabled,h.disponible_desde AS opensAt,h.disponible_hasta AS closesAt,CASE WHEN h.id IS NULL OR h.habilitada=0 THEN 'disabled' WHEN h.disponible_desde IS NOT NULL AND datetime(h.disponible_desde)>datetime('now') THEN 'not_open' WHEN h.disponible_hasta IS NOT NULL AND datetime(h.disponible_hasta)<datetime('now') THEN 'closed' ELSE 'available' END AS availabilityStatus,COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM usuario_roles ur JOIN roles r ON r.id=ur.rol_id WHERE ur.usuario_id=i.usuario_id AND r.codigo='estudiante') THEN i.usuario_id END) AS participants FROM actividades a LEFT JOIN habilitaciones_actividad h ON h.actividad_id=a.id AND h.grupo_id=?1 LEFT JOIN intentos_actividad i ON i.actividad_id=a.id AND i.habilitacion_id=h.id WHERE a.edicion_anual_id=?2 GROUP BY a.id,h.id ORDER BY a.orden,a.titulo`).bind(groupId,group.editionId).all();
  return { group, activities: result.results };
}

export async function saveTeacherAvailability(db: D1Database, userId: number, groupId: number, activityId: number, payload: unknown) {
  if (!payload || typeof payload !== "object") throw new TeacherActivityManagementError(400, "INVALID_REQUEST", "Configuración inválida.");
  const value = payload as { enabled?: unknown; opensAt?: unknown; closesAt?: unknown };
  if (typeof value.enabled !== "boolean") throw new TeacherActivityManagementError(400, "INVALID_REQUEST", "Indicá si la actividad está habilitada.");
  const group = await requireTeacherGroupScope(db, userId, groupId, activityId);
  const opensAt = isoUtc(value.opensAt), closesAt = isoUtc(value.closesAt);
  if (opensAt && closesAt && opensAt >= closesAt) throw new TeacherActivityManagementError(400, "INVALID_WINDOW", "La apertura debe ser anterior al cierre.");
  await db.prepare(`INSERT INTO habilitaciones_actividad (actividad_id,grupo_id,habilitada,disponible_desde,disponible_hasta) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(actividad_id,grupo_id) DO UPDATE SET habilitada=excluded.habilitada,disponible_desde=excluded.disponible_desde,disponible_hasta=excluded.disponible_hasta`).bind(activityId,group.id,value.enabled?1:0,opensAt,closesAt).run();
  return { groupId: group.id, activityId, enabled: value.enabled, opensAt, closesAt };
}
