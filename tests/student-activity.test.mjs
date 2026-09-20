import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import test from "node:test";
import { sha256Hex } from "../worker/auth-crypto.ts";

function findSqliteFile(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const candidate = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findSqliteFile(candidate);
      if (nested) return nested;
    } else if (entry.name.endsWith(".sqlite")) {
      return candidate;
    }
  }
  return null;
}

async function createSession(database, userId) {
  const token = `session-${userId}-${"x".repeat(40)}`;
  database.prepare(`
    INSERT INTO sesiones_usuario (id, usuario_id, token_hash, expira_en, ultimo_uso_en)
    VALUES (?1, ?2, ?3, datetime('now', '+1 day'), CURRENT_TIMESTAMP)
  `).run(`session-${userId}`, userId, await sha256Hex(token));
  return token;
}

async function waitForWorker(baseUrl, workerOutput, hasExited) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/me/activities/actividad-publica`);
      if (response.status > 0) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (hasExited()) throw new Error(`Wrangler no inició el Worker local: ${workerOutput().slice(-2000)}`);
  throw lastError ?? new Error("Wrangler no inició el Worker local");
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const { port } = address;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function insertAttempt(database, activityId, habilitationId, userId, number, ordinal, submission, total = 1) {
  database.prepare(`
    INSERT INTO intentos_actividad
      (actividad_id, habilitacion_id, usuario_id, numero_intento, ordinal_efectivo, estado,
       puntaje_obtenido, puntaje_total, porcentaje, juicio, devolucion, submission_id)
    VALUES (?1, ?2, ?3, ?4, ?5, 'en_progreso', 0, ?6, 0, 'inicial', '', ?7)
  `).run(activityId, habilitationId, userId, number, ordinal, total, submission);
  return database.prepare("SELECT id FROM intentos_actividad WHERE submission_id = ?1").get(submission).id;
}

function sendAttempt(database, attemptId, responses, score, percentage, sentAt) {
  for (const response of responses) {
    database.prepare(`
      INSERT INTO respuestas_intento_actividad
        (intento_id, pregunta_id, numero_pregunta, tipo_pregunta, enunciado_snapshot,
         respuesta_dada_json, respuesta_normalizada_json, correcta, puntaje_obtenido)
      VALUES (?1, ?2, ?3, 'radio', 'Pregunta de prueba', 'null', 'null', ?4, ?5)
    `).run(attemptId, response.questionId, response.number, response.correct ? 1 : 0, response.points);
  }
  database.prepare(`
    UPDATE intentos_actividad
    SET puntaje_obtenido = ?1, porcentaje = ?2, enviado_en = ?3, estado = 'enviado'
    WHERE id = ?4
  `).run(score, percentage, sentAt, attemptId);
}

test("GET /api/me/activities/:slug aplica el contrato público con D1 local", async (t) => {
  const projectRoot = process.cwd();
  const persistenceRoot = mkdtempSync(join(tmpdir(), "profemacon-student-activity-"));
  let database;
  let localWorker;
  let workerOutput = "";
  let workerExited = false;
  t.after(async () => {
    if (localWorker && !localWorker.killed) {
      const exited = once(localWorker, "exit");
      localWorker.kill();
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    }
    database?.close();
    rmSync(persistenceRoot, { recursive: true, force: true });
  });

  execFileSync(process.execPath, [
    join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js"),
    "d1", "migrations", "apply", "profemacon-beta-local", "--local", "--persist-to", persistenceRoot,
  ], { cwd: projectRoot, stdio: "ignore" });
  const databasePath = findSqliteFile(persistenceRoot);
  assert.ok(databasePath, "La prueba necesita una base D1 local");
  database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    INSERT INTO roles (id, codigo, nombre) VALUES
      (1, 'estudiante', 'Estudiante'), (2, 'docente', 'Docente');
    INSERT INTO usuarios (id, nombre_usuario, nombre_mostrado) VALUES
      (1, 'estudiante-prueba', 'Estudiante de prueba'),
      (2, 'docente-prueba', 'Docente de prueba'),
      (3, 'estudiante-sin-grupo', 'Estudiante sin grupo'),
      (4, 'otro-estudiante', 'Otro estudiante');
    INSERT INTO usuario_roles (usuario_id, rol_id) VALUES (1, 1), (2, 2), (3, 1), (4, 1);
    INSERT INTO asignaturas (id, codigo, nombre) VALUES (1, 'programacion-prueba', 'Programación de prueba');
    INSERT INTO ediciones_anuales (id, asignatura_id, anio, nombre, estado)
      VALUES (1, 1, 2026, 'Edición de prueba', 'activa');
    INSERT INTO grupos (id, edicion_anual_id, codigo, nombre) VALUES
      (1, 1, 'grupo-a', 'Grupo A'), (2, 1, 'grupo-b', 'Grupo B'), (3, 1, 'grupo-ajeno', 'Grupo ajeno');
    INSERT INTO inscripciones (usuario_id, grupo_id, estado) VALUES
      (1, 1, 'activa'), (1, 2, 'activa'), (2, 1, 'activa'), (4, 1, 'activa');
    INSERT INTO actividades
      (id, slug, edicion_anual_id, unidad_codigo, tema, orden, titulo, descripcion, estado, puntaje_total, maximo_intentos)
    VALUES
      (1, 'actividad-publica', 1, 'unidad-1', 'tema', 1, 'Actividad pública', 'Descripción pública', 'activa', 2, 3),
      (2, 'actividad-deshabilitada', 1, 'unidad-1', 'tema', 2, 'Deshabilitada', '', 'activa', 1, 1),
      (3, 'actividad-futura', 1, 'unidad-1', 'tema', 3, 'Futura', '', 'activa', 1, 1),
      (4, 'actividad-cerrada', 1, 'unidad-1', 'tema', 4, 'Cerrada', '', 'activa', 1, 1),
      (5, 'actividad-borrador', 1, 'unidad-1', 'tema', 5, 'Borrador', '', 'borrador', 1, 1),
      (6, 'actividad-agotada', 1, 'unidad-1', 'tema', 6, 'Agotada', '', 'activa', 1, 1),
      (7, 'actividad-anulada', 1, 'unidad-1', 'tema', 7, 'Anulada', '', 'activa', 1, 1),
      (8, 'actividad-en-progreso', 1, 'unidad-1', 'tema', 8, 'En progreso', '', 'activa', 1, 3),
      (9, 'actividad-mejor-intento', 1, 'unidad-1', 'tema', 9, 'Mejor intento', '', 'activa', 200, 3),
      (10, 'actividad-deshabilitada-futura', 1, 'unidad-1', 'tema', 10, 'Deshabilitada futura', '', 'activa', 1, 1),
      (11, 'actividad-deshabilitada-agotada', 1, 'unidad-1', 'tema', 11, 'Deshabilitada agotada', '', 'activa', 1, 1),
      (12, 'actividad-futura-agotada', 1, 'unidad-1', 'tema', 12, 'Futura agotada', '', 'activa', 1, 1),
      (13, 'actividad-apertura-exacta', 1, 'unidad-1', 'tema', 13, 'Apertura exacta', '', 'activa', 1, 1),
      (14, 'actividad-cierre-exacto', 1, 'unidad-1', 'tema', 14, 'Cierre exacto', '', 'activa', 1, 1),
      (15, 'actividad-aislada', 1, 'unidad-1', 'tema', 15, 'Actividad aislada', '', 'activa', 1, 1),
      (16, 'actividad-reintento-cierre', 1, 'unidad-1', 'tema', 16, 'Reintento tras cierre', '', 'activa', 1, 2),
      (17, 'actividad-reintento-deshabilitada', 1, 'unidad-1', 'tema', 17, 'Reintento tras deshabilitar', '', 'activa', 1, 2),
      (18, 'actividad-respuestas', 1, 'unidad-1', 'tema', 18, 'Actividad de respuestas', '', 'activa', 2, 1),
      (19, 'actividad-submit', 1, 'unidad-1', 'tema', 19, 'Actividad de entrega', '', 'activa', 3, 2),
      (20, 'actividad-revision-deshabilitada', 1, 'unidad-1', 'tema', 20, 'Revisión deshabilitada', '', 'activa', 1, 1);
    INSERT INTO habilitaciones_actividad
      (id, actividad_id, grupo_id, habilitada, disponible_desde, disponible_hasta)
    VALUES
      (1, 1, 1, 1, NULL, NULL), (2, 1, 2, 1, NULL, NULL), (3, 1, 3, 1, NULL, NULL),
      (4, 2, 1, 0, NULL, NULL), (5, 3, 1, 1, '2099-01-01T00:00:00Z', NULL),
      (6, 4, 1, 1, NULL, '2020-01-01T00:00:00Z'), (7, 5, 1, 1, NULL, NULL),
      (8, 6, 1, 1, NULL, NULL), (9, 7, 1, 1, NULL, NULL),
      (10, 8, 1, 1, NULL, NULL), (11, 9, 1, 1, NULL, NULL),
      (12, 10, 1, 0, '2099-01-01T00:00:00Z', NULL), (13, 11, 1, 1, NULL, NULL),
      (14, 12, 1, 1, NULL, NULL), (15, 13, 1, 1, datetime('now'), NULL),
      (16, 14, 1, 1, NULL, datetime('now')), (17, 15, 1, 1, NULL, NULL),
      (18, 16, 1, 1, NULL, NULL), (19, 17, 1, 1, NULL, NULL), (20, 18, 1, 1, NULL, NULL),
      (21, 19, 1, 1, NULL, NULL), (22, 20, 1, 1, NULL, NULL);
    INSERT INTO preguntas_actividad
      (id, actividad_id, numero, tipo, enunciado, instrucciones, opciones_json, recursos_json, placeholder, puntaje, clave_correccion_json, retroalimentacion_correcta, retroalimentacion_incorrecta)
    VALUES
      (1, 1, 1, 'radio', 'Pregunta pública', 'Elegí una opción', '["a","b"]', '["recurso-publico"]', 'No corresponde', 1, '["b"]', 'Privado correcto', 'Privado incorrecto'),
      (2, 6, 1, 'radio', 'Pregunta de agotada', '', '[]', '[]', NULL, 1, '["x"]', '', ''),
      (3, 7, 1, 'radio', 'Pregunta anulada', '', '[]', '[]', NULL, 1, '["x"]', '', ''),
      (4, 9, 1, 'radio', 'Pregunta de 149 puntos', '', '[]', '[]', NULL, 149, '["x"]', '', ''),
      (5, 9, 2, 'radio', 'Pregunta de 1 punto', '', '[]', '[]', NULL, 1, '["x"]', '', ''),
      (6, 9, 3, 'radio', 'Pregunta de 50 puntos', '', '[]', '[]', NULL, 50, '["x"]', '', ''),
      (7, 11, 1, 'radio', 'Pregunta deshabilitada agotada', '', '[]', '[]', NULL, 1, '["x"]', '', ''),
      (8, 12, 1, 'radio', 'Pregunta futura agotada', '', '[]', '[]', NULL, 1, '["x"]', '', ''),
      (9, 18, 1, 'radio', 'Primera respuesta', '', '[]', '[]', NULL, 1, '["x"]', '', ''),
      (10, 18, 2, 'text', 'Segunda respuesta', '', '[]', '[]', NULL, 1, '["x"]', '', ''),
      (11, 19, 1, 'radio', 'Radio de entrega', '', '[]', '[]', NULL, 1, '{"modo":"opcion","correctas":["b"]}', 'Feedback privado correcto', 'Feedback privado incorrecto'),
      (12, 19, 2, 'text', 'Texto de entrega', '', '[]', '[]', NULL, 1, '{"modo":"texto-exacto","aceptadas":["valor"]}', 'Feedback privado correcto', 'Feedback privado incorrecto'),
      (13, 19, 3, 'checkbox', 'Checkbox de entrega', '', '[]', '[]', NULL, 1, '{"modo":"seleccion-exacta","correctas":["a","c"]}', 'Feedback privado correcto', 'Feedback privado incorrecto');
  `);
  database.exec("UPDATE actividades SET mostrar_revision = 0 WHERE id = 20");
  const sentAttemptId = insertAttempt(database, 6, 8, 1, 1, 1, "agotada-uno");
  database.exec(`
    INSERT INTO respuestas_intento_actividad
      (intento_id, pregunta_id, numero_pregunta, tipo_pregunta, enunciado_snapshot,
       respuesta_dada_json, respuesta_normalizada_json, correcta, puntaje_obtenido)
    VALUES (${sentAttemptId}, 2, 1, 'radio', 'Pregunta de agotada', '"x"', '"x"', 1, 1);
    UPDATE intentos_actividad SET puntaje_obtenido = 1, porcentaje = 100, estado = 'enviado' WHERE id = ${sentAttemptId};
  `);
  const annulledAttemptId = insertAttempt(database, 7, 9, 1, 1, 1, "anulada-uno");
  database.exec(`UPDATE intentos_actividad SET estado = 'anulado' WHERE id = ${annulledAttemptId}`);
  const inProgressAttemptId = insertAttempt(database, 8, 10, 1, 1, 1, "progreso-uno");
  const cancelledAfterProgressId = insertAttempt(database, 8, 10, 1, 2, 2, "progreso-anulado");
  database.exec(`UPDATE intentos_actividad SET estado = 'anulado' WHERE id = ${cancelledAfterProgressId}`);

  const bestByPercentageId = insertAttempt(database, 9, 11, 1, 1, 1, "mejor-porcentaje", 200);
  sendAttempt(database, bestByPercentageId, [
    { questionId: 4, number: 1, correct: true, points: 149 },
    { questionId: 5, number: 2, correct: false, points: 0 },
    { questionId: 6, number: 3, correct: false, points: 0 },
  ], 149, 75, "2026-01-03T00:00:00Z");
  const bestByScoreLaterId = insertAttempt(database, 9, 11, 1, 2, 2, "mejor-puntaje-tarde", 200);
  sendAttempt(database, bestByScoreLaterId, [
    { questionId: 4, number: 1, correct: true, points: 149 },
    { questionId: 5, number: 2, correct: true, points: 1 },
    { questionId: 6, number: 3, correct: false, points: 0 },
  ], 150, 75, "2026-01-02T00:00:00Z");
  const bestByDateEarlierId = insertAttempt(database, 9, 11, 1, 3, 3, "mejor-fecha-temprano", 200);
  sendAttempt(database, bestByDateEarlierId, [
    { questionId: 4, number: 1, correct: true, points: 149 },
    { questionId: 5, number: 2, correct: true, points: 1 },
    { questionId: 6, number: 3, correct: false, points: 0 },
  ], 150, 75, "2026-01-01T00:00:00Z");

  const disabledExhaustedId = insertAttempt(database, 11, 13, 1, 1, 1, "deshabilitada-agotada");
  sendAttempt(database, disabledExhaustedId, [{ questionId: 7, number: 1, correct: true, points: 1 }], 1, 100, "2026-01-01T00:00:00Z");
  const futureExhaustedId = insertAttempt(database, 12, 14, 1, 1, 1, "futura-agotada");
  sendAttempt(database, futureExhaustedId, [{ questionId: 8, number: 1, correct: true, points: 1 }], 1, 100, "2026-01-01T00:00:00Z");
  database.exec(`
    UPDATE habilitaciones_actividad SET habilitada = 0 WHERE id = 13;
    UPDATE habilitaciones_actividad SET disponible_desde = '2099-01-01T00:00:00Z' WHERE id = 14;
  `);

  insertAttempt(database, 1, 1, 4, 1, 1, "otro-usuario-misma-actividad", 2);
  insertAttempt(database, 1, 2, 1, 1, 1, "otro-grupo-misma-actividad", 2);
  insertAttempt(database, 15, 17, 1, 1, 1, "otra-actividad-mismo-usuario");

  const studentToken = await createSession(database, 1);
  const teacherToken = await createSession(database, 2);
  const noGroupToken = await createSession(database, 3);
  const otherStudentToken = await createSession(database, 4);
  database.close();
  database = undefined;
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const workerConfig = join(persistenceRoot, "wrangler.student-activity.json");
  writeFileSync(workerConfig, JSON.stringify({
    name: "profemacon-student-activity-test",
    compatibility_date: "2026-07-20",
    main: join(projectRoot, "worker", "index.ts"),
    d1_databases: [{
      binding: "DB",
      database_name: "profemacon-beta-local",
      database_id: "00000000-0000-0000-0000-000000000000",
    }],
  }));
  localWorker = spawn(process.execPath, [
    join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js"),
    "dev", "--config", workerConfig, "--local", "--port", String(port), "--persist-to", persistenceRoot,
  ], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, XDG_CONFIG_HOME: persistenceRoot },
  });
  localWorker.stdout.on("data", (chunk) => { workerOutput += String(chunk); });
  localWorker.stderr.on("data", (chunk) => { workerOutput += String(chunk); });
  localWorker.on("exit", () => { workerExited = true; });
  await waitForWorker(baseUrl, () => workerOutput, () => workerExited);
  const get = async (path, token = studentToken) => {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { Cookie: `pm_session=${token}` },
    });
    return { response, body: await response.json() };
  };
  const postAttempt = async (slug, body, token = studentToken) => {
    const response = await fetch(`${baseUrl}/api/me/activities/${slug}/attempts`, {
      method: "POST",
      headers: {
        Cookie: `pm_session=${token}`,
        Origin: baseUrl,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { response, body: await response.json() };
  };
  const putAnswer = async (slug, attemptId, questionNumber, body, token = studentToken) => {
    const response = await fetch(`${baseUrl}/api/me/activities/${slug}/attempts/${attemptId}/responses/${questionNumber}`, {
      method: "PUT",
      headers: {
        Cookie: `pm_session=${token}`,
        Origin: baseUrl,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { response, body: await response.json() };
  };
  const submit = async (slug, attemptId, groupCode = null, token = studentToken) => {
    const suffix = groupCode ? `?groupCode=${encodeURIComponent(groupCode)}` : "";
    const response = await fetch(`${baseUrl}/api/me/activities/${slug}/attempts/${attemptId}/submit${suffix}`, {
      method: "POST",
      headers: { Cookie: `pm_session=${token}`, Origin: baseUrl },
    });
    return { response, body: await response.json() };
  };
  const review = async (slug, groupCode = null, token = studentToken) => {
    const suffix = groupCode ? `?groupCode=${encodeURIComponent(groupCode)}` : "";
    const response = await fetch(`${baseUrl}/api/me/activities/${slug}/review${suffix}`, {
      headers: { Cookie: `pm_session=${token}` },
    });
    return { response, body: await response.json() };
  };

  const anonymous = await fetch(`${baseUrl}/api/me/activities/actividad-publica`);
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers.get("Cache-Control"), "no-store");
  assert.equal((await anonymous.json()).code, "SESSION_REQUIRED");

  const anonymousReview = await fetch(`${baseUrl}/api/me/activities/actividad-submit/review`);
  assert.equal(anonymousReview.status, 401);
  assert.equal(anonymousReview.headers.get("Cache-Control"), "no-store");
  assert.equal((await anonymousReview.json()).code, "SESSION_REQUIRED");

  const teacher = await get("/api/me/activities/actividad-publica?groupCode=grupo-a", teacherToken);
  assert.equal(teacher.response.status, 403);
  assert.equal(teacher.response.headers.get("Cache-Control"), "no-store");
  assert.equal(teacher.body.code, "STUDENT_ROLE_REQUIRED");
  const teacherReview = await review("actividad-submit", null, teacherToken);
  assert.equal(teacherReview.response.status, 403);
  assert.equal(teacherReview.body.code, "STUDENT_ROLE_REQUIRED");

  const noEnrollment = await get("/api/me/activities/actividad-publica?groupCode=grupo-a", noGroupToken);
  assert.equal(noEnrollment.response.status, 403);
  assert.equal(noEnrollment.body.code, "NOT_ENROLLED");
  const noEnrollmentReview = await review("actividad-submit", null, noGroupToken);
  assert.equal(noEnrollmentReview.response.status, 403);
  assert.equal(noEnrollmentReview.body.code, "NOT_ENROLLED");

  const missing = await get("/api/me/activities/no-existe?groupCode=grupo-a");
  assert.equal(missing.response.status, 404);
  assert.equal(missing.response.headers.get("Cache-Control"), "no-store");
  assert.equal(missing.body.code, "ACTIVITY_NOT_FOUND");
  const missingReview = await review("no-existe");
  assert.equal(missingReview.response.status, 404);
  assert.equal(missingReview.body.code, "ACTIVITY_NOT_FOUND");

  const selector = await get("/api/me/activities/actividad-publica");
  assert.equal(selector.response.status, 409);
  assert.equal(selector.response.headers.get("Cache-Control"), "no-store");
  assert.equal(selector.body.code, "GROUP_REQUIRED");
  assert.deepEqual(selector.body.groups, [{ code: "grupo-a", name: "Grupo A" }, { code: "grupo-b", name: "Grupo B" }]);

  const foreignGroup = await get("/api/me/activities/actividad-publica?groupCode=grupo-ajeno");
  assert.equal(foreignGroup.response.status, 403);
  assert.equal(foreignGroup.body.code, "NOT_ENROLLED");
  const foreignGroupReview = await review("actividad-submit", "grupo-ajeno");
  assert.equal(foreignGroupReview.response.status, 403);
  assert.equal(foreignGroupReview.body.code, "NOT_ENROLLED");

  const disabledReview = await review("actividad-revision-deshabilitada");
  assert.equal(disabledReview.response.status, 403);
  assert.equal(disabledReview.body.code, "REVIEW_DISABLED");
  const prematureReview = await review("actividad-submit");
  assert.equal(prematureReview.response.status, 403);
  assert.equal(prematureReview.body.code, "REVIEW_NOT_AVAILABLE");
  const inProgressReview = await review("actividad-en-progreso");
  assert.equal(inProgressReview.response.status, 403);
  assert.equal(inProgressReview.body.code, "REVIEW_NOT_AVAILABLE");
  const annulledReview = await review("actividad-anulada");
  assert.equal(annulledReview.response.status, 403);
  assert.equal(annulledReview.body.code, "REVIEW_NOT_AVAILABLE");

  const available = await get("/api/me/activities/actividad-publica?groupCode=GRUPO-A");
  assert.equal(available.response.status, 200);
  assert.equal(available.response.headers.get("Cache-Control"), "no-store");
  assert.equal(available.body.access.status, "available");
  assert.equal(available.body.access.groupCode, "grupo-a");
  assert.equal(available.body.attempts.used, 0);
  assert.equal(available.body.attempts.remaining, 3);
  assert.equal(available.body.attempts.best, null);
  assert.deepEqual(available.body.questions, [{ number: 1, type: "radio", prompt: "Pregunta pública", instructions: "Elegí una opción", options: ["a", "b"], resources: ["recurso-publico"], placeholder: "No corresponde", points: 1 }]);
  const serialized = JSON.stringify(available.body);
  for (const forbidden of ["clave_correccion_json", "retroalimentacion_correcta", "retroalimentacion_incorrecta", "respuesta_normalizada_json", "respuesta_dada_json", "correcta", "devolucion", "explicacion_revision_final", "correctAnswer"]) {
    assert.equal(serialized.includes(forbidden), false, `La respuesta no debe incluir ${forbidden}`);
  }

  for (const [slug, expected] of [
    ["actividad-deshabilitada", "disabled"],
    ["actividad-futura", "not_open"],
    ["actividad-cerrada", "closed"],
    ["actividad-borrador", "disabled"],
    ["actividad-deshabilitada-futura", "disabled"],
    ["actividad-deshabilitada-agotada", "disabled"],
    ["actividad-futura-agotada", "not_open"],
    ["actividad-cierre-exacto", "closed"],
  ]) {
    const result = await get(`/api/me/activities/${slug}`);
    assert.equal(result.response.status, 200);
    assert.equal(result.response.headers.get("Cache-Control"), "no-store");
    assert.equal(result.body.access.status, expected);
    assert.deepEqual(result.body.questions, []);
  }

  const openingBoundary = await get("/api/me/activities/actividad-apertura-exacta");
  assert.equal(openingBoundary.response.status, 200);
  assert.equal(openingBoundary.body.access.status, "available");

  const exhausted = await get("/api/me/activities/actividad-agotada");
  assert.equal(exhausted.response.status, 200);
  assert.equal(exhausted.body.access.status, "no_attempts");
  assert.equal(exhausted.body.attempts.used, 1);
  assert.equal(exhausted.body.attempts.remaining, 0);
  assert.deepEqual(exhausted.body.attempts.best, { number: 1, ordinal: 1, score: 1, total: 1, percentage: 100, submittedAt: exhausted.body.attempts.best.submittedAt });
  assert.equal(typeof exhausted.body.attempts.best.submittedAt, "string");

  const annulled = await get("/api/me/activities/actividad-anulada");
  assert.equal(annulled.response.status, 200);
  assert.equal(annulled.body.access.status, "available");
  assert.equal(annulled.body.attempts.used, 0);
  assert.equal(annulled.body.attempts.remaining, 1);
  assert.equal(annulled.body.attempts.best, null);

  const inProgress = await get("/api/me/activities/actividad-en-progreso");
  assert.equal(inProgress.response.status, 200);
  assert.equal(inProgress.body.access.status, "available");
  assert.equal(inProgress.body.attempts.used, 1, "en_progreso reserva un cupo");
  assert.equal(inProgress.body.attempts.remaining, 2);
  assert.equal(inProgress.body.attempts.best, null, "sólo enviado puede ser el mejor intento");

  const bestAttempt = await get("/api/me/activities/actividad-mejor-intento");
  assert.equal(bestAttempt.response.status, 200);
  assert.equal(bestAttempt.body.access.status, "no_attempts");
  assert.equal(bestAttempt.body.attempts.used, 3);
  assert.deepEqual(bestAttempt.body.attempts.best, {
    number: 3,
    ordinal: 3,
    score: 150,
    total: 200,
    percentage: 75,
    submittedAt: "2026-01-01T00:00:00Z",
  }, "ORDER BY porcentaje DESC, puntaje DESC, enviado_en ASC");

  const isolated = await get("/api/me/activities/actividad-publica?groupCode=grupo-a");
  assert.equal(isolated.response.status, 200);
  assert.equal(isolated.body.access.status, "available");
  assert.equal(isolated.body.attempts.used, 0, "no cuenta otro usuario, grupo ni actividad");
  assert.equal(isolated.body.attempts.remaining, 3);
  assert.equal(isolated.body.attempts.best, null);

  const anonymousAttempt = await fetch(`${baseUrl}/api/me/activities/actividad-publica/attempts`, {
    method: "POST",
    headers: { Origin: baseUrl, "Content-Type": "application/json" },
    body: JSON.stringify({ groupCode: "grupo-a", submissionId: "sin-sesion" }),
  });
  assert.equal(anonymousAttempt.status, 401);
  assert.equal((await anonymousAttempt.json()).code, "SESSION_REQUIRED");

  const teacherAttempt = await postAttempt("actividad-publica", { groupCode: "grupo-a", submissionId: "rol-docente" }, teacherToken);
  assert.equal(teacherAttempt.response.status, 403);
  assert.equal(teacherAttempt.body.code, "STUDENT_ROLE_REQUIRED");
  const noEnrollmentAttempt = await postAttempt("actividad-publica", { groupCode: "grupo-a", submissionId: "sin-matricula" }, noGroupToken);
  assert.equal(noEnrollmentAttempt.response.status, 403);
  assert.equal(noEnrollmentAttempt.body.code, "NOT_ENROLLED");
  const missingAttempt = await postAttempt("no-existe", { groupCode: "grupo-a", submissionId: "no-existe" });
  assert.equal(missingAttempt.response.status, 404);
  assert.equal(missingAttempt.body.code, "ACTIVITY_NOT_FOUND");

  for (const [slug, code] of [["actividad-deshabilitada", "ACTIVITY_DISABLED"], ["actividad-futura", "ACTIVITY_NOT_OPEN"], ["actividad-cerrada", "ACTIVITY_CLOSED"]]) {
    const unavailable = await postAttempt(slug, { submissionId: `inicio-${slug}` });
    assert.equal(unavailable.response.status, 409);
    assert.equal(unavailable.body.code, code);
  }

  for (const submissionId of ["", " con-espacios ", "x".repeat(129)]) {
    const invalid = await postAttempt("actividad-publica", { groupCode: "grupo-a", submissionId });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.body.code, "INVALID_SUBMISSION_ID");
  }

  const firstAttempt = await postAttempt("actividad-publica", { groupCode: "grupo-a", submissionId: "inicio-uno" });
  assert.equal(firstAttempt.response.status, 201);
  assert.deepEqual(firstAttempt.body.attempt, {
    id: firstAttempt.body.attempt.id,
    state: "en_progreso",
    number: 1,
    ordinal: 1,
    submissionId: "inicio-uno",
    createdAt: firstAttempt.body.attempt.createdAt,
  });
  assert.equal(typeof firstAttempt.body.attempt.createdAt, "string");
  assert.equal(firstAttempt.body.access.groupCode, "grupo-a");
  assert.equal(JSON.stringify(firstAttempt.body).includes("clave_correccion_json"), false);
  assert.equal(JSON.stringify(firstAttempt.body).includes("clave_correccion_snapshot_json"), false);
  assert.equal(JSON.stringify(firstAttempt.body).includes("correctAnswer"), false);
  const savedFirst = await putAnswer("actividad-publica", firstAttempt.body.attempt.id, 1, { groupCode: "grupo-a", answer: "primera versión" });
  assert.equal(savedFirst.response.status, 200);
  assert.deepEqual(savedFirst.body, { attempt: { id: firstAttempt.body.attempt.id, state: "en_progreso" }, question: { number: 1, type: "radio" }, saved: true });
  assert.equal(JSON.stringify(savedFirst.body).includes("clave_correccion_json"), false);
  assert.equal(JSON.stringify(savedFirst.body).includes("correctAnswer"), false);
  const updatedFirst = await putAnswer("actividad-publica", firstAttempt.body.attempt.id, 1, { groupCode: "grupo-a", answer: "segunda versión" });
  assert.equal(updatedFirst.response.status, 200);
  const snapshotBeforeMutation = new DatabaseSync(databasePath);
  const storedSnapshot = snapshotBeforeMutation.prepare(`
    SELECT enunciado_snapshot AS prompt, puntaje_maximo AS points, clave_correccion_snapshot_json AS key
    FROM preguntas_intento_actividad WHERE intento_id = ?1 AND numero_pregunta = 1
  `).get(firstAttempt.body.attempt.id);
  assert.equal(storedSnapshot.prompt, "Pregunta pública");
  assert.equal(storedSnapshot.points, 1);
  assert.equal(storedSnapshot.key, '["b"]');
  snapshotBeforeMutation.exec(`
    UPDATE preguntas_actividad
    SET enunciado = 'Pregunta original modificada', puntaje = 99, clave_correccion_json = '["c"]'
    WHERE id = 1
  `);
  snapshotBeforeMutation.close();
  const savedAfterOriginalMutation = await putAnswer("actividad-publica", firstAttempt.body.attempt.id, 1, { groupCode: "grupo-a", answer: "sigue usando snapshot" });
  assert.equal(savedAfterOriginalMutation.response.status, 200);
  const wrongQuestion = await putAnswer("actividad-publica", firstAttempt.body.attempt.id, 2, { groupCode: "grupo-a", answer: "ajena" });
  assert.equal(wrongQuestion.response.status, 404);
  assert.equal(wrongQuestion.body.code, "QUESTION_NOT_FOUND");
  const otherGroupAttempt = await putAnswer("actividad-publica", firstAttempt.body.attempt.id, 1, { groupCode: "grupo-b", answer: "ajena" });
  assert.equal(otherGroupAttempt.response.status, 404);
  assert.equal(otherGroupAttempt.body.code, "ATTEMPT_NOT_FOUND");
  const otherActivityAttempt = await putAnswer("actividad-en-progreso", firstAttempt.body.attempt.id, 1, { answer: "ajena" });
  assert.equal(otherActivityAttempt.response.status, 404);
  assert.equal(otherActivityAttempt.body.code, "ATTEMPT_NOT_FOUND");
  const otherUserAttempt = await putAnswer("actividad-publica", firstAttempt.body.attempt.id, 1, { groupCode: "grupo-a", answer: "ajena" }, otherStudentToken);
  assert.equal(otherUserAttempt.response.status, 404);
  assert.equal(otherUserAttempt.body.code, "ATTEMPT_NOT_FOUND");
  const persistedAttempt = new DatabaseSync(databasePath);
  const initialValues = persistedAttempt.prepare(`
    SELECT estado AS state, puntaje_obtenido AS score, porcentaje AS percentage
    FROM intentos_actividad WHERE submission_id = 'inicio-uno'
  `).get();
  assert.equal(initialValues.state, "en_progreso");
  assert.equal(initialValues.score, 0);
  assert.equal(initialValues.percentage, 0);
  const savedRaw = persistedAttempt.prepare(`
    SELECT respuesta_dada_json AS answer, respuesta_normalizada_json AS normalized, correcta AS correct, puntaje_obtenido AS score
    FROM respuestas_intento_actividad WHERE intento_id = ?1 AND pregunta_id = 1
  `).get(firstAttempt.body.attempt.id);
  assert.equal(savedRaw.answer, '"sigue usando snapshot"');
  assert.equal(savedRaw.normalized, '"sigue usando snapshot"');
  assert.equal(savedRaw.correct, 0);
  assert.equal(savedRaw.score, 0);
  persistedAttempt.close();

  const multiAttempt = await postAttempt("actividad-respuestas", { submissionId: "respuestas-multiples" });
  assert.equal(multiAttempt.response.status, 201);
  const snapshotAtCreation = new DatabaseSync(databasePath);
  const initialSnapshotRows = snapshotAtCreation.prepare("SELECT COUNT(*) AS total FROM preguntas_intento_actividad WHERE intento_id = ?1").get(multiAttempt.body.attempt.id);
  snapshotAtCreation.close();
  assert.equal(initialSnapshotRows.total, 2, "incluye preguntas todavía no respondidas");
  const savedMultiFirst = await putAnswer("actividad-respuestas", multiAttempt.body.attempt.id, 1, { answer: "uno" });
  const savedMultiSecond = await putAnswer("actividad-respuestas", multiAttempt.body.attempt.id, 2, { answer: ["dos", "tres"] });
  assert.equal(savedMultiFirst.response.status, 200);
  assert.equal(savedMultiSecond.response.status, 200);
  const persistedMultiple = new DatabaseSync(databasePath);
  const multipleRows = persistedMultiple.prepare("SELECT COUNT(*) AS total FROM respuestas_intento_actividad WHERE intento_id = ?1").get(multiAttempt.body.attempt.id);
  const multiSnapshot = persistedMultiple.prepare("SELECT COUNT(*) AS total FROM preguntas_intento_actividad WHERE intento_id = ?1").get(multiAttempt.body.attempt.id);
  persistedMultiple.close();
  assert.equal(multipleRows.total, 2);
  assert.equal(multiSnapshot.total, 2);
  const sentAnswer = await putAnswer("actividad-agotada", sentAttemptId, 1, { answer: "bloqueada" });
  assert.equal(sentAnswer.response.status, 409);
  assert.equal(sentAnswer.body.code, "ATTEMPT_NOT_EDITABLE");
  const annulledAnswer = await putAnswer("actividad-anulada", annulledAttemptId, 1, { answer: "bloqueada" });
  assert.equal(annulledAnswer.response.status, 409);
  assert.equal(annulledAnswer.body.code, "ATTEMPT_NOT_EDITABLE");

  const repeatedAttempt = await postAttempt("actividad-publica", { groupCode: "grupo-a", submissionId: "inicio-uno" });
  assert.equal(repeatedAttempt.response.status, 201);
  assert.equal(repeatedAttempt.body.attempt.id, firstAttempt.body.attempt.id);
  const idempotentSnapshotCheck = new DatabaseSync(databasePath);
  const repeatedSnapshotRows = idempotentSnapshotCheck.prepare("SELECT COUNT(*) AS total FROM preguntas_intento_actividad WHERE intento_id = ?1").get(firstAttempt.body.attempt.id);
  idempotentSnapshotCheck.close();
  assert.equal(repeatedSnapshotRows.total, 1, "un retry idempotente no duplica snapshots");

  const beforeClose = await postAttempt("actividad-reintento-cierre", { submissionId: "reintento-cierre" });
  assert.equal(beforeClose.response.status, 201);
  const closeActivity = new DatabaseSync(databasePath);
  closeActivity.exec("UPDATE habilitaciones_actividad SET disponible_hasta = '2020-01-01T00:00:00Z' WHERE id = 18");
  closeActivity.close();
  const afterClose = await postAttempt("actividad-reintento-cierre", { submissionId: "reintento-cierre" });
  assert.equal(afterClose.response.status, 201);
  assert.equal(afterClose.body.attempt.id, beforeClose.body.attempt.id);
  const newAfterClose = await postAttempt("actividad-reintento-cierre", { submissionId: "nuevo-tras-cierre" });
  assert.equal(newAfterClose.response.status, 409);
  assert.equal(newAfterClose.body.code, "ACTIVITY_CLOSED");

  const beforeDisable = await postAttempt("actividad-reintento-deshabilitada", { submissionId: "reintento-deshabilitada" });
  assert.equal(beforeDisable.response.status, 201);
  const disableActivity = new DatabaseSync(databasePath);
  disableActivity.exec("UPDATE habilitaciones_actividad SET habilitada = 0 WHERE id = 19");
  disableActivity.close();
  const afterDisable = await postAttempt("actividad-reintento-deshabilitada", { submissionId: "reintento-deshabilitada" });
  assert.equal(afterDisable.response.status, 201);
  assert.equal(afterDisable.body.attempt.id, beforeDisable.body.attempt.id);
  const newAfterDisable = await postAttempt("actividad-reintento-deshabilitada", { submissionId: "nuevo-tras-deshabilitar" });
  assert.equal(newAfterDisable.response.status, 409);
  assert.equal(newAfterDisable.body.code, "ACTIVITY_DISABLED");

  const incompatibleIdempotency = await postAttempt("actividad-publica", { groupCode: "grupo-b", submissionId: "inicio-uno" });
  assert.equal(incompatibleIdempotency.response.status, 409);
  assert.equal(incompatibleIdempotency.body.code, "IDEMPOTENCY_CONFLICT");

  const secondAttempt = await postAttempt("actividad-publica", { groupCode: "grupo-a", submissionId: "inicio-dos" });
  assert.equal(secondAttempt.response.status, 201);
  assert.equal(secondAttempt.body.attempt.number, 2);
  const thirdAttempt = await postAttempt("actividad-publica", { groupCode: "grupo-a", submissionId: "inicio-tres" });
  assert.equal(thirdAttempt.response.status, 201);
  assert.equal(thirdAttempt.body.attempt.number, 3);
  const exhaustedAttempt = await postAttempt("actividad-publica", { groupCode: "grupo-a", submissionId: "inicio-cuatro" });
  assert.equal(exhaustedAttempt.response.status, 409);
  assert.equal(exhaustedAttempt.body.code, "NO_ATTEMPTS_AVAILABLE");

  const annulatedDoesNotConsume = await postAttempt("actividad-anulada", { submissionId: "despues-de-anulado" });
  assert.equal(annulatedDoesNotConsume.response.status, 201);
  assert.equal(annulatedDoesNotConsume.body.attempt.number, 2);
  assert.equal(annulatedDoesNotConsume.body.attempt.ordinal, 1);
  const otherActivity = await postAttempt("actividad-en-progreso", { submissionId: "inicio-uno" });
  assert.equal(otherActivity.response.status, 201);
  assert.equal(otherActivity.body.attempt.number, 3);

  const anonymousSubmit = await fetch(`${baseUrl}/api/me/activities/actividad-submit/attempts/1/submit`, {
    method: "POST",
    headers: { Origin: baseUrl },
  });
  assert.equal(anonymousSubmit.status, 401);
  assert.equal(anonymousSubmit.headers.get("Cache-Control"), "no-store");
  assert.equal((await anonymousSubmit.json()).code, "SESSION_REQUIRED");

  const reviewSource = new DatabaseSync(databasePath);
  reviewSource.exec(`
    UPDATE preguntas_actividad SET
      opciones_json = '["a","b"]', explicacion_revision_final = 'Explicación final radio ficticia'
    WHERE id = 11;
    UPDATE preguntas_actividad SET
      explicacion_revision_final = 'Explicación final texto ficticia'
    WHERE id = 12;
    UPDATE preguntas_actividad SET
      opciones_json = '["a","b","c"]', explicacion_revision_final = 'Explicación final checkbox ficticia'
    WHERE id = 13;
  `);
  reviewSource.close();
  const submitDraft = await postAttempt("actividad-submit", { submissionId: "entrega-completa" });
  assert.equal(submitDraft.response.status, 201);
  const incompleteSubmit = await submit("actividad-submit", submitDraft.body.attempt.id);
  assert.equal(incompleteSubmit.response.status, 409);
  assert.equal(incompleteSubmit.body.code, "ATTEMPT_INCOMPLETE");
  const teacherSubmit = await submit("actividad-submit", submitDraft.body.attempt.id, null, teacherToken);
  assert.equal(teacherSubmit.response.status, 403);
  assert.equal(teacherSubmit.body.code, "STUDENT_ROLE_REQUIRED");
  const foreignSubmit = await submit("actividad-submit", submitDraft.body.attempt.id, null, otherStudentToken);
  assert.equal(foreignSubmit.response.status, 404);
  assert.equal(foreignSubmit.body.code, "ATTEMPT_NOT_FOUND");
  const missingSubmit = await submit("actividad-submit", 999999);
  assert.equal(missingSubmit.response.status, 404);
  assert.equal(missingSubmit.body.code, "ATTEMPT_NOT_FOUND");
  assert.equal((await putAnswer("actividad-submit", submitDraft.body.attempt.id, 1, { answer: "b" })).response.status, 200);
  assert.equal((await putAnswer("actividad-submit", submitDraft.body.attempt.id, 2, { answer: " valor " })).response.status, 200);
  assert.equal((await putAnswer("actividad-submit", submitDraft.body.attempt.id, 3, { answer: ["c", "a"] })).response.status, 200);
  const concurrentSubmit = await Promise.all([
    submit("actividad-submit", submitDraft.body.attempt.id),
    submit("actividad-submit", submitDraft.body.attempt.id),
  ]);
  assert.deepEqual(concurrentSubmit.map(({ response }) => response.status), [200, 200]);
  assert.deepEqual(concurrentSubmit[0].body, concurrentSubmit[1].body, "dos submit concurrentes recuperan el mismo cierre");
  const submitted = concurrentSubmit[0];
  assert.equal(submitted.response.status, 200);
  assert.equal(submitted.response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(submitted.body.attempt, {
    id: submitDraft.body.attempt.id,
    state: "enviado",
    number: 1,
    ordinal: 1,
    score: 3,
    total: 3,
    percentage: 100,
    judgment: "logrado",
    submittedAt: submitted.body.attempt.submittedAt,
  });
  assert.equal(typeof submitted.body.attempt.submittedAt, "string");
  assert.deepEqual(submitted.body.answers, [
    { number: 1, correct: true, score: 1 },
    { number: 2, correct: true, score: 1 },
    { number: 3, correct: true, score: 1 },
  ]);
  assert.equal(submitted.body.attempts.used, 1);
  assert.equal(submitted.body.attempts.remaining, 1);
  assert.equal(submitted.body.reviewAvailable, false);
  const submittedJson = JSON.stringify(submitted.body);
  for (const forbidden of ["clave_correccion", "correctAnswer", "correctas", "aceptadas", "explicacion_revision_final", "retroalimentacion", "modo"]) {
    assert.equal(submittedJson.includes(forbidden), false, `submit no debe incluir ${forbidden}`);
  }
  const persistedSubmit = new DatabaseSync(databasePath);
  const submittedRows = persistedSubmit.prepare(`
    SELECT correcta AS correct, puntaje_obtenido AS score, respuesta_normalizada_json AS normalized
    FROM respuestas_intento_actividad WHERE intento_id = ?1 ORDER BY numero_pregunta
  `).all(submitDraft.body.attempt.id);
  assert.deepEqual(submittedRows.map((row) => ({ ...row })), [
    { correct: 1, score: 1, normalized: '"b"' },
    { correct: 1, score: 1, normalized: '"valor"' },
    { correct: 1, score: 1, normalized: '["a","c"]' },
  ]);
  persistedSubmit.exec("UPDATE preguntas_actividad SET clave_correccion_json = '{\"modo\":\"opcion\",\"correctas\":[\"a\"]}' WHERE id = 11");
  persistedSubmit.close();
  const retrySubmit = await submit("actividad-submit", submitDraft.body.attempt.id);
  assert.equal(retrySubmit.response.status, 200);
  assert.deepEqual(retrySubmit.body, submitted.body, "submit repetido devuelve el resultado persistido sin recalificar");
  const editAfterSubmit = await putAnswer("actividad-submit", submitDraft.body.attempt.id, 1, { answer: "a" });
  assert.equal(editAfterSubmit.response.status, 409);
  assert.equal(editAfterSubmit.body.code, "ATTEMPT_NOT_EDITABLE");
  const anuladoSubmit = await submit("actividad-anulada", annulledAttemptId);
  assert.equal(anuladoSubmit.response.status, 409);
  assert.equal(anuladoSubmit.body.code, "ATTEMPT_NOT_FINALIZABLE");

  const secondSubmitDraft = await postAttempt("actividad-submit", { submissionId: "entrega-segunda" });
  assert.equal(secondSubmitDraft.response.status, 201);
  assert.equal((await putAnswer("actividad-submit", secondSubmitDraft.body.attempt.id, 1, { answer: "b" })).response.status, 200);
  assert.equal((await putAnswer("actividad-submit", secondSubmitDraft.body.attempt.id, 2, { answer: "otro" })).response.status, 200);
  assert.equal((await putAnswer("actividad-submit", secondSubmitDraft.body.attempt.id, 3, { answer: ["a"] })).response.status, 200);
  const secondSubmitted = await submit("actividad-submit", secondSubmitDraft.body.attempt.id);
  assert.equal(secondSubmitted.response.status, 200);
  assert.equal(secondSubmitted.body.attempt.score, 0);
  assert.equal(secondSubmitted.body.attempt.percentage, 0);
  assert.equal(secondSubmitted.body.attempt.judgment, "inicial");
  assert.equal(secondSubmitted.body.attempts.used, 2);
  assert.equal(secondSubmitted.body.attempts.remaining, 0);
  assert.equal(secondSubmitted.body.reviewAvailable, true);
  assert.equal(secondSubmitted.body.attempts.best.id, undefined);
  assert.equal(secondSubmitted.body.attempts.best.score, 3);
  const changeOriginalAfterSubmit = new DatabaseSync(databasePath);
  changeOriginalAfterSubmit.exec(`
    UPDATE preguntas_actividad SET
      enunciado = 'Pregunta editada después de enviar', opciones_json = '["cambio"]',
      explicacion_revision_final = 'Explicación editada después de enviar'
    WHERE id IN (11, 12, 13);
    UPDATE habilitaciones_actividad
    SET disponible_hasta = '2020-01-01T00:00:00Z'
    WHERE id = 21;
  `);
  changeOriginalAfterSubmit.close();
  const reviewAfterClose = await review("actividad-submit");
  assert.equal(reviewAfterClose.response.status, 200);
  assert.equal(reviewAfterClose.response.headers.get("Cache-Control"), "no-store");
  assert.equal(reviewAfterClose.body.bestAttemptId, submitDraft.body.attempt.id);
  assert.equal(reviewAfterClose.body.attempts.length, 2);
  assert.deepEqual(reviewAfterClose.body.attempts.map((attempt) => attempt.id), [submitDraft.body.attempt.id, secondSubmitDraft.body.attempt.id]);
  assert.deepEqual(reviewAfterClose.body.attempts[0].questions, [
    {
      number: 1,
      prompt: "Radio de entrega",
      type: "radio",
      options: ["a", "b"],
      studentAnswer: "b",
      correct: true,
      pointsAwarded: 1,
      maxPoints: 1,
      correctAnswer: { value: "b" },
      explanation: "Explicación final radio ficticia",
    },
    {
      number: 2,
      prompt: "Texto de entrega",
      type: "text",
      options: [],
      studentAnswer: " valor ",
      correct: true,
      pointsAwarded: 1,
      maxPoints: 1,
      correctAnswer: { values: ["valor"] },
      explanation: "Explicación final texto ficticia",
    },
    {
      number: 3,
      prompt: "Checkbox de entrega",
      type: "checkbox",
      options: ["a", "b", "c"],
      studentAnswer: ["c", "a"],
      correct: true,
      pointsAwarded: 1,
      maxPoints: 1,
      correctAnswer: { values: ["a", "c"] },
      explanation: "Explicación final checkbox ficticia",
    },
  ]);
  const reviewJson = JSON.stringify(reviewAfterClose.body);
  for (const forbidden of ["clave_correccion_json", "clave_correccion_snapshot_json", "\"modo\"", "correctas", "aceptadas", "SQL"]) {
    assert.equal(reviewJson.includes(forbidden), false, `revisión no debe incluir ${forbidden}`);
  }
  const otherStudentReview = await review("actividad-submit", null, otherStudentToken);
  assert.equal(otherStudentReview.response.status, 403);
  assert.equal(otherStudentReview.body.code, "REVIEW_NOT_AVAILABLE");

  const concurrent = await Promise.all([
    postAttempt("actividad-en-progreso", { submissionId: "concurrente-a" }),
    postAttempt("actividad-en-progreso", { submissionId: "concurrente-b" }),
  ]);
  assert.equal(concurrent.filter(({ response }) => response.status === 201).length, 1, "D1 acepta sólo un cupo concurrente restante");
  assert.equal(concurrent.filter(({ body }) => body.code === "NO_ATTEMPTS_AVAILABLE").length, 1);
});
