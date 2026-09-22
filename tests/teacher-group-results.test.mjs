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

function insertAttempt(database, activityId, habilitationId, userId, number, ordinal, submission, total) {
  database.prepare(`
    INSERT INTO intentos_actividad
      (actividad_id, habilitacion_id, usuario_id, numero_intento, ordinal_efectivo, estado,
       puntaje_obtenido, puntaje_total, porcentaje, juicio, devolucion, submission_id)
    VALUES (?1, ?2, ?3, ?4, ?5, 'en_progreso', 0, ?6, 0, 'inicial', '', ?7)
  `).run(activityId, habilitationId, userId, number, ordinal, total, submission);
  return database.prepare("SELECT id FROM intentos_actividad WHERE submission_id = ?1").get(submission).id;
}

// Actividad 1 tiene tres preguntas (149, 50, 1) con total 200. La coherencia de
// cierre exige respuestas para las tres preguntas y un porcentaje calculado.
const activity1Questions = [
  { questionId: 1, number: 1, points: 149 },
  { questionId: 2, number: 2, points: 50 },
  { questionId: 3, number: 3, points: 1 },
];

function sendActivity1(database, attemptId, correctFlags, score, percentage, sentAt, judgment) {
  activity1Questions.forEach((question, index) => {
    const correct = correctFlags[index] ? 1 : 0;
    database.prepare(`
      INSERT INTO respuestas_intento_actividad
        (intento_id, pregunta_id, numero_pregunta, tipo_pregunta, enunciado_snapshot,
         respuesta_dada_json, respuesta_normalizada_json, correcta, puntaje_obtenido)
      VALUES (?1, ?2, ?3, 'radio', 'Pregunta de prueba', 'null', 'null', ?4, ?5)
    `).run(attemptId, question.questionId, question.number, correct, correct ? question.points : 0);
  });
  database.prepare(`
    UPDATE intentos_actividad
    SET puntaje_obtenido = ?1, porcentaje = ?2, enviado_en = ?3, estado = 'enviado', juicio = ?4
    WHERE id = ?5
  `).run(score, percentage, sentAt, judgment, attemptId);
}

test("GET /api/teacher/groups/:groupId/results aplica el contrato de matriz con D1 local", async (t) => {
  const projectRoot = process.cwd();
  const persistenceRoot = mkdtempSync(join(tmpdir(), "profemacon-teacher-results-"));
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
      (4, 'alumno-pendiente', 'Alumno pendiente', 'activo'),
      (5, 'alumno-suspendido', 'Alumno suspendido', 'suspendido'),
      (6, 'alumno-sin-rol', 'Alumno sin rol', 'activo'),
      (7, 'practicante', 'Practicante', 'activo'),
      (9, 'alumno-beta', 'Alumno Beta', 'activo'),
      (10, 'alumno-gamma', 'Alumno Gamma', 'activo');
    INSERT INTO usuario_roles (usuario_id, rol_id) VALUES
      (1, 2), (2, 2), (3, 1), (4, 1), (5, 1), (7, 3), (9, 1), (10, 1);
    INSERT INTO asignaturas (id, codigo, nombre) VALUES (1, 'programacion-prueba', 'Programación de prueba');
    INSERT INTO ediciones_anuales (id, asignatura_id, anio, nombre, estado) VALUES
      (1, 1, 2026, 'Edición de prueba', 'activa'),
      (2, 1, 2027, 'Otra edición', 'activa');
    INSERT INTO grupos (id, edicion_anual_id, codigo, nombre, estado) VALUES
      (1, 1, 'grupo-a', 'Grupo A', 'activo'),
      (2, 1, 'grupo-b', 'Grupo B', 'activo'),
      (5, 1, 'grupo-archivado', 'Grupo archivado', 'archivado');
    INSERT INTO inscripciones (usuario_id, grupo_id, estado) VALUES
      (3, 1, 'activa'), (3, 2, 'activa'), (4, 1, 'pendiente'), (5, 1, 'activa'),
      (6, 1, 'activa'), (7, 1, 'activa'), (9, 1, 'activa'), (10, 1, 'activa');
    INSERT INTO asignaciones_grupo (usuario_id, grupo_id, tipo, estado) VALUES
      (1, 1, 'docente', 'activa'), (1, 5, 'docente', 'activa');
    INSERT INTO actividades
      (id, slug, edicion_anual_id, unidad_codigo, tema, orden, titulo, descripcion, estado, puntaje_total, maximo_intentos)
    VALUES
      (1, 'actividad-habilitada', 1, 'unidad-1', 'tema', 1, 'Actividad habilitada', '', 'activa', 200, 10),
      (2, 'actividad-sin-habilitacion', 1, 'unidad-1', 'tema', 2, 'Actividad sin habilitación', '', 'activa', 1, 1),
      (4, 'actividad-deshabilitada', 1, 'unidad-1', 'tema', 3, 'Actividad deshabilitada', '', 'borrador', 1, 1),
      (3, 'actividad-otra-edicion', 2, 'unidad-1', 'tema', 1, 'Actividad de otra edición', '', 'activa', 1, 1);
    INSERT INTO habilitaciones_actividad (id, actividad_id, grupo_id, habilitada) VALUES
      (1, 1, 1, 1), (2, 1, 2, 1), (3, 4, 1, 0);
    INSERT INTO preguntas_actividad
      (id, actividad_id, numero, tipo, enunciado, instrucciones, opciones_json, recursos_json, puntaje)
    VALUES
      (1, 1, 1, 'radio', 'Pregunta uno', '', '["a","b"]', '[]', 149),
      (2, 1, 2, 'radio', 'Pregunta dos', '', '["a","b"]', '[]', 50),
      (3, 1, 3, 'radio', 'Pregunta tres', '', '["a","b"]', '[]', 1);
  `);

  // Alumno Alfa: tres enviados con empates + un borrador + un anulado.
  const alfaA = insertAttempt(database, 1, 1, 3, 1, 1, "alfa-a", 200);
  sendActivity1(database, alfaA, [true, false, false], 149, 75, "2026-01-03T00:00:00Z", "inicial");
  const alfaB = insertAttempt(database, 1, 1, 3, 2, 2, "alfa-b", 200);
  sendActivity1(database, alfaB, [true, false, true], 150, 75, "2026-01-02T00:00:00Z", "inicial");
  const alfaC = insertAttempt(database, 1, 1, 3, 3, 3, "alfa-c", 200);
  sendActivity1(database, alfaC, [true, false, true], 150, 75, "2026-01-01T00:00:00Z", "en_proceso");
  // El índice único de la migración 0010 impide dos borradores simultáneos, por
  // eso el anulado se crea y anula antes de abrir el borrador vivo.
  const alfaAnulado = insertAttempt(database, 1, 1, 3, 4, 4, "alfa-anulado", 200);
  database.exec(`UPDATE intentos_actividad SET estado = 'anulado' WHERE id = ${alfaAnulado}`);
  insertAttempt(database, 1, 1, 3, 5, 4, "alfa-borrador", 200);
  // Intento enviado en otro grupo de la misma actividad: no debe filtrarse al grupo 1.
  const alfaGrupoB = insertAttempt(database, 1, 2, 3, 1, 1, "alfa-grupo-b", 200);
  sendActivity1(database, alfaGrupoB, [true, true, true], 200, 100, "2026-03-01T00:00:00Z", "logrado");

  // Alumno Beta: sólo un borrador.
  insertAttempt(database, 1, 1, 9, 1, 1, "beta-borrador", 200);

  // Alumno Gamma: un único enviado con juicio persistido inconsistente a propósito
  // (100 % con juicio 'inicial') para probar que el endpoint no recalcula.
  const gamma = insertAttempt(database, 1, 1, 10, 1, 1, "gamma-enviado", 200);
  sendActivity1(database, gamma, [true, true, true], 200, 100, "2026-02-01T00:00:00Z", "inicial");

  const propiaToken = await createSession(database, 1);
  const ajenaToken = await createSession(database, 2);
  const alumnoToken = await createSession(database, 3);
  const practicanteToken = await createSession(database, 7);
  database.close();
  database = undefined;

  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const workerConfig = join(persistenceRoot, "wrangler.teacher-results.json");
  writeFileSync(workerConfig, JSON.stringify({
    name: "profemacon-teacher-results-test",
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

  const get = async (groupId, token) => {
    const response = await fetch(`${baseUrl}/api/teacher/groups/${groupId}/results`, {
      headers: token ? { Cookie: `pm_session=${token}` } : undefined,
    });
    return { response, body: await response.json() };
  };

  // Autorización y cabeceras.
  const anonymous = await get(1);
  assert.equal(anonymous.response.status, 401);
  assert.equal(anonymous.response.headers.get("Cache-Control"), "no-store");
  assert.equal(anonymous.body.code, "SESSION_REQUIRED");

  const student = await get(1, alumnoToken);
  assert.equal(student.response.status, 403);
  assert.equal(student.response.headers.get("Cache-Control"), "no-store");
  assert.equal(student.body.code, "TEACHER_ROLE_REQUIRED");

  const practitioner = await get(1, practicanteToken);
  assert.equal(practitioner.response.status, 403);
  assert.equal(practitioner.body.code, "TEACHER_ROLE_REQUIRED");

  const foreignTeacher = await get(1, ajenaToken);
  assert.equal(foreignTeacher.response.status, 403);
  assert.equal(foreignTeacher.body.code, "TEACHER_GROUP_REQUIRED");

  const missingGroup = await get(999999, propiaToken);
  assert.equal(missingGroup.response.status, 404);
  assert.equal(missingGroup.body.code, "GROUP_NOT_FOUND");

  const archivedGroup = await get(5, propiaToken);
  assert.equal(archivedGroup.response.status, 403);
  assert.equal(archivedGroup.body.code, "TEACHER_GROUP_REQUIRED");

  const ok = await get(1, propiaToken);
  assert.equal(ok.response.status, 200);
  assert.equal(ok.response.headers.get("Cache-Control"), "no-store");
  assert.equal(ok.response.headers.get("X-Content-Type-Options"), "nosniff");

  const payload = ok.body;
  assert.equal(payload.group.id, 1);
  assert.equal(payload.group.code, "grupo-a");
  assert.equal(payload.group.editionId, 1);

  // Actividades: sólo de la edición del grupo, sin habilitación incluidas.
  assert.deepEqual(payload.activities.map((activity) => activity.id), [1, 2, 4]);
  const byActivity = new Map(payload.activities.map((activity) => [activity.id, activity]));
  assert.equal(byActivity.get(1).availabilityStatus, "available");
  assert.equal(byActivity.get(1).maxAttempts, 10);
  assert.equal(byActivity.get(1).slug, "actividad-habilitada");
  assert.equal(byActivity.get(1).editorialState, "activa");
  assert.equal(byActivity.get(2).availabilityStatus, "disabled");
  assert.equal(byActivity.get(4).availabilityStatus, "disabled");
  assert.equal(byActivity.get(4).editorialState, "borrador");

  // Estudiantes: activos, con rol estudiante e inscripción activa.
  assert.deepEqual(payload.students.map((student) => student.id), [3, 9, 10]);
  assert.deepEqual(payload.students.map((student) => student.username), ["alumno-alfa", "alumno-beta", "alumno-gamma"]);
  assert.equal(payload.students.find((student) => student.id === 3).displayName, "Alumno Alfa");

  // Matriz completa: 3 estudiantes x 3 actividades.
  assert.equal(payload.cells.length, 9);
  const cellOf = (studentId, activityId) => payload.cells.find((cell) => cell.studentId === studentId && cell.activityId === activityId);
  const keys = payload.cells.map((cell) => `${cell.studentId}:${cell.activityId}`).sort();
  assert.deepEqual(keys, ["10:1", "10:2", "10:4", "3:1", "3:2", "3:4", "9:1", "9:2", "9:4"]);

  // Alfa / actividad 1: mejor intento con desempate por fecha más antigua.
  const alfaCell = cellOf(3, 1);
  assert.equal(alfaCell.attemptsUsed, 4);
  assert.equal(alfaCell.hasDraft, true);
  assert.equal(alfaCell.lastSubmittedAt, "2026-01-03T00:00:00Z");
  assert.deepEqual(alfaCell.best, {
    percentage: 75,
    score: 150,
    total: 200,
    judgment: "en_proceso",
    ordinal: 3,
    submittedAt: "2026-01-01T00:00:00Z",
  });

  // Beta / actividad 1: únicamente borrador.
  const betaCell = cellOf(9, 1);
  assert.equal(betaCell.attemptsUsed, 1);
  assert.equal(betaCell.hasDraft, true);
  assert.equal(betaCell.best, null);
  assert.equal(betaCell.lastSubmittedAt, null);

  // Gamma / actividad 1: juicio persistido tal cual, sin recalcular.
  const gammaCell = cellOf(10, 1);
  assert.equal(gammaCell.attemptsUsed, 1);
  assert.equal(gammaCell.hasDraft, false);
  assert.deepEqual(gammaCell.best, {
    percentage: 100,
    score: 200,
    total: 200,
    judgment: "inicial",
    ordinal: 1,
    submittedAt: "2026-02-01T00:00:00Z",
  });

  // Celdas sin intento: valores explícitos.
  for (const [studentId, activityId] of [[3, 2], [3, 4], [9, 2], [9, 4], [10, 2], [10, 4]]) {
    const cell = cellOf(studentId, activityId);
    assert.equal(cell.best, null, `celda ${studentId}:${activityId} sin mejor intento`);
    assert.equal(cell.attemptsUsed, 0, `celda ${studentId}:${activityId} sin intentos usados`);
    assert.equal(cell.hasDraft, false, `celda ${studentId}:${activityId} sin borrador`);
    assert.equal(cell.lastSubmittedAt, null, `celda ${studentId}:${activityId} sin envíos`);
  }

  // El intento enviado en el grupo B (misma actividad) no debe filtrarse.
  assert.equal(typeof alfaCell.best.score, "number");
  assert.equal(alfaCell.best.score, 150);

  // Privacidad: la respuesta nunca expone datos internos ni umbrales.
  const serialized = JSON.stringify(payload);
  for (const forbidden of [
    "approvalThreshold", "achievementThreshold",
    "clave", "clave_correccion", "respuesta_dada", "respuesta_normalizada",
    "correcta", "modo", "feedback", "devolucion", "submission", "submissionId",
    "respuestas_intento", "preguntas_intento", "snapshot",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `la respuesta no debe incluir "${forbidden}"`);
  }
});