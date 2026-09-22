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
      const response = await fetch(`${baseUrl}/api/session`);
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

// Actividad 1: cuatro preguntas de 25 puntos (total 100). Los porcentajes
// posibles son múltiplos de 25, lo que permite fijar estadísticas exactas.
const activity1Questions = [
  { id: 1, number: 1, points: 25 },
  { id: 2, number: 2, points: 25 },
  { id: 3, number: 3, points: 25 },
  { id: 4, number: 4, points: 25 },
];

// Actividad 7: misma estructura de puntaje que la actividad 1 pero con ids de
// pregunta propios, para verificar la mediana con cantidad par (37.5).
const activity7Questions = [
  { id: 5, number: 1, points: 25 },
  { id: 6, number: 2, points: 25 },
  { id: 7, number: 3, points: 25 },
  { id: 8, number: 4, points: 25 },
];

function insertAttempt(database, activityId, habilitationId, userId, number, ordinal, submission, total) {
  database.prepare(`
    INSERT INTO intentos_actividad
      (actividad_id, habilitacion_id, usuario_id, numero_intento, ordinal_efectivo, estado,
       puntaje_obtenido, puntaje_total, porcentaje, juicio, devolucion, submission_id)
    VALUES (?1, ?2, ?3, ?4, ?5, 'en_progreso', 0, ?6, 0, 'inicial', '', ?7)
  `).run(activityId, habilitationId, userId, number, ordinal, total, submission);
  return database.prepare("SELECT id FROM intentos_actividad WHERE submission_id = ?1").get(submission).id;
}

// El cierre exige respuestas coherentes para las cuatro preguntas y un
// porcentaje calculado; el juicio se persiste tal cual recibe.
function sendActivity(database, attemptId, correctFlags, sentAt, judgment, questions = activity1Questions) {
  let score = 0;
  questions.forEach((question, index) => {
    const correct = correctFlags[index] ? 1 : 0;
    if (correct) score += question.points;
    database.prepare(`
      INSERT INTO respuestas_intento_actividad
        (intento_id, pregunta_id, numero_pregunta, tipo_pregunta, enunciado_snapshot,
         respuesta_dada_json, respuesta_normalizada_json, correcta, puntaje_obtenido)
      VALUES (?1, ?2, ?3, 'radio', 'Pregunta de prueba', 'null', 'null', ?4, ?5)
    `).run(attemptId, question.id, question.number, correct, correct ? question.points : 0);
  });
  const total = questions.reduce((sum, question) => sum + question.points, 0);
  const percentage = Math.round((100 * score) / total);
  database.prepare(`
    UPDATE intentos_actividad
    SET puntaje_obtenido = ?1, porcentaje = ?2, enviado_en = ?3, estado = 'enviado', juicio = ?4
    WHERE id = ?5
  `).run(score, percentage, sentAt, judgment, attemptId);
  return { score, percentage };
}

// un intento enviado con porcentaje objetivo se construye eligiendo la cantidad
// de respuestas correctas que producen ese porcentaje (múltiplos de 25 aquí).
const flagsForPercentage = {
  0: [false, false, false, false],
  25: [true, false, false, false],
  50: [true, true, false, false],
  75: [true, true, true, false],
  100: [true, true, true, true],
};

test("GET /api/teacher/groups/:groupId/activities/:activityId/results aplica el contrato C2 con D1 local", async (t) => {
  const projectRoot = process.cwd();
  const persistenceRoot = mkdtempSync(join(tmpdir(), "profemacon-teacher-activity-results-"));
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
      (1, 'estudiante', 'Estudiante'), (2, 'docente', 'Docente'), (3, 'practicante', 'Practicante');
    INSERT INTO usuarios (id, nombre_usuario, nombre_mostrado, estado) VALUES
      (1, 'docente-propio', 'Docente propio', 'activo'),
      (2, 'docente-ajeno', 'Docente ajeno', 'activo'),
      (3, 'alumno-alfa', 'Alumno Alfa', 'activo'),
      (4, 'alumno-beta', 'Alumno Beta', 'activo'),
      (5, 'alumno-gamma', 'Alumno Gamma', 'activo'),
      (6, 'alumno-delta', 'Alumno Delta', 'activo'),
      (7, 'alumno-epsilon', 'Alumno Epsilon', 'activo'),
      (8, 'alumno-zeta', 'Alumno Zeta', 'activo'),
      (9, 'practicante', 'Practicante', 'activo'),
      (10, 'alumno-suspendido', 'Alumno suspendido', 'suspendido'),
      (11, 'alumno-eta', 'Alumno Eta', 'activo'),
      (12, 'alumno-sin-rol', 'Alumno sin rol', 'activo'),
      (13, 'alumno-pendiente', 'Alumno pendiente', 'activo');
    INSERT INTO usuario_roles (usuario_id, rol_id) VALUES
      (1, 2), (2, 2), (3, 1), (4, 1), (5, 1), (6, 1), (7, 1), (8, 1), (9, 3), (10, 1), (11, 1), (13, 1);
    INSERT INTO asignaturas (id, codigo, nombre) VALUES (1, 'programacion-prueba', 'Programación de prueba');
    INSERT INTO ediciones_anuales (id, asignatura_id, anio, nombre, estado) VALUES
      (1, 1, 2026, 'Edición de prueba', 'activa'),
      (2, 1, 2027, 'Otra edición', 'activa');
    INSERT INTO grupos (id, edicion_anual_id, codigo, nombre, estado) VALUES
      (1, 1, 'grupo-a', 'Grupo A', 'activo'),
      (2, 1, 'grupo-b', 'Grupo B', 'activo'),
      (3, 1, 'grupo-vacio', 'Grupo vacío', 'activo'),
      (5, 1, 'grupo-archivado', 'Grupo archivado', 'archivado');
    INSERT INTO inscripciones (usuario_id, grupo_id, estado) VALUES
      (3, 1, 'activa'), (4, 1, 'activa'), (5, 1, 'activa'), (6, 1, 'activa'), (7, 1, 'activa'),
      (8, 1, 'activa'), (10, 1, 'activa'), (11, 1, 'activa'), (12, 1, 'activa'), (13, 1, 'pendiente'),
      (3, 2, 'activa');
    INSERT INTO asignaciones_grupo (usuario_id, grupo_id, tipo, estado) VALUES
      (1, 1, 'docente', 'activa'), (1, 3, 'docente', 'activa'), (1, 5, 'docente', 'activa');
    INSERT INTO actividades
      (id, slug, edicion_anual_id, unidad_codigo, tema, orden, titulo, descripcion, estado, puntaje_total, maximo_intentos)
    VALUES
      (1, 'actividad-habilitada', 1, 'unidad-1', 'tema', 1, 'Actividad habilitada', '', 'activa', 100, 10),
      (2, 'actividad-sin-habilitacion', 1, 'unidad-1', 'tema', 2, 'Actividad sin habilitación', '', 'activa', 100, 1),
      (4, 'actividad-deshabilitada', 1, 'unidad-1', 'tema', 3, 'Actividad deshabilitada', '', 'borrador', 100, 1),
      (5, 'actividad-no-abierta', 1, 'unidad-1', 'tema', 4, 'Actividad no abierta', '', 'activa', 100, 1),
      (6, 'actividad-cerrada', 1, 'unidad-1', 'tema', 5, 'Actividad cerrada', '', 'activa', 100, 1),
      (7, 'actividad-mediana-par', 1, 'unidad-1', 'tema', 6, 'Actividad mediana par', '', 'activa', 100, 1),
      (3, 'actividad-otra-edicion', 2, 'unidad-1', 'tema', 1, 'Actividad de otra edición', '', 'activa', 100, 1);
    INSERT INTO habilitaciones_actividad (id, actividad_id, grupo_id, habilitada, disponible_desde, disponible_hasta) VALUES
      (1, 1, 1, 1, NULL, NULL),
      (2, 1, 2, 1, NULL, NULL),
      (3, 4, 1, 0, NULL, NULL),
      (4, 5, 1, 1, datetime('now', '+7 days'), NULL),
      (5, 6, 1, 1, NULL, datetime('now', '-7 days')),
      (6, 7, 1, 1, NULL, NULL);
    INSERT INTO preguntas_actividad
      (id, actividad_id, numero, tipo, enunciado, instrucciones, opciones_json, recursos_json, puntaje)
    VALUES
      (1, 1, 1, 'radio', 'Pregunta uno', '', '["a","b"]', '[]', 25),
      (2, 1, 2, 'radio', 'Pregunta dos', '', '["a","b"]', '[]', 25),
      (3, 1, 3, 'radio', 'Pregunta tres', '', '["a","b"]', '[]', 25),
      (4, 1, 4, 'radio', 'Pregunta cuatro', '', '["a","b"]', '[]', 25),
      (5, 7, 1, 'radio', 'Pregunta uno', '', '["a","b"]', '[]', 25),
      (6, 7, 2, 'radio', 'Pregunta dos', '', '["a","b"]', '[]', 25),
      (7, 7, 3, 'radio', 'Pregunta tres', '', '["a","b"]', '[]', 25),
      (8, 7, 4, 'radio', 'Pregunta cuatro', '', '["a","b"]', '[]', 25);
  `);

  // Alfa: dos enviados con empate por porcentaje (desempate por fecha ASC), un
  // enviado menor, un borrador y un anulado. El mejor es 100 % del 2026-01-01.
  const alfaA = insertAttempt(database, 1, 1, 3, 1, 1, "alfa-a", 100);
  sendActivity(database, alfaA, flagsForPercentage[100], "2026-01-01T00:00:00Z", "logrado");
  const alfaB = insertAttempt(database, 1, 1, 3, 2, 2, "alfa-b", 100);
  sendActivity(database, alfaB, flagsForPercentage[100], "2026-01-03T00:00:00Z", "logrado");
  const alfaC = insertAttempt(database, 1, 1, 3, 3, 3, "alfa-c", 100);
  sendActivity(database, alfaC, flagsForPercentage[50], "2026-01-02T00:00:00Z", "en_proceso");
  // El índice único de la migración 0010 impide dos borradores simultáneos: el
  // anulado se crea y anula antes de abrir el borrador vivo.
  const alfaAnulado = insertAttempt(database, 1, 1, 3, 4, 4, "alfa-anulado", 100);
  database.exec(`UPDATE intentos_actividad SET estado = 'anulado' WHERE id = ${alfaAnulado}`);
  insertAttempt(database, 1, 1, 3, 5, 4, "alfa-borrador", 100);
  // Intento enviado en otro grupo de la misma actividad: no debe filtrarse al grupo 1.
  const alfaGrupoB = insertAttempt(database, 1, 2, 3, 1, 1, "alfa-grupo-b", 100);
  sendActivity(database, alfaGrupoB, flagsForPercentage[100], "2026-03-01T00:00:00Z", "logrado");

  // Beta: sólo un borrador.
  insertAttempt(database, 1, 1, 4, 1, 1, "beta-borrador", 100);

  // Gamma: mejor 50 % con juicio persistido 'inicial'.
  const gamma = insertAttempt(database, 1, 1, 5, 1, 1, "gamma-enviado", 100);
  sendActivity(database, gamma, flagsForPercentage[50], "2026-02-01T00:00:00Z", "inicial");

  // Delta: mejor 75 % con juicio 'en_proceso'.
  const delta = insertAttempt(database, 1, 1, 6, 1, 1, "delta-enviado", 100);
  sendActivity(database, delta, flagsForPercentage[75], "2026-02-02T00:00:00Z", "en_proceso");

  // Épsilon: sin intentos.

  // Zeta: mejor 25 % pero juicio persistido 'logrado' (no se recalcula).
  const zeta = insertAttempt(database, 1, 1, 8, 1, 1, "zeta-enviado", 100);
  sendActivity(database, zeta, flagsForPercentage[25], "2026-02-03T00:00:00Z", "logrado");

  // Eta: enviado de 0 % (cuenta como enviado) con juicio 'inicial'.
  const eta = insertAttempt(database, 1, 1, 11, 1, 1, "eta-enviado", 100);
  sendActivity(database, eta, flagsForPercentage[0], "2026-02-04T00:00:00Z", "inicial");

  // Actividad 7: cuatro enviados (0, 25, 50 y 75 %) para verificar la mediana
  // con cantidad par (37.5) y el promedio con decimales.
  for (const [userId, percentage, slot] of [[3, 0, 1], [4, 25, 2], [5, 50, 3], [6, 75, 4]]) {
    const attempt = insertAttempt(database, 7, 6, userId, 1, 1, `mediana-${userId}`, 100);
    sendActivity(database, attempt, flagsForPercentage[percentage], `2026-04-0${slot}T00:00:00Z`, "logrado", activity7Questions);
  }

  const propiaToken = await createSession(database, 1);
  const ajenaToken = await createSession(database, 2);
  const alumnoToken = await createSession(database, 3);
  const practicanteToken = await createSession(database, 9);
  database.close();
  database = undefined;

  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const workerConfig = join(persistenceRoot, "wrangler.teacher-activity-results.json");
  writeFileSync(workerConfig, JSON.stringify({
    name: "profemacon-teacher-activity-results-test",
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

  const get = async (groupId, activityId, token) => {
    const response = await fetch(`${baseUrl}/api/teacher/groups/${groupId}/activities/${activityId}/results`, {
      headers: token ? { Cookie: `pm_session=${token}` } : undefined,
    });
    return { response, body: await response.json() };
  };

  // Autorización y cabeceras.
  const anonymous = await get(1, 1);
  assert.equal(anonymous.response.status, 401);
  assert.equal(anonymous.response.headers.get("Cache-Control"), "no-store");
  assert.equal(anonymous.body.code, "SESSION_REQUIRED");

  const student = await get(1, 1, alumnoToken);
  assert.equal(student.response.status, 403);
  assert.equal(student.body.code, "TEACHER_ROLE_REQUIRED");

  const practitioner = await get(1, 1, practicanteToken);
  assert.equal(practitioner.response.status, 403);
  assert.equal(practitioner.body.code, "TEACHER_ROLE_REQUIRED");

  const foreignTeacher = await get(1, 1, ajenaToken);
  assert.equal(foreignTeacher.response.status, 403);
  assert.equal(foreignTeacher.body.code, "TEACHER_GROUP_REQUIRED");

  const missingGroup = await get(999999, 1, propiaToken);
  assert.equal(missingGroup.response.status, 404);
  assert.equal(missingGroup.body.code, "GROUP_NOT_FOUND");

  const archivedGroup = await get(5, 1, propiaToken);
  assert.equal(archivedGroup.response.status, 403);
  assert.equal(archivedGroup.body.code, "TEACHER_GROUP_REQUIRED");

  // Actividad de otra edición: el scope la rechaza.
  const otherEdition = await get(1, 3, propiaToken);
  assert.equal(otherEdition.response.status, 403);
  assert.equal(otherEdition.body.code, "TEACHER_GROUP_REQUIRED");

  // Actividad inexistente: el scope responde 403 (contrato real del scope).
  const missingActivity = await get(1, 999999, propiaToken);
  assert.equal(missingActivity.response.status, 403);
  assert.equal(missingActivity.body.code, "TEACHER_GROUP_REQUIRED");

  // Actividad habilitada y disponible.
  const ok = await get(1, 1, propiaToken);
  assert.equal(ok.response.status, 200);
  assert.equal(ok.response.headers.get("Cache-Control"), "no-store");
  assert.equal(ok.response.headers.get("X-Content-Type-Options"), "nosniff");

  const payload = ok.body;
  assert.equal(payload.group.id, 1);
  assert.equal(payload.group.code, "grupo-a");
  assert.equal(payload.group.editionId, 1);

  assert.equal(payload.activity.id, 1);
  assert.equal(payload.activity.slug, "actividad-habilitada");
  assert.equal(payload.activity.title, "Actividad habilitada");
  assert.equal(payload.activity.unitCode, "unidad-1");
  assert.equal(payload.activity.editorialState, "activa");
  assert.equal(payload.activity.maxAttempts, 10);
  assert.equal(payload.activity.availabilityStatus, "available");

  // Estudiantes visibles: activos, con rol estudiante e inscripción activa.
  assert.deepEqual(payload.students.map((student) => student.studentId), [3, 4, 6, 7, 11, 5, 8]);
  assert.deepEqual(payload.students.map((student) => student.username), [
    "alumno-alfa", "alumno-beta", "alumno-delta", "alumno-epsilon", "alumno-eta", "alumno-gamma", "alumno-zeta",
  ]);

  // Resumen numérico.
  const summary = payload.summary;
  assert.equal(summary.totalStudents, 7);
  assert.equal(summary.withoutAttempt, 1); // Épsilon
  assert.equal(summary.inProgress, 1); // Beta (sólo borrador)
  assert.equal(summary.inicial, 2); // Gamma y Eta
  assert.equal(summary.en_proceso, 1); // Delta
  assert.equal(summary.logrado, 2); // Alfa y Zeta
  assert.equal(
    summary.withoutAttempt + summary.inProgress + summary.inicial + summary.en_proceso + summary.logrado,
    summary.totalStudents,
  );
  // Mejores porcentajes enviados: [100, 50, 75, 25, 0] → promedio 50, mediana 50.
  assert.equal(summary.averageBestPercentage, 50);
  assert.equal(summary.medianBestPercentage, 50);

  const studentById = new Map(payload.students.map((student) => [student.studentId, student]));

  // Alfa: mejor intento por desempate (porcentaje, puntaje, fecha ASC).
  const alfa = studentById.get(3);
  assert.equal(alfa.attemptsUsed, 4); // 3 enviados + 1 borrador; el anulado no cuenta
  assert.equal(alfa.hasDraft, true);
  assert.equal(alfa.lastSubmittedAt, "2026-01-03T00:00:00Z");
  assert.deepEqual(alfa.best, {
    percentage: 100,
    score: 100,
    total: 100,
    judgment: "logrado",
    ordinal: 1,
    submittedAt: "2026-01-01T00:00:00Z",
  });

  // Beta: sólo borrador → sin mejor intento.
  const beta = studentById.get(4);
  assert.equal(beta.best, null);
  assert.equal(beta.hasDraft, true);
  assert.equal(beta.attemptsUsed, 1);
  assert.equal(beta.lastSubmittedAt, null);

  // Gamma: 50 % con juicio 'inicial' persistido.
  const gammaStudent = studentById.get(5);
  assert.equal(gammaStudent.best.percentage, 50);
  assert.equal(gammaStudent.best.judgment, "inicial");
  assert.equal(gammaStudent.hasDraft, false);
  assert.equal(gammaStudent.attemptsUsed, 1);

  // Delta: 75 % con juicio 'en_proceso'.
  const deltaStudent = studentById.get(6);
  assert.equal(deltaStudent.best.percentage, 75);
  assert.equal(deltaStudent.best.judgment, "en_proceso");

  // Épsilon: sin intentos.
  const epsilon = studentById.get(7);
  assert.equal(epsilon.best, null);
  assert.equal(epsilon.attemptsUsed, 0);
  assert.equal(epsilon.hasDraft, false);
  assert.equal(epsilon.lastSubmittedAt, null);

  // Zeta: 25 % pero juicio persistido 'logrado' (no se recalcula).
  const zetaStudent = studentById.get(8);
  assert.equal(zetaStudent.best.percentage, 25);
  assert.equal(zetaStudent.best.judgment, "logrado");

  // Eta: 0 % enviado cuenta como enviado.
  const etaStudent = studentById.get(11);
  assert.equal(etaStudent.best.percentage, 0);
  assert.equal(etaStudent.best.judgment, "inicial");

  // Actividad sin habilitación: se devuelve igual, todos sin intento y métricas nulas.
  const noAvailability = await get(1, 2, propiaToken);
  assert.equal(noAvailability.response.status, 200);
  assert.equal(noAvailability.body.activity.availabilityStatus, "disabled");
  assert.equal(noAvailability.body.summary.totalStudents, 7);
  assert.equal(noAvailability.body.summary.withoutAttempt, 7);
  assert.equal(noAvailability.body.summary.averageBestPercentage, null);
  assert.equal(noAvailability.body.summary.medianBestPercentage, null);

  // Actividad deshabilitada (habilitación presente con habilitada = 0).
  const disabled = await get(1, 4, propiaToken);
  assert.equal(disabled.body.activity.availabilityStatus, "disabled");
  assert.equal(disabled.body.activity.editorialState, "borrador");

  // Actividad no abierta.
  const notOpen = await get(1, 5, propiaToken);
  assert.equal(notOpen.body.activity.availabilityStatus, "not_open");

  // Actividad cerrada.
  const closed = await get(1, 6, propiaToken);
  assert.equal(closed.body.activity.availabilityStatus, "closed");

  // Grupo sin estudiantes.
  const emptyGroup = await get(3, 1, propiaToken);
  assert.equal(emptyGroup.response.status, 200);
  assert.equal(emptyGroup.body.summary.totalStudents, 0);
  assert.equal(emptyGroup.body.students.length, 0);
  assert.equal(emptyGroup.body.summary.averageBestPercentage, null);
  assert.equal(emptyGroup.body.summary.medianBestPercentage, null);

  // Privacidad: la respuesta nunca expone datos internos.
  const serialized = JSON.stringify(payload);
  for (const forbidden of [
    "approvalThreshold", "achievementThreshold",
    "clave", "clave_correccion", "respuesta_dada", "respuesta_normalizada",
    "correcta", "modo", "feedback", "devolucion", "submission", "submissionId",
    "respuestas_intento", "preguntas_intento", "snapshot", "documento", "archivo",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `la respuesta no debe incluir "${forbidden}"`);
  }

  // Actividad con cantidad par de enviados: promedio y mediana con decimales.
  const even = await get(1, 7, propiaToken);
  assert.equal(even.response.status, 200);
  // Mejores porcentajes: [0, 25, 50, 75]; el resto de estudiantes sin envío.
  assert.equal(even.body.summary.logrado, 4);
  assert.equal(even.body.summary.withoutAttempt, 3);
  assert.equal(even.body.summary.averageBestPercentage, 37.5);
  assert.equal(even.body.summary.medianBestPercentage, 37.5);
  assert.equal(
    even.body.summary.withoutAttempt + even.body.summary.inProgress + even.body.summary.inicial
      + even.body.summary.en_proceso + even.body.summary.logrado,
    even.body.summary.totalStudents,
  );
});
