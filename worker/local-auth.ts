import { assertCredencialVerificable, createPasswordCredential, derivePasswordHash, PASSWORD_POLICY, randomToken, sha256Hex, verifyPassword } from "./auth-crypto";
import { SESSION_COOKIE } from "./auth";

const MAX_BODY_BYTES = 8_192;
const SESSION_HOURS = 8;
const MAX_FAILED_ATTEMPTS = 5;

type CredentialRow = {
  userId: number;
  username: string;
  displayName: string;
  email: string | null;
  algorithm: string;
  format: string;
  iterations: number;
  saltBase64: string;
  hashBase64: string;
  failedAttempts: number;
  blockedUntil: string | null;
};

function cookie(token: string, request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${secure}`;
}

export function clearSessionCookie(request: Request) {
  return `${cookie("", request)}; Max-Age=0`;
}

export function requestHasValidOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  return origin !== null && origin === new URL(request.url).origin;
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const contentLength = Number(request.headers.get("Content-Length") ?? 0);
  if (contentLength > MAX_BODY_BYTES || !request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return null;
  try {
    const value: unknown = await request.json();
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function validUsername(value: unknown) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{2,63}$/i.test(value);
}

function validPassword(value: unknown) {
  return typeof value === "string" && value.length >= 12 && value.length <= 128;
}

function sqliteTimeToMillis(value: string | null) {
  return value ? Date.parse(`${value.replace(" ", "T")}Z`) : 0;
}

async function consumeComparableWork(password: string) {
  // Mismo costo que una verificación real, para no distinguir por tiempo entre un
  // usuario inexistente y una contraseña incorrecta.
  const fixedSalt = new Uint8Array([74, 19, 220, 8, 113, 4, 190, 61, 40, 95, 166, 2, 77, 213, 31, 121]);
  await derivePasswordHash(password, fixedSalt, PASSWORD_POLICY.target);
}

export async function activateLocalAccount(db: D1Database, body: Record<string, unknown>) {
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const activationCode = typeof body.activationCode === "string" ? body.activationCode.trim() : "";
  const password = body.password;
  if (!validUsername(username) || activationCode.length < 16 || activationCode.length > 128 || !validPassword(password)) return null;

  const codeHash = await sha256Hex(activationCode);
  const activation = await db.prepare(`
    SELECT ac.id, ac.usuario_id AS userId
    FROM activaciones_cuenta ac
    JOIN usuarios u ON u.id = ac.usuario_id
    WHERE u.nombre_usuario = ?1 COLLATE NOCASE
      AND u.estado = 'activo'
      AND ac.codigo_hash = ?2
      AND ac.consumida_en IS NULL
      AND ac.revocada_en IS NULL
      AND ac.expira_en > CURRENT_TIMESTAMP
      AND NOT EXISTS (SELECT 1 FROM credenciales_locales c WHERE c.usuario_id = u.id)
    LIMIT 1
  `).bind(username, codeHash).first<{ id: string; userId: number }>();
  if (!activation) return null;

  const credential = await createPasswordCredential(password as string);
  await db.batch([
    db.prepare(`
      INSERT INTO credenciales_locales (usuario_id, algoritmo, formato, iteraciones, sal_base64, hash_base64)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    `).bind(
      activation.userId,
      credential.algorithm,
      credential.format,
      credential.iterations,
      credential.saltBase64,
      credential.hashBase64,
    ),
    db.prepare("UPDATE activaciones_cuenta SET consumida_en = CURRENT_TIMESTAMP WHERE id = ?1 AND consumida_en IS NULL").bind(activation.id),
    db.prepare("INSERT INTO eventos_auditoria (actor_usuario_id, accion, entidad_tipo, entidad_id) VALUES (?1, 'cuenta_activada', 'usuario', CAST(?1 AS TEXT))").bind(activation.userId),
  ]);
  return createLocalSession(db, activation.userId);
}

export async function loginLocalAccount(db: D1Database, body: Record<string, unknown>) {
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!validUsername(username) || !validPassword(password)) return null;

  const row = await db.prepare(`
    SELECT
      u.id AS userId, u.nombre_usuario AS username, u.nombre_mostrado AS displayName, u.correo AS email,
      c.algoritmo AS algorithm, c.formato AS format,
      c.iteraciones AS iterations, c.sal_base64 AS saltBase64, c.hash_base64 AS hashBase64,
      c.intentos_fallidos AS failedAttempts, c.bloqueada_hasta AS blockedUntil
    FROM usuarios u
    JOIN credenciales_locales c ON c.usuario_id = u.id
    WHERE u.nombre_usuario = ?1 COLLATE NOCASE AND u.estado = 'activo'
    LIMIT 1
  `).bind(username).first<CredentialRow>();

  if (!row) {
    await consumeComparableWork(password);
    return null;
  }

  // Guarda de política antes de derivar: una credencial fuera del rango soportado
  // falla cerrada. No cuenta como intento fallido, no bloquea la cuenta, no crea
  // sesión y no se sustituye el costo por el objetivo vigente.
  assertCredencialVerificable(row);

  if (sqliteTimeToMillis(row.blockedUntil) > Date.now()) return null;
  const passwordMatches = await verifyPassword(password, row.saltBase64, row.hashBase64, row.iterations);
  if (!passwordMatches) {
    const previousFailures = row.blockedUntil ? 0 : row.failedAttempts;
    const failures = previousFailures + 1;
    await db.prepare(`
      UPDATE credenciales_locales
      SET intentos_fallidos = ?2,
          bloqueada_hasta = CASE WHEN ?2 >= ${MAX_FAILED_ATTEMPTS} THEN datetime('now', '+15 minutes') ELSE NULL END
      WHERE usuario_id = ?1
    `).bind(row.userId, failures).run();
    return null;
  }

  await db.prepare("UPDATE credenciales_locales SET intentos_fallidos = 0, bloqueada_hasta = NULL WHERE usuario_id = ?1").bind(row.userId).run();
  return createLocalSession(db, row.userId);
}

async function createLocalSession(db: D1Database, userId: number) {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const sessionId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO sesiones_usuario (id, usuario_id, token_hash, expira_en, ultimo_uso_en)
    VALUES (?1, ?2, ?3, datetime('now', '+${SESSION_HOURS} hours'), CURRENT_TIMESTAMP)
  `).bind(sessionId, userId, tokenHash).run();
  return { token };
}

export async function revokeLocalSession(request: Request, db: D1Database) {
  const header = request.headers.get("Cookie") ?? "";
  const token = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!token) return;
  const tokenHash = await sha256Hex(token);
  await db.prepare("UPDATE sesiones_usuario SET revocada_en = CURRENT_TIMESTAMP WHERE token_hash = ?1 AND revocada_en IS NULL").bind(tokenHash).run();
}

export function sessionCookie(token: string, request: Request) {
  return cookie(token, request);
}
