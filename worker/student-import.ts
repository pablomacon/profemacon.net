import { randomToken, sha256Hex } from "./auth-crypto.ts";

const MAX_IMPORT_BODY_BYTES = 512 * 1024;
const MAX_STUDENTS = 500;
const DOCUMENT_TYPES = new Set(["cedula_uy", "pasaporte", "otro"]);

type ImportSource = {
  filename: string;
  subjectLabel: string;
  groupSourceLabel: string;
  academicYear: number;
  fileSha256: string;
  rejectedRows: number;
};

type ImportStudent = {
  sourceRow: number;
  givenNames: string;
  surnames: string;
  document: string;
  documentType: "cedula_uy" | "pasaporte" | "otro";
  countryCode: string;
};

type ImportPayload = { source: ImportSource; students: ImportStudent[] };

type GroupMapping = { groupId: number; groupCode: string; groupName: string };
type ExistingAccount = { userId: number; username: string; displayName: string; state: string; hasCredential: number };

type PlannedStudent = ImportStudent & {
  displayName: string;
  documentHmac: string;
  documentEnding: string;
  username: string;
  existing: ExistingAccount | null;
};

export class StudentImportError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function compactSpaces(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeSourceLabel(value: string) {
  return compactSpaces(value.replace(/_+/g, " ")).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function normalizeImportDocument(value: string) {
  const normalized = compactSpaces(value).normalize("NFKC").replace(/[.\s-]/g, "").toUpperCase();
  if (!/^[A-Z0-9]{5,30}$/.test(normalized)) throw new StudentImportError("Hay un documento con formato no admitido.");
  return normalized;
}

function usernameToken(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function importedUsernameBase(givenNames: string, surnames: string) {
  const particles = new Set(["de", "del", "la", "las", "los", "y", "da", "do", "dos"]);
  const given = compactSpaces(givenNames).split(" ").map(usernameToken).find(Boolean);
  const surnameTokens = compactSpaces(surnames).split(" ").map(usernameToken).filter(Boolean);
  const surname = surnameTokens.find((token) => !particles.has(token)) ?? surnameTokens[0];
  if (!given || !surname) throw new StudentImportError("No fue posible generar un nombre de usuario.");
  return `${given}.${surname}`.slice(0, 48);
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function documentHmac(secret: string, type: string, countryCode: string, document: string) {
  if (secret.length < 32) throw new StudentImportError("La clave de proteccion documental no esta configurada.", 503);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${type}:${countryCode}:${document}`));
  return bytesToHex(new Uint8Array(signature));
}

export function finalImportedUsername(givenNames: string, surnames: string, hmac: string, suffixLength = 12) {
  if (!/^[a-f0-9]{64}$/.test(hmac) || suffixLength < 8 || suffixLength > 32) throw new StudentImportError("No fue posible generar un nombre de usuario seguro.");
  return `${importedUsernameBase(givenNames, surnames)}.${hmac.slice(0, suffixLength)}`;
}

function requiredString(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string") throw new StudentImportError(`${label} es obligatorio.`);
  const normalized = compactSpaces(value);
  if (!normalized || normalized.length > maxLength) throw new StudentImportError(`${label} tiene una longitud invalida.`);
  return normalized;
}

function parsePayload(body: Record<string, unknown>): ImportPayload {
  if (!body.source || typeof body.source !== "object" || Array.isArray(body.source) || !Array.isArray(body.students)) {
    throw new StudentImportError("La solicitud de importacion esta incompleta.");
  }
  const sourceBody = body.source as Record<string, unknown>;
  const filename = requiredString(sourceBody.filename, "El nombre del archivo", 180);
  if (!/^[^\\/]+\.xlsx$/i.test(filename)) throw new StudentImportError("El nombre del archivo de origen no es valido.");
  const subjectLabel = requiredString(sourceBody.subjectLabel, "La asignatura de origen", 100);
  const groupSourceLabel = requiredString(sourceBody.groupSourceLabel, "El grupo de origen", 100);
  const academicYear = sourceBody.academicYear;
  const fileSha256 = typeof sourceBody.fileSha256 === "string" ? sourceBody.fileSha256.toLowerCase() : "";
  const rejectedRows = sourceBody.rejectedRows ?? 0;
  if (!Number.isInteger(academicYear) || Number(academicYear) < 2020 || Number(academicYear) > 2100) throw new StudentImportError("El anio academico no es valido.");
  if (!/^[a-f0-9]{64}$/.test(fileSha256)) throw new StudentImportError("La huella del archivo no es valida.");
  if (!Number.isInteger(rejectedRows) || Number(rejectedRows) < 0 || Number(rejectedRows) > MAX_STUDENTS) throw new StudentImportError("La cantidad de filas rechazadas no es valida.");
  const filenameMatch = /^Portafolio_(.+?)_(Grupo_.+?)_(\d{4})_(\d{4}-\d{2}-\d{2})\.xlsx$/i.exec(filename);
  if (!filenameMatch
    || normalizeSourceLabel(filenameMatch[1]) !== normalizeSourceLabel(subjectLabel)
    || normalizeSourceLabel(filenameMatch[2]) !== normalizeSourceLabel(groupSourceLabel)
    || Number(filenameMatch[3]) !== Number(academicYear)) {
    throw new StudentImportError("Los metadatos no coinciden con el nombre del portafolio.");
  }
  if (body.students.length === 0 || body.students.length > MAX_STUDENTS) throw new StudentImportError(`El lote debe contener entre 1 y ${MAX_STUDENTS} estudiantes.`);

  const students = body.students.map((raw, index): ImportStudent => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new StudentImportError(`La fila ${index + 1} no es valida.`);
    const row = raw as Record<string, unknown>;
    const sourceRow = row.sourceRow;
    const documentType = row.documentType;
    const countryCode = typeof row.countryCode === "string" ? row.countryCode.trim().toUpperCase() : "";
    if (!Number.isInteger(sourceRow) || Number(sourceRow) < 2) throw new StudentImportError(`La fila ${index + 1} no tiene un numero de origen valido.`);
    if (typeof documentType !== "string" || !DOCUMENT_TYPES.has(documentType)) throw new StudentImportError(`Debe confirmarse el tipo de documento de la fila ${sourceRow}.`);
    if (!/^[A-Z]{2}$/.test(countryCode)) throw new StudentImportError(`Debe confirmarse el pais emisor de la fila ${sourceRow}.`);
    if (documentType === "cedula_uy" && countryCode !== "UY") throw new StudentImportError(`La cedula uruguaya de la fila ${sourceRow} debe usar el pais UY.`);
    return {
      sourceRow: Number(sourceRow),
      givenNames: requiredString(row.givenNames, `Los nombres de la fila ${sourceRow}`, 120),
      surnames: requiredString(row.surnames, `Los apellidos de la fila ${sourceRow}`, 120),
      document: normalizeImportDocument(requiredString(row.document, `El documento de la fila ${sourceRow}`, 40)),
      documentType: documentType as ImportStudent["documentType"],
      countryCode,
    };
  });

  if (new Set(students.map((student) => student.sourceRow)).size !== students.length) throw new StudentImportError("El lote repite numeros de fila de origen.");
  return { source: { filename, subjectLabel, groupSourceLabel, academicYear: Number(academicYear), fileSha256, rejectedRows: Number(rejectedRows) }, students };
}

export async function readStudentImportBody(request: Request) {
  const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (!contentType.startsWith("application/json") || length > MAX_IMPORT_BODY_BYTES) throw new StudentImportError("La solicitud debe ser JSON y respetar el limite de tamano.");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BODY_BYTES) throw new StudentImportError("El lote supera el limite permitido.", 413);
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return parsePayload(value as Record<string, unknown>);
  } catch (error) {
    if (error instanceof StudentImportError) throw error;
    throw new StudentImportError("El JSON de importacion no es valido.");
  }
}

async function resolveAuthorizedGroup(db: D1Database, userId: number, source: ImportSource) {
  const mapping = await db.prepare(`
    SELECT m.grupo_id AS groupId, g.codigo AS groupCode, g.nombre AS groupName
    FROM mapeos_grupo_origen m
    JOIN grupos g ON g.id = m.grupo_id
    WHERE m.sistema = 'portafolio'
      AND m.asignatura_fuente_normalizada = ?1
      AND m.grupo_fuente_normalizado = ?2
      AND m.anio_fuente = ?3
      AND m.estado = 'activo'
      AND g.estado = 'activo'
      AND (
        EXISTS (
          SELECT 1 FROM usuario_roles ur JOIN roles r ON r.id = ur.rol_id
          WHERE ur.usuario_id = ?4 AND r.codigo = 'administrador'
        )
        OR EXISTS (
          SELECT 1 FROM asignaciones_grupo ag
          WHERE ag.usuario_id = ?4 AND ag.grupo_id = m.grupo_id
            AND ag.tipo = 'docente' AND ag.estado = 'activa'
        )
      )
    LIMIT 1
  `).bind(normalizeSourceLabel(source.subjectLabel), normalizeSourceLabel(source.groupSourceLabel), source.academicYear, userId).first<GroupMapping>();
  if (!mapping) throw new StudentImportError("No existe un mapeo activo para este portafolio o el usuario no administra ese grupo.", 403);
  return mapping;
}

async function planImport(db: D1Database, userId: number, secret: string, payload: ImportPayload) {
  const group = await resolveAuthorizedGroup(db, userId, payload.source);
  const alreadyApplied = await db.prepare(`
    SELECT 1 AS found FROM importaciones_estudiantes
    WHERE grupo_id = ?1 AND archivo_sha256 = ?2 AND estado = 'aplicada' LIMIT 1
  `).bind(group.groupId, payload.source.fileSha256).first<{ found: number }>();
  if (alreadyApplied) throw new StudentImportError("Este archivo ya fue aplicado al grupo.", 409);

  const enriched = await Promise.all(payload.students.map(async (student) => {
    const hmac = await documentHmac(secret, student.documentType, student.countryCode, student.document);
    return { ...student, displayName: `${student.givenNames} ${student.surnames}`, documentHmac: hmac, documentEnding: student.document.slice(-4) };
  }));
  if (new Set(enriched.map((student) => student.documentHmac)).size !== enriched.length) throw new StudentImportError("El lote contiene documentos repetidos.");

  const existingQueries = enriched.map((student) => db.prepare(`
    SELECT u.id AS userId, u.nombre_usuario AS username, u.nombre_mostrado AS displayName, u.estado AS state,
      EXISTS (SELECT 1 FROM credenciales_locales c WHERE c.usuario_id = u.id) AS hasCredential
    FROM documentos_usuario d JOIN usuarios u ON u.id = d.usuario_id
    WHERE d.tipo = ?1 AND d.pais_emisor = ?2 AND d.valor_hmac = ?3 AND d.estado != 'anulado'
    LIMIT 1
  `).bind(student.documentType, student.countryCode, student.documentHmac));
  const existingResults = await db.batch<ExistingAccount>(existingQueries);

  const provisional = enriched.map((student, index): PlannedStudent => {
    const existing = existingResults[index]?.results?.[0] ?? null;
    if (existing && existing.state !== "activo") throw new StudentImportError(`La cuenta coincidente con la fila ${student.sourceRow} no esta activa.`, 409);
    return { ...student, existing, username: existing?.username ?? finalImportedUsername(student.givenNames, student.surnames, student.documentHmac) };
  });

  const newStudents = provisional.filter((student) => !student.existing);
  if (new Set(newStudents.map((student) => student.username.toLowerCase())).size !== newStudents.length) throw new StudentImportError("Se produjo una colision interna de nombres de usuario.", 409);
  if (newStudents.length) {
    const usernameResults = await db.batch<{ id: number }>(newStudents.map((student) => db.prepare(
      "SELECT id FROM usuarios WHERE nombre_usuario = ?1 COLLATE NOCASE LIMIT 1",
    ).bind(student.username)));
    const conflict = usernameResults.findIndex((result) => result.results.length > 0);
    if (conflict >= 0) throw new StudentImportError(`El nombre de usuario propuesto para la fila ${newStudents[conflict].sourceRow} ya existe.`, 409);
  }
  return { group, students: provisional };
}

function publicPlan(source: ImportSource, group: GroupMapping, students: PlannedStudent[]) {
  return {
    source: { filename: source.filename, subjectLabel: source.subjectLabel, groupSourceLabel: source.groupSourceLabel, academicYear: source.academicYear, fileSha256: source.fileSha256 },
    targetGroup: { id: group.groupId, code: group.groupCode, name: group.groupName },
    summary: {
      readRows: students.length + source.rejectedRows,
      validRows: students.length,
      rejectedRows: source.rejectedRows,
      newAccounts: students.filter((student) => !student.existing).length,
      existingAccounts: students.filter((student) => student.existing).length,
      activationCodes: students.filter((student) => !student.existing || student.existing.hasCredential === 0).length,
    },
    students: students.map((student) => ({
      sourceRow: student.sourceRow,
      displayName: student.existing?.displayName ?? student.displayName,
      username: student.username,
      action: !student.existing ? "create_and_enroll" : student.existing.hasCredential === 0 ? "enroll_and_reactivate" : "enroll_existing",
      documentEnding: student.documentEnding,
    })),
  };
}

export async function previewStudentImport(db: D1Database, userId: number, secret: string, payload: ImportPayload) {
  const plan = await planImport(db, userId, secret, payload);
  return publicPlan(payload.source, plan.group, plan.students);
}

export async function applyStudentImport(db: D1Database, userId: number, secret: string, payload: ImportPayload) {
  if (payload.source.rejectedRows > 0) throw new StudentImportError("No se puede aplicar un lote mientras tenga filas rechazadas.", 409);
  const plan = await planImport(db, userId, secret, payload);
  const importId = crypto.randomUUID();
  const activationByRow = new Map<number, { id: string; code: string; hash: string }>();
  for (const student of plan.students.filter((item) => !item.existing || item.existing.hasCredential === 0)) {
    const code = randomToken(24);
    activationByRow.set(student.sourceRow, { id: crypto.randomUUID(), code, hash: await sha256Hex(code) });
  }

  const statements: D1PreparedStatement[] = [db.prepare(`
    INSERT INTO importaciones_estudiantes (
      id, grupo_id, actor_usuario_id, archivo_nombre, archivo_sha256,
      asignatura_fuente, grupo_fuente, anio_fuente,
      filas_leidas, filas_validas, filas_rechazadas, estado, aplicada_en
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'aplicada', CURRENT_TIMESTAMP)
  `).bind(importId, plan.group.groupId, userId, payload.source.filename, payload.source.fileSha256,
    payload.source.subjectLabel, payload.source.groupSourceLabel, payload.source.academicYear,
    plan.students.length + payload.source.rejectedRows, plan.students.length, payload.source.rejectedRows)];

  for (const student of plan.students) {
    if (!student.existing) {
      statements.push(db.prepare(`
        INSERT INTO usuarios (nombre_usuario, nombre_mostrado, nombres, apellidos)
        VALUES (?1, ?2, ?3, ?4)
      `).bind(student.username, student.displayName, student.givenNames, student.surnames));
      statements.push(db.prepare(`
        INSERT INTO documentos_usuario (usuario_id, tipo, pais_emisor, valor_hmac, terminacion, es_principal, verificado_en)
        SELECT id, ?2, ?3, ?4, ?5, 1, CURRENT_TIMESTAMP FROM usuarios WHERE nombre_usuario = ?1 COLLATE NOCASE
      `).bind(student.username, student.documentType, student.countryCode, student.documentHmac, student.documentEnding));
    }
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO usuario_roles (usuario_id, rol_id)
      SELECT u.id, r.id FROM usuarios u JOIN roles r ON r.codigo = 'estudiante'
      WHERE u.nombre_usuario = ?1 COLLATE NOCASE
    `).bind(student.username));
    statements.push(db.prepare(`
      INSERT INTO inscripciones (usuario_id, grupo_id, estado, aprobado_en)
      SELECT id, ?2, 'activa', CURRENT_TIMESTAMP FROM usuarios WHERE nombre_usuario = ?1 COLLATE NOCASE
      ON CONFLICT(usuario_id, grupo_id) DO UPDATE SET estado = 'activa', aprobado_en = CURRENT_TIMESTAMP
    `).bind(student.username, plan.group.groupId));
    const activation = activationByRow.get(student.sourceRow);
    if (activation) {
      statements.push(db.prepare(`
        UPDATE activaciones_cuenta SET revocada_en = CURRENT_TIMESTAMP
        WHERE usuario_id = (SELECT id FROM usuarios WHERE nombre_usuario = ?1 COLLATE NOCASE)
          AND consumida_en IS NULL AND revocada_en IS NULL
      `).bind(student.username));
      statements.push(db.prepare(`
        INSERT INTO activaciones_cuenta (id, usuario_id, codigo_hash, expira_en)
        SELECT ?2, id, ?3, datetime('now', '+14 days') FROM usuarios WHERE nombre_usuario = ?1 COLLATE NOCASE
      `).bind(student.username, activation.id, activation.hash));
    }
  }

  const auditData = JSON.stringify({ groupId: plan.group.groupId, newAccounts: activationByRow.size, existingAccounts: plan.students.length - activationByRow.size, fileSha256: payload.source.fileSha256 });
  statements.push(db.prepare(`
    INSERT INTO eventos_auditoria (actor_usuario_id, accion, entidad_tipo, entidad_id, datos_json)
    VALUES (?1, 'importacion_estudiantes_aplicada', 'importacion_estudiantes', ?2, ?3)
  `).bind(userId, importId, auditData));
  await db.batch(statements);

  return {
    importId,
    ...publicPlan(payload.source, plan.group, plan.students),
    activationCredentials: plan.students.flatMap((student) => {
      const activation = activationByRow.get(student.sourceRow);
      return activation ? [{ sourceRow: student.sourceRow, displayName: student.displayName, username: student.username, activationCode: activation.code }] : [];
    }),
    activationCodesAreShownOnce: true,
  };
}

export type { ImportPayload };
