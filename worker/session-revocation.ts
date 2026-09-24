/**
 * Revocación global de sesiones de una cuenta (A2.1a).
 *
 * Una cuenta tiene una `auth_version` vigente (`usuarios.auth_version`) y cada
 * sesión conserva la copia que tomó al nacer (`sesiones_usuario.auth_version`).
 * Una sesión es válida solamente si ambas versiones son iguales, así que incrementar
 * la del usuario invalida de una sola vez TODAS sus sesiones, en cualquier dispositivo.
 *
 * Esta primitiva es interna: todavía no se expone por HTTP. La usan los bloques que
 * necesiten revocar (cambio de contraseña, restablecimiento administrativo, decisión
 * de seguridad) y las pruebas locales contra workerd + D1.
 *
 * Propiedades que debe conservar cualquier cambio:
 *
 *   1. Atomicidad: las tres escrituras (versión, revocación explícita de sesiones y
 *      auditoría) viajan en un único `db.batch()`, que D1 ejecuta como una sola
 *      transacción. Si una falla, no se aplica ninguna.
 *   2. Fail-closed: el incremento NO lleva una condición de techo. Si una cuenta
 *      llegara al máximo del CHECK de `0012`, el incremento viola la restricción, el
 *      batch completo se aborta y no queda ni una sesión revocada ni un evento de
 *      auditoría a medias. Nunca se "satura" la versión en silencio.
 *   3. Sin eventos fantasma: la auditoría se escribe con `WHERE EXISTS`, así que una
 *      cuenta inexistente no deja ningún evento.
 *   4. Sin secretos: la auditoría sólo guarda acción, entidad, actor y motivo.
 */
export const SESSION_REVOCATION_REASONS = ["admin", "password_change", "password_reset", "security"] as const;

export type SessionRevocationReason = (typeof SESSION_REVOCATION_REASONS)[number];

export type SessionRevocationErrorCode = "INVALID_REQUEST" | "USER_NOT_FOUND" | "REVOCATION_ABORTED";

export class SessionRevocationError extends Error {
  constructor(
    public readonly status: 400 | 404 | 500,
    public readonly code: SessionRevocationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SessionRevocationError";
  }
}

export type SessionRevocationOptions = {
  reason: SessionRevocationReason;
  /** Actor responsable cuando la revocación nace de una acción humana; `null` si es interna. */
  actorUserId?: number | null;
};

export type SessionRevocationResult = {
  /** Versión de autenticación que quedó vigente para la cuenta. */
  authVersion: number;
  /** Cantidad de sesiones que se revocaron explícitamente en esta operación. */
  revokedSessions: number;
};

const REVOCATION_REASONS = new Set<string>(SESSION_REVOCATION_REASONS);

function validUserId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Revoca todas las sesiones vigentes de una cuenta.
 *
 * Devuelve la versión resultante y cuántas sesiones se revocaron. Es idempotente como
 * operación: repetirla vuelve a incrementar la versión (toda sesión anterior sigue
 * siendo inválida) y la segunda corrida informa `revokedSessions: 0`.
 */
export async function revokeAllSessions(
  db: D1Database,
  userId: number,
  options: SessionRevocationOptions,
): Promise<SessionRevocationResult> {
  if (!validUserId(userId)) {
    throw new SessionRevocationError(400, "INVALID_REQUEST", "La cuenta indicada no es válida.");
  }
  const reason = options?.reason;
  if (typeof reason !== "string" || !REVOCATION_REASONS.has(reason)) {
    throw new SessionRevocationError(400, "INVALID_REQUEST", "Debe indicarse un motivo de revocación válido.");
  }
  const actorUserId = options.actorUserId ?? null;
  if (actorUserId !== null && !validUserId(actorUserId)) {
    throw new SessionRevocationError(400, "INVALID_REQUEST", "El actor indicado no es válido.");
  }

  let results: D1Result[];
  try {
    results = await db.batch([
      // 1) Versión nueva. Sin condición de techo: el CHECK de 0012 decide y, si falla,
      //    aborta todo el batch en lugar de dejar la cuenta a medio revocar.
      db.prepare("UPDATE usuarios SET auth_version = auth_version + 1 WHERE id = ?1").bind(userId),
      // 2) Revocación explícita, para que el corte sea inmediato y no dependa sólo de la
      //    comparación de versiones. No se borran filas: la sesión conserva su historia.
      db.prepare(`
        UPDATE sesiones_usuario
        SET revocada_en = CURRENT_TIMESTAMP
        WHERE usuario_id = ?1
          AND revocada_en IS NULL
          AND expira_en > CURRENT_TIMESTAMP
      `).bind(userId),
      // 3) Auditoría con metadata mínima. El `WHERE EXISTS` evita un evento fantasma de
      //    una cuenta inexistente y mantiene el batch como única transacción. Los
      //    identificadores se convierten explícitamente a entero antes del texto: un
      //    parámetro numérico llega a SQLite como real y `CAST(1.0 AS TEXT)` sería `1.0`,
      //    que no coincide con los `entidad_id` que produce el resto de la auditoría.
      db.prepare(`
        INSERT INTO eventos_auditoria (actor_usuario_id, accion, entidad_tipo, entidad_id, datos_json)
        SELECT CAST(?1 AS INTEGER), 'sessions_revoked', 'usuario', CAST(CAST(?2 AS INTEGER) AS TEXT), ?3
        WHERE EXISTS (SELECT 1 FROM usuarios WHERE id = ?2)
      `).bind(actorUserId, userId, JSON.stringify({ motivo: reason })),
      // 4) Lectura de la versión resultante dentro de la misma transacción.
      //    `db.batch()` devuelve `meta.changes` por sentencia, pero no el valor de una
      //    columna actualizada; esta cuarta sentencia es de sólo lectura, participa del
      //    mismo batch atómico y evita depender de `RETURNING`, que la API tipada de D1
      //    no documenta para `batch()`.
      db.prepare("SELECT auth_version AS authVersion FROM usuarios WHERE id = ?1").bind(userId),
    ]);
  } catch {
    // El mensaje crudo del motor no se propaga ni se registra aquí (puede incluir SQL).
    // El llamador debe registrar un mensaje fijo y responder con un error saneado.
    throw new SessionRevocationError(500, "REVOCATION_ABORTED", "No fue posible revocar las sesiones de la cuenta.");
  }

  const versionRow = results[3]?.results?.[0] as { authVersion?: unknown } | undefined;
  const authVersion = versionRow?.authVersion;
  if (typeof authVersion !== "number") {
    // La cuenta no existe. Las tres sentencias anteriores fueron no-ops —la auditoría
    // exige la existencia de la fila— así que no hay nada que revertir ni evento fantasma.
    throw new SessionRevocationError(404, "USER_NOT_FOUND", "La cuenta indicada no existe.");
  }
  if (results[0]?.meta?.changes !== 1) {
    // La versión se leyó pero no se incrementó: el estado no es el esperado. Falla
    // cerrada en lugar de devolver una versión que no corresponde a esta operación.
    throw new SessionRevocationError(500, "REVOCATION_ABORTED", "No fue posible revocar las sesiones de la cuenta.");
  }
  return { authVersion, revokedSessions: results[1]?.meta?.changes ?? 0 };
}
