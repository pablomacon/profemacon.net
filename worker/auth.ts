export type AuthenticatedUser = {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
};

export const SESSION_COOKIE = "pm_session";

function readCookie(request: Request, name: string) {
  const header = request.headers.get("Cookie");
  if (!header) return null;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key === name) return part.slice(separator + 1).trim();
  }

  return null;
}

import { sha256Hex } from "./auth-crypto";

export async function authenticateRequest(request: Request, db: D1Database): Promise<AuthenticatedUser | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || token.length < 32 || token.length > 256) return null;

  const tokenHash = await sha256Hex(token);
  const row = await db.prepare(`
    SELECT
      s.id AS sessionId,
      u.id,
      u.nombre_usuario AS username,
      u.nombre_mostrado AS displayName,
      u.correo AS email
    FROM sesiones_usuario s
    JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token_hash = ?1
      AND s.revocada_en IS NULL
      AND s.expira_en > CURRENT_TIMESTAMP
      AND COALESCE(s.ultimo_uso_en, s.creada_en) > datetime('now', '-30 minutes')
      AND u.estado = 'activo'
    LIMIT 1
  `).bind(tokenHash).first<AuthenticatedUser & { sessionId: string }>();

  if (!row) return null;
  await db.prepare(`
    UPDATE sesiones_usuario
    SET ultimo_uso_en = CURRENT_TIMESTAMP
    WHERE id = ?1 AND ultimo_uso_en < datetime('now', '-5 minutes')
  `).bind(row.sessionId).run();
  const { sessionId: _sessionId, ...user } = row;
  return user;
}

export async function listUserRoles(db: D1Database, userId: number) {
  const result = await db.prepare(`
    SELECT r.codigo
    FROM usuario_roles ur
    JOIN roles r ON r.id = ur.rol_id
    WHERE ur.usuario_id = ?1
    ORDER BY r.codigo
  `).bind(userId).all<{ codigo: string }>();

  return result.results.map((row) => row.codigo);
}
