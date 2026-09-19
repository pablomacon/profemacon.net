import { randomToken, sha256Hex } from "./auth-crypto.ts";

const REISSUE_REASONS = new Set(["no_recibido", "perdido", "vencido"]);

type ReissuePayload = { userId: number; groupId: number; reason: "no_recibido" | "perdido" | "vencido" };
type CandidateRow = {
  userId: number;
  username: string;
  displayName: string;
  groupId: number;
  groupCode: string;
  groupName: string;
  activationExpiresAt: string | null;
};

export class ActivationAdminError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function parseReissuePayload(body: Record<string, unknown>): ReissuePayload {
  const userId = body.userId;
  const groupId = body.groupId;
  const reason = body.reason;
  if (!Number.isInteger(userId) || Number(userId) <= 0 || !Number.isInteger(groupId) || Number(groupId) <= 0) {
    throw new ActivationAdminError("La cuenta y el grupo son obligatorios.");
  }
  if (typeof reason !== "string" || !REISSUE_REASONS.has(reason)) throw new ActivationAdminError("Debe indicarse un motivo válido.");
  return { userId: Number(userId), groupId: Number(groupId), reason: reason as ReissuePayload["reason"] };
}

export async function listActivationCandidates(db: D1Database, actorUserId: number) {
  const result = await db.prepare(`
    SELECT
      u.id AS userId, u.nombre_usuario AS username, u.nombre_mostrado AS displayName,
      g.id AS groupId, g.codigo AS groupCode, g.nombre AS groupName,
      (
        SELECT MAX(ac.expira_en) FROM activaciones_cuenta ac
        WHERE ac.usuario_id = u.id AND ac.consumida_en IS NULL AND ac.revocada_en IS NULL
          AND ac.expira_en > CURRENT_TIMESTAMP
      ) AS activationExpiresAt
    FROM inscripciones i
    JOIN usuarios u ON u.id = i.usuario_id
    JOIN grupos g ON g.id = i.grupo_id
    JOIN ediciones_anuales ea ON ea.id = g.edicion_anual_id
    JOIN asignaturas a ON a.id = ea.asignatura_id
    WHERE i.estado = 'activa' AND u.estado = 'activo' AND g.estado = 'activo'
      AND ea.estado = 'activa' AND a.activa = 1
      AND NOT EXISTS (SELECT 1 FROM credenciales_locales c WHERE c.usuario_id = u.id)
      AND (
        EXISTS (
          SELECT 1 FROM usuario_roles ur JOIN roles r ON r.id = ur.rol_id
          WHERE ur.usuario_id = ?1 AND r.codigo = 'administrador'
        )
        OR EXISTS (
          SELECT 1 FROM asignaciones_grupo ag
          WHERE ag.usuario_id = ?1 AND ag.grupo_id = g.id
            AND ag.tipo = 'docente' AND ag.estado = 'activa'
        )
      )
    ORDER BY g.nombre, u.apellidos, u.nombres, u.nombre_mostrado
  `).bind(actorUserId).all<CandidateRow>();
  return { candidates: result.results };
}

export async function reissueAccountActivation(db: D1Database, actorUserId: number, payload: ReissuePayload) {
  const target = await db.prepare(`
    SELECT u.id AS userId, u.nombre_usuario AS username, u.nombre_mostrado AS displayName,
      g.id AS groupId, g.codigo AS groupCode, g.nombre AS groupName
    FROM inscripciones i
    JOIN usuarios u ON u.id = i.usuario_id
    JOIN grupos g ON g.id = i.grupo_id
    JOIN ediciones_anuales ea ON ea.id = g.edicion_anual_id
    JOIN asignaturas a ON a.id = ea.asignatura_id
    WHERE u.id = ?1 AND g.id = ?2
      AND i.estado = 'activa' AND u.estado = 'activo' AND g.estado = 'activo'
      AND ea.estado = 'activa' AND a.activa = 1
      AND NOT EXISTS (SELECT 1 FROM credenciales_locales c WHERE c.usuario_id = u.id)
      AND (
        EXISTS (
          SELECT 1 FROM usuario_roles ur JOIN roles r ON r.id = ur.rol_id
          WHERE ur.usuario_id = ?3 AND r.codigo = 'administrador'
        )
        OR EXISTS (
          SELECT 1 FROM asignaciones_grupo ag
          WHERE ag.usuario_id = ?3 AND ag.grupo_id = g.id
            AND ag.tipo = 'docente' AND ag.estado = 'activa'
        )
      )
    LIMIT 1
  `).bind(payload.userId, payload.groupId, actorUserId).first<Omit<CandidateRow, "activationExpiresAt">>();
  if (!target) throw new ActivationAdminError("No es posible reemitir la activación para esa cuenta y grupo.", 403);

  const activationCode = randomToken(24);
  const activationHash = await sha256Hex(activationCode);
  const activationId = crypto.randomUUID();
  await db.batch([
    db.prepare(`
      UPDATE activaciones_cuenta SET revocada_en = CURRENT_TIMESTAMP
      WHERE usuario_id = ?1 AND consumida_en IS NULL AND revocada_en IS NULL
    `).bind(target.userId),
    db.prepare(`
      INSERT INTO activaciones_cuenta (id, usuario_id, codigo_hash, expira_en)
      VALUES (?1, ?2, ?3, datetime('now', '+14 days'))
    `).bind(activationId, target.userId, activationHash),
    db.prepare(`
      INSERT INTO eventos_auditoria (actor_usuario_id, accion, entidad_tipo, entidad_id, datos_json)
      VALUES (?1, 'activacion_cuenta_reemitida', 'usuario', CAST(?2 AS TEXT), ?3)
    `).bind(actorUserId, target.userId, JSON.stringify({ groupId: target.groupId, reason: payload.reason })),
  ]);

  return {
    group: { id: target.groupId, code: target.groupCode, name: target.groupName },
    credential: { displayName: target.displayName, username: target.username, activationCode },
    expiresInDays: 14,
    activationCodeIsShownOnce: true,
  };
}
