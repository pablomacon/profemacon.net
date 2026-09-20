import { listUserRoles } from "./auth";

type ActivityRow = {
  id: number;
  slug: string;
  title: string;
  description: string;
  unitCode: string;
  totalPoints: number;
  maxAttempts: number;
  approvalThreshold: number;
  achievementThreshold: number;
  reviewEnabled: number;
};

type AccessRow = {
  habilitationId: number;
  groupCode: string;
  groupName: string;
  availableFrom: string | null;
  availableUntil: string | null;
  timingStatus: "open" | "not_open" | "closed" | "disabled";
};

type QuestionRow = {
  number: number;
  type: "radio" | "checkbox" | "text" | "ordenar" | "relacionar";
  prompt: string;
  instructions: string;
  optionsJson: string;
  resourcesJson: string;
  placeholder: string | null;
  points: number;
};

type BestAttemptRow = {
  number: number;
  ordinal: number | null;
  score: number;
  total: number;
  percentage: number;
  submittedAt: string;
};

export class StudentActivityError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    public readonly code:
      | "STUDENT_ROLE_REQUIRED"
      | "NOT_ENROLLED"
      | "ACTIVITY_NOT_FOUND"
      | "GROUP_REQUIRED"
      | "ACTIVITY_DISABLED"
      | "ACTIVITY_NOT_OPEN"
      | "ACTIVITY_CLOSED"
      | "NO_ATTEMPTS_AVAILABLE"
      | "INVALID_SUBMISSION_ID"
      | "IDEMPOTENCY_CONFLICT"
      | "ACTIVITY_UNAVAILABLE"
      | "ATTEMPT_NOT_FOUND"
      | "ATTEMPT_NOT_EDITABLE"
      | "QUESTION_NOT_FOUND"
      | "INVALID_ANSWER",
    message: string,
    public readonly groups?: Array<{ code: string; name: string }>,
  ) {
    super(message);
  }
}

type AttemptRow = {
  id: number;
  habilitationId: number;
  state: "en_progreso" | "enviado" | "anulado";
  number: number;
  ordinal: number | null;
  submissionId: string;
  createdAt: string;
};

type ActivityQuestionRow = {
  id: number;
  number: number;
  type: "radio" | "checkbox" | "text" | "ordenar" | "relacionar";
  prompt: string;
};

function jsonArray(value: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function statusFor(access: AccessRow, used: number, maxAttempts: number): "available" | "not_open" | "closed" | "disabled" | "no_attempts" {
  if (access.timingStatus !== "open") return access.timingStatus;
  if (used >= maxAttempts) return "no_attempts";
  return "available";
}

async function findPublicActivity(db: D1Database, slug: string): Promise<ActivityRow> {
  const activity = await db.prepare(`
    SELECT
      a.id,
      a.slug,
      a.titulo AS title,
      a.descripcion AS description,
      a.unidad_codigo AS unitCode,
      a.puntaje_total AS totalPoints,
      a.maximo_intentos AS maxAttempts,
      a.umbral_aprobacion AS approvalThreshold,
      a.umbral_destacado AS achievementThreshold,
      a.mostrar_revision AS reviewEnabled
    FROM actividades a
    WHERE a.slug = ?1 COLLATE NOCASE
    LIMIT 1
  `).bind(slug).first<ActivityRow>();
  if (!activity) throw new StudentActivityError(404, "ACTIVITY_NOT_FOUND", "La actividad no fue encontrada.");
  return activity;
}

async function findEligibleAccesses(db: D1Database, activityId: number, userId: number): Promise<AccessRow[]> {
  const accesses = await db.prepare(`
    SELECT
      h.id AS habilitationId,
      g.codigo AS groupCode,
      g.nombre AS groupName,
      h.disponible_desde AS availableFrom,
      h.disponible_hasta AS availableUntil,
      CASE
        WHEN a.estado <> 'activa' OR h.habilitada <> 1 THEN 'disabled'
        WHEN h.disponible_desde IS NOT NULL AND datetime(h.disponible_desde) > datetime('now') THEN 'not_open'
        WHEN h.disponible_hasta IS NOT NULL AND datetime(h.disponible_hasta) < datetime('now') THEN 'closed'
        ELSE 'open'
      END AS timingStatus
    FROM habilitaciones_actividad h
    JOIN actividades a ON a.id = h.actividad_id
    JOIN grupos g ON g.id = h.grupo_id
    JOIN ediciones_anuales ea ON ea.id = g.edicion_anual_id AND ea.id = a.edicion_anual_id
    JOIN inscripciones i ON i.grupo_id = g.id
    WHERE h.actividad_id = ?1
      AND i.usuario_id = ?2
      AND i.estado = 'activa'
      AND g.estado = 'activo'
  `).bind(activityId, userId).all<AccessRow>();
  return accesses.results;
}

async function summarizeAttempts(db: D1Database, activityId: number, accessId: number, userId: number) {
  const usedRow = await db.prepare(`
    SELECT COUNT(*) AS used
    FROM intentos_actividad i
    WHERE i.actividad_id = ?1
      AND i.habilitacion_id = ?2
      AND i.usuario_id = ?3
      AND i.estado <> 'anulado'
  `).bind(activityId, accessId, userId).first<{ used: number }>();
  const best = await db.prepare(`
    SELECT
      i.numero_intento AS number,
      i.ordinal_efectivo AS ordinal,
      i.puntaje_obtenido AS score,
      i.puntaje_total AS total,
      i.porcentaje AS percentage,
      i.enviado_en AS submittedAt
    FROM intentos_actividad i
    WHERE i.actividad_id = ?1
      AND i.habilitacion_id = ?2
      AND i.usuario_id = ?3
      AND i.estado = 'enviado'
    ORDER BY i.porcentaje DESC, i.puntaje_obtenido DESC, i.enviado_en ASC
    LIMIT 1
  `).bind(activityId, accessId, userId).first<BestAttemptRow>();
  return { used: usedRow?.used ?? 0, best };
}

async function listPublicQuestions(db: D1Database, activityId: number) {
  const questions = await db.prepare(`
    SELECT
      p.numero AS number,
      p.tipo AS type,
      p.enunciado AS prompt,
      p.instrucciones AS instructions,
      p.opciones_json AS optionsJson,
      p.recursos_json AS resourcesJson,
      p.placeholder AS placeholder,
      p.puntaje AS points
    FROM preguntas_actividad p
    WHERE p.actividad_id = ?1
    ORDER BY p.numero
  `).bind(activityId).all<QuestionRow>();
  return questions.results.map((question) => ({
    number: question.number,
    type: question.type,
    prompt: question.prompt,
    instructions: question.instructions,
    options: jsonArray(question.optionsJson),
    resources: jsonArray(question.resourcesJson),
    placeholder: question.placeholder,
    points: question.points,
  }));
}

async function resolveStudentActivityAccess(db: D1Database, userId: number, slug: string, groupCode: string | null) {
  const roles = await listUserRoles(db, userId);
  if (!roles.includes("estudiante")) {
    throw new StudentActivityError(403, "STUDENT_ROLE_REQUIRED", "Se requiere el rol de estudiante.");
  }

  const activity = await findPublicActivity(db, slug);
  const accesses = await findEligibleAccesses(db, activity.id, userId);
  if (accesses.length === 0) {
    throw new StudentActivityError(403, "NOT_ENROLLED", "No tenés una inscripción activa para esta actividad.");
  }

  let access: AccessRow | undefined;
  if (groupCode) {
    access = accesses.find((candidate) => candidate.groupCode.toLocaleLowerCase("es-UY") === groupCode.toLocaleLowerCase("es-UY"));
    if (!access) throw new StudentActivityError(403, "NOT_ENROLLED", "No tenés acceso a esa actividad.");
  } else if (accesses.length === 1) {
    access = accesses[0];
  } else {
    throw new StudentActivityError(
      409,
      "GROUP_REQUIRED",
      "Elegí uno de tus grupos para consultar esta actividad.",
      accesses.map(({ groupCode: code, groupName: name }) => ({ code, name })),
    );
  }
  return { activity, access };
}

function validateSubmissionId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > 128) {
    throw new StudentActivityError(400, "INVALID_SUBMISSION_ID", "submissionId debe ser un texto no vacío de hasta 128 caracteres, sin espacios exteriores.");
  }
  return value;
}

function assertAttemptCanStart(access: AccessRow) {
  if (access.timingStatus === "disabled") throw new StudentActivityError(409, "ACTIVITY_DISABLED", "La actividad no está habilitada.");
  if (access.timingStatus === "not_open") throw new StudentActivityError(409, "ACTIVITY_NOT_OPEN", "La actividad todavía no está abierta.");
  if (access.timingStatus === "closed") throw new StudentActivityError(409, "ACTIVITY_CLOSED", "La actividad ya cerró.");
}

async function findAttemptBySubmissionId(db: D1Database, userId: number, activityId: number, submissionId: string) {
  return db.prepare(`
    SELECT
      i.id,
      i.habilitacion_id AS habilitationId,
      i.estado AS state,
      i.numero_intento AS number,
      i.ordinal_efectivo AS ordinal,
      i.submission_id AS submissionId,
      i.enviado_en AS createdAt
    FROM intentos_actividad i
    WHERE i.usuario_id = ?1 AND i.actividad_id = ?2 AND i.submission_id = ?3
    LIMIT 1
  `).bind(userId, activityId, submissionId).first<AttemptRow>();
}

function publicAttempt(attempt: AttemptRow, access: AccessRow) {
  return {
    attempt: {
      id: attempt.id,
      state: attempt.state,
      number: attempt.number,
      ordinal: attempt.ordinal,
      submissionId: attempt.submissionId,
      createdAt: attempt.createdAt,
    },
    access: {
      groupCode: access.groupCode,
      groupName: access.groupName,
      availableFrom: access.availableFrom,
      availableUntil: access.availableUntil,
    },
  };
}

export async function getStudentActivity(db: D1Database, userId: number, slug: string, groupCode: string | null) {
  const roles = await listUserRoles(db, userId);
  if (!roles.includes("estudiante")) {
    throw new StudentActivityError(403, "STUDENT_ROLE_REQUIRED", "Se requiere el rol de estudiante.");
  }

  const activity = await findPublicActivity(db, slug);
  const accesses = await findEligibleAccesses(db, activity.id, userId);
  if (accesses.length === 0) {
    throw new StudentActivityError(403, "NOT_ENROLLED", "No tenés una inscripción activa para esta actividad.");
  }

  let access: AccessRow | undefined;
  if (groupCode) {
    access = accesses.find((candidate) => candidate.groupCode.toLocaleLowerCase("es-UY") === groupCode.toLocaleLowerCase("es-UY"));
    if (!access) throw new StudentActivityError(403, "NOT_ENROLLED", "No tenés acceso a esa actividad.");
  } else if (accesses.length === 1) {
    access = accesses[0];
  } else {
    throw new StudentActivityError(
      409,
      "GROUP_REQUIRED",
      "Elegí uno de tus grupos para consultar esta actividad.",
      accesses.map(({ groupCode: code, groupName: name }) => ({ code, name })),
    );
  }

  const { used, best } = await summarizeAttempts(db, activity.id, access.habilitationId, userId);
  const status = statusFor(access, used, activity.maxAttempts);
  const questions = status === "available" ? await listPublicQuestions(db, activity.id) : [];

  return {
    activity: {
      slug: activity.slug,
      title: activity.title,
      description: activity.description,
      unitCode: activity.unitCode,
      totalPoints: activity.totalPoints,
      maxAttempts: activity.maxAttempts,
      approvalThreshold: activity.approvalThreshold,
      achievementThreshold: activity.achievementThreshold,
      reviewEnabled: activity.reviewEnabled === 1,
    },
    access: {
      status,
      groupCode: access.groupCode,
      groupName: access.groupName,
      availableFrom: access.availableFrom,
      availableUntil: access.availableUntil,
    },
    attempts: {
      used,
      remaining: Math.max(0, activity.maxAttempts - used),
      best: best ? {
        number: best.number,
        ordinal: best.ordinal,
        score: best.score,
        total: best.total,
        percentage: best.percentage,
        submittedAt: best.submittedAt,
      } : null,
    },
    questions,
  };
}

export async function createOrRecoverStudentActivityAttempt(
  db: D1Database,
  userId: number,
  slug: string,
  groupCode: string | null,
  submissionValue: unknown,
) {
  const submissionId = validateSubmissionId(submissionValue);
  const { activity, access } = await resolveStudentActivityAccess(db, userId, slug, groupCode);

  const existing = await findAttemptBySubmissionId(db, userId, activity.id, submissionId);
  if (existing) {
    if (existing.habilitationId !== access.habilitationId) {
      throw new StudentActivityError(409, "IDEMPOTENCY_CONFLICT", "submissionId ya pertenece a otro grupo de esta actividad.");
    }
    return publicAttempt(existing, access);
  }

  assertAttemptCanStart(access);

  try {
    await db.prepare(`
      INSERT INTO intentos_actividad (
        actividad_id, habilitacion_id, usuario_id, numero_intento, ordinal_efectivo,
        estado, puntaje_obtenido, puntaje_total, porcentaje, juicio, devolucion, submission_id
      )
      SELECT
        a.id,
        ?2,
        ?3,
        1 + COALESCE((
          SELECT MAX(i.numero_intento)
          FROM intentos_actividad i
          WHERE i.actividad_id = a.id AND i.habilitacion_id = ?2 AND i.usuario_id = ?3
        ), 0),
        1 + (
          SELECT COUNT(*)
          FROM intentos_actividad i
          WHERE i.actividad_id = a.id AND i.habilitacion_id = ?2 AND i.usuario_id = ?3 AND i.estado <> 'anulado'
        ),
        'en_progreso', 0, a.puntaje_total, 0, 'inicial', '', ?4
      FROM actividades a
      WHERE a.id = ?1
    `).bind(activity.id, access.habilitationId, userId, submissionId).run();
  } catch (error) {
    const afterConflict = await findAttemptBySubmissionId(db, userId, activity.id, submissionId);
    if (afterConflict) {
      if (afterConflict.habilitationId !== access.habilitationId) {
        throw new StudentActivityError(409, "IDEMPOTENCY_CONFLICT", "submissionId ya pertenece a otro grupo de esta actividad.");
      }
      return publicAttempt(afterConflict, access);
    }
    const message = error instanceof Error ? error.message : "";
    if (message.includes("máximo de intentos")) {
      throw new StudentActivityError(409, "NO_ATTEMPTS_AVAILABLE", "No quedan intentos disponibles.");
    }
    if (message.includes("actividad no está disponible")) {
      throw new StudentActivityError(409, "ACTIVITY_UNAVAILABLE", "La actividad ya no está disponible.");
    }
    throw error;
  }

  const created = await findAttemptBySubmissionId(db, userId, activity.id, submissionId);
  if (!created || created.habilitationId !== access.habilitationId) {
    throw new StudentActivityError(409, "IDEMPOTENCY_CONFLICT", "No fue posible recuperar el intento creado.");
  }
  return publicAttempt(created, access);
}

function validateAttemptId(value: unknown): number {
  const attemptId = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(attemptId) || attemptId <= 0) {
    throw new StudentActivityError(404, "ATTEMPT_NOT_FOUND", "El intento no fue encontrado.");
  }
  return attemptId;
}

function validateQuestionNumber(value: unknown): number {
  const questionNumber = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(questionNumber) || questionNumber <= 0) {
    throw new StudentActivityError(404, "QUESTION_NOT_FOUND", "La pregunta no fue encontrada.");
  }
  return questionNumber;
}

function answerJson(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error();
    return serialized;
  } catch {
    throw new StudentActivityError(400, "INVALID_ANSWER", "La respuesta debe ser un valor JSON válido.");
  }
}

export async function saveStudentActivityAnswer(
  db: D1Database,
  userId: number,
  slug: string,
  groupCode: string | null,
  attemptValue: unknown,
  questionValue: unknown,
  answer: unknown,
) {
  const attemptId = validateAttemptId(attemptValue);
  const questionNumber = validateQuestionNumber(questionValue);
  const serializedAnswer = answerJson(answer);
  const { activity, access } = await resolveStudentActivityAccess(db, userId, slug, groupCode);
  const attempt = await db.prepare(`
    SELECT i.id, i.estado AS state
    FROM intentos_actividad i
    WHERE i.id = ?1
      AND i.usuario_id = ?2
      AND i.actividad_id = ?3
      AND i.habilitacion_id = ?4
    LIMIT 1
  `).bind(attemptId, userId, activity.id, access.habilitationId).first<{ id: number; state: AttemptRow["state"] }>();
  if (!attempt) throw new StudentActivityError(404, "ATTEMPT_NOT_FOUND", "El intento no fue encontrado.");
  if (attempt.state !== "en_progreso") {
    throw new StudentActivityError(409, "ATTEMPT_NOT_EDITABLE", "El intento ya no admite cambios.");
  }

  const question = await db.prepare(`
    SELECT
      p.pregunta_origen_id AS id,
      p.numero_pregunta AS number,
      p.tipo_pregunta AS type,
      p.enunciado_snapshot AS prompt
    FROM preguntas_intento_actividad p
    WHERE p.intento_id = ?1 AND p.numero_pregunta = ?2
    LIMIT 1
  `).bind(attempt.id, questionNumber).first<ActivityQuestionRow>();
  if (!question) throw new StudentActivityError(404, "QUESTION_NOT_FOUND", "La pregunta no pertenece al snapshot de este intento.");

  try {
    await db.prepare(`
      INSERT INTO respuestas_intento_actividad (
        intento_id, pregunta_id, numero_pregunta, tipo_pregunta, enunciado_snapshot,
        respuesta_dada_json, respuesta_normalizada_json, correcta, puntaje_obtenido
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, 0, 0)
      ON CONFLICT(intento_id, pregunta_id) DO UPDATE SET
        numero_pregunta = excluded.numero_pregunta,
        tipo_pregunta = excluded.tipo_pregunta,
        enunciado_snapshot = excluded.enunciado_snapshot,
        respuesta_dada_json = excluded.respuesta_dada_json,
        respuesta_normalizada_json = excluded.respuesta_normalizada_json,
        correcta = 0,
        puntaje_obtenido = 0
    `).bind(attempt.id, question.id, question.number, question.type, question.prompt, serializedAnswer).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("intento cerrado")) {
      throw new StudentActivityError(409, "ATTEMPT_NOT_EDITABLE", "El intento ya no admite cambios.");
    }
    throw error;
  }

  return {
    attempt: { id: attempt.id, state: attempt.state },
    question: { number: question.number, type: question.type },
    saved: true,
  };
}
