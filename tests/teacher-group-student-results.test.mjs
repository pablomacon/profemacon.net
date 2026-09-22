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

// Cada actividad declara sus propias preguntas: el porcentaje posible depende de
// los puntajes y el cierre exige coherencia entre respuestas, puntaje y total.
const activity1Questions = [
  { id: 1, number: 1, points: 25 },
  { id: 2, number: 2, points: 25 },
  { id: 3, number: 3, points: 25 },
  { id: 4, number: 4, points: 25 },
];

// 76 + 5 + 19 = 100: habilita los porcentajes 81 (76+5) y 76 para verificar la
// evolución descendente real 81 → 76.
const activity7Questions = [
  { id: 5, number: 1, points: 76 },
  { id: 6, number: 2, points: 5 },
  { id: 7, number: 3, points: 19 },
];

const activity8Questions = [
  { id: 8, number: 1, points: 25 },
  { id: 9, number: 2, points: 25 },
  { id: 10, number: 3, points: 25 },
  { id: 11, number: 4, points: 25 },
];

const activity9Questions = [
  { id: 12, number: 1, points: 25 },
  { id: 13, number: 2, points: 25 },
  { id: 14, number: 3, points: 25 },
  { id: 15, number: 4, points: 25 },
];

// Porcentajes alcanzables con cuatro preguntas de 25 puntos.
const flagsForPercentage = {
  0: [false, false, false, false],
  25: [true, false, false, false],
  50: [true, true, false, false],
  75: [true, true, true, false],
  100: [true, true, true, true],
};

// Puntajes alcanzables en la actividad de evolución (76 / 5 / 19).
const flagsForEvolution = {
  0: [false, false, false],
  5: [false, true, false],
  76: [true, false, false],
  81: [true, true, false],
};

function insertAttempt(database, activityId, habilitationId, userId, number, ordinal, submission, total) {
  database.prepare(`
    INSERT INTO intentos_actividad
      (actividad_id, habilitacion_id, usuario_id, numero_intento, ordinal_efectivo, estado,
       puntaje_obtenido, puntaje_total, porcentaje, juicio, devolucion, submission_id)
    VALUES (?1, ?2, ?3, ?4, ?5, 'en_progreso', 0, ?6, 0, 'inicial', '', ?7)
  `).run(activityId, habilitationId, userId, number, ordinal, total, submission);
  return database.prepare("SELECT id FROM intentos_actividad WHERE submission_id = ?1").get(submission).id;
}

// El cierre exige respuestas coherentes para todas las preguntas y un porcentaje
// calculado; el juicio se persiste tal cual recibe, sin recálculo del endpoint.
function sendActivity(database, attemptId, correctFlags, sentAt, judgment, questions) {
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

test("GET /api/teacher/groups/:groupId/students/:studentId/results aplica el contrato C3 con D1 local", async (t) => {
  const projectRoot = process.cwd();
  const persistenceRoot = mkdtempSync(join(tmpdir(), "profemacon-teacher-student-results-"));
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
      (5, 'alumno-pendiente', 'Alumno pendiente', 'activo'),
      (6, 'alumno-suspendido', 'Alumno suspendido', 'suspendido'),
      (7, 'alumno-sin-rol', 'Alumno sin rol', 'activo'),
      (8, 'alumno-otro-grupo', 'Alumno otro grupo', 'activo'),
      (9, 'practicante', 'Practicante', 'activo'),
      (10, 'alumno-borrador', 'Alumno borrador', 'activo');
    INSERT INTO usuario_roles (usuario_id, rol_id) VALUES
      (1, 2), (2, 2), (3, 1), (4, 1), (5, 1), (6, 1), (8, 1), (9, 3), (10, 1);
    INSERT INTO asignaturas (id, codigo, nombre) VALUES (1, 'programacion-prueba', 'Programación de prueba');
    INSERT INTO ediciones_anuales (id, asignatura_id, anio, nombre, estado) VALUES
      (1, 1, 2026, 'Edición de prueba', 'activa'),
      (2, 1, 2027, 'Otra edición', 'activa'),
      (3, 1, 2028, 'Edición sin actividades', 'activa');
    INSERT INTO grupos (id, edicion_anual_id, codigo, nombre, estado) VALUES
      (1, 1, 'grupo-a', 'Grupo A', 'activo'),
      (2, 1, 'grupo-b', 'Grupo B', 'activo'),
      (3, 1, 'grupo-vacio', 'Grupo vacío', 'activo'),
      (4, 3, 'grupo-sin-actividades', 'Grupo sin actividades', 'activo'),
      (5, 1, 'grupo-archivado', 'Grupo archivado', 'archivado');
    INSERT INTO inscripciones (usuario_id, grupo_id, estado) VALUES
      (3, 1, 'activa'), (3, 2, 'activa'),
      (4, 1, 'activa'), (4, 4, 'activa'),
      (5, 1, 'pendiente'),
      (6, 1, 'activa'),
      (7, 1, 'activa'),
      (8, 2, 'activa'),
      (10, 1, 'activa');
    INSERT INTO asignaciones_grupo (usuario_id, grupo_id, tipo, estado) VALUES
      (1, 1, 'docente', 'activa'), (1, 3, 'docente', 'activa'), (1, 4, 'docente', 'activa'), (1, 5, 'docente', 'activa'),
      (2, 2, 'docente', 'activa');
  `);
  // El `orden` de la actividad 9 (2) y de la 2 (9) no coincide con sus ids: la
  // vista debe respetar el orden natural (orden, título) y no el id.
  database.exec(`
    INSERT INTO actividades
      (id, slug, edicion_anual_id, unidad_codigo, tema, orden, titulo, descripcion, estado, puntaje_total, maximo_intentos)
    VALUES
      (1, 'actividad-principal', 1, 'unidad-1', 'tema', 1, 'Actividad principal', '', 'activa', 100, 10),
      (9, 'actividad-inicial', 1, 'unidad-1', 'tema', 2, 'Actividad inicial', '', 'activa', 100, 3),
      (3, 'actividad-deshabilitada', 1, 'unidad-1', 'tema', 3, 'Actividad deshabilitada', '', 'borrador', 100, 1),
      (4, 'actividad-no-abierta', 1, 'unidad-1', 'tema', 4, 'Actividad no abierta', '', 'activa', 100, 1),
      (5, 'actividad-cerrada', 1, 'unidad-1', 'tema', 5, 'Actividad cerrada', '', 'activa', 100, 1),
      (6, 'actividad-archivada', 1, 'unidad-1', 'tema', 6, 'Actividad archivada', '', 'archivada', 100, 1),
      (7, 'actividad-evolucion', 1, 'unidad-1', 'tema', 7, 'Actividad evolución', '', 'activa', 100, 5),
      (8, 'actividad-borrador', 1, 'unidad-1', 'tema', 8, 'Actividad borrador', '', 'activa', 100, 2),
      (2, 'actividad-sin-habilitacion', 1, 'unidad-1', 'tema', 9, 'Actividad sin habilitación', '', 'activa', 100, 1),
      (10, 'actividad-otra-edicion', 2, 'unidad-1', 'tema', 1, 'Actividad de otra edición', '', 'activa', 100, 1);
    INSERT INTO habilitaciones_actividad (id, actividad_id, grupo_id, habilitada, disponible_desde, disponible_hasta) VALUES
      (1, 1, 1, 1, NULL, NULL),
      (2, 1, 2, 1, NULL, NULL),
      (3, 3, 1, 0, NULL, NULL),
      (4, 4, 1, 1, datetime('now', '+7 days'), NULL),
      (5, 5, 1, 1, NULL, datetime('now', '-7 days')),
      (6, 7, 1, 1, NULL, NULL),
      (7, 8, 1, 1, NULL, NULL),
      (8, 9, 1, 1, NULL, NULL);
    INSERT INTO preguntas_actividad
      (id, actividad_id, numero, tipo, enunciado, instrucciones, opciones_json, recursos_json, puntaje)
    VALUES
      (1, 1, 1, 'radio', 'Pregunta uno', '', '["a","b"]', '[]', 25),
      (2, 1, 2, 'radio', 'Pregunta dos', '', '["a","b"]', '[]', 25),
      (3, 1, 3, 'radio', 'Pregunta tres', '', '["a","b"]', '[]', 25),
      (4, 1, 4, 'radio', 'Pregunta cuatro', '', '["a","b"]', '[]', 25),
      (5, 7, 1, 'radio', 'Pregunta uno', '', '["a","b"]', '[]', 76),
      (6, 7, 2, 'radio', 'Pregunta dos', '', '["a","b"]', '[]', 5),
      (7, 7, 3, 'radio', 'Pregunta tres', '', '["a","b"]', '[]', 19),
      (8, 8, 1, 'radio', 'Pregunta uno', '', '["a","b"]', '[]', 25),
      (9, 8, 2, 'radio', 'Pregunta dos', '', '["a","b"]', '[]', 25),
      (10, 8, 3, 'radio', 'Pregunta tres', '', '["a","b"]', '[]', 25),
      (11, 8, 4, 'radio', 'Pregunta cuatro', '', '["a","b"]', '[]', 25),
      (12, 9, 1, 'radio', 'Pregunta uno', '', '["a","b"]', '[]', 25),
      (13, 9, 2, 'radio', 'Pregunta dos', '', '["a","b"]', '[]', 25),
      (14, 9, 3, 'radio', 'Pregunta tres', '', '["a","b"]', '[]', 25),
      (15, 9, 4, 'radio', 'Pregunta cuatro', '', '["a","b"]', '[]', 25);
  `);

  // Alfa (3) en la actividad 1: tres enviados (50 % el 01-01, 75 % el 01-05 y
  // 25 % el 01-10), un intento anulado y un borrador vivo. El mejor es 75 % y su
  // juicio persistido es `en_proceso` (no se recalcula).
  const alfa1 = insertAttempt(database, 1, 1, 3, 1, 1, "alfa-1", 100);
  sendActivity(database, alfa1, flagsForPercentage[50], "2026-01-01T00:00:00Z", "en_proceso", activity1Questions);
  const alfa2 = insertAttempt(database, 1, 1, 3, 2, 2, "alfa-2", 100);
  sendActivity(database, alfa2, flagsForPercentage[75], "2026-01-05T00:00:00Z", "en_proceso", activity1Questions);
  const alfa3 = insertAttempt(database, 1, 1, 3, 3, 3, "alfa-3", 100);
  sendActivity(database, alfa3, flagsForPercentage[25], "2026-01-10T00:00:00Z", "inicial", activity1Questions);
  // El índice único de la migración 0010 impide dos borradores simultáneos: el
  // anulado se crea y anula antes de abrir el borrador vivo.
  const alfaAnulado = insertAttempt(database, 1, 1, 3, 4, 4, "alfa-anulado", 100);
  database.exec(`UPDATE intentos_actividad SET estado = 'anulado' WHERE id = ${alfaAnulado}`);
  insertAttempt(database, 1, 1, 3, 5, 4, "alfa-borrador", 100);

  // Alfa (3) en la actividad 7: secuencia descendente real 81 → 76.
  const alfa7a = insertAttempt(database, 7, 6, 3, 1, 1, "alfa-7a", 100);
  sendActivity(database, alfa7a, flagsForEvolution[81], "2026-06-01T00:00:00Z", "logrado", activity7Questions);
  const alfa7b = insertAttempt(database, 7, 6, 3, 2, 2, "alfa-7b", 100);
  sendActivity(database, alfa7b, flagsForEvolution[76], "2026-06-02T00:00:00Z", "en_proceso", activity7Questions);

  // Alfa (3) en la actividad 8: sólo un borrador.
  insertAttempt(database, 8, 7, 3, 1, 1, "alfa-8-borrador", 100);

  // Alfa (3) en la actividad 9: un enviado de 0 % con juicio persistido `inicial`.
  const alfa9 = insertAttempt(database, 9, 8, 3, 1, 1, "alfa-9", 100);
  sendActivity(database, alfa9, flagsForPercentage[0], "2026-07-01T00:00:00Z", "inicial", activity9Questions);

  // El mismo estudiante envía la misma actividad en otro grupo: no debe
  // contaminar el grupo 1 (ni el mejor, ni los intentos usados, ni la secuencia).
  const alfaGrupoB = insertAttempt(database, 1, 2, 3, 1, 1, "alfa-grupo-b", 100);
  sendActivity(database, alfaGrupoB, flagsForPercentage[100], "2026-03-01T00:00:00Z", "logrado", activity1Questions);

  // Beta (4): cuatro enviados con porcentajes 0, 5, 50 y 75 → promedio 32.5 y
  // mediana 27.5 (cantidad par con decimales).
  const beta1 = insertAttempt(database, 1, 1, 4, 1, 1, "beta-1", 100);
  sendActivity(database, beta1, flagsForPercentage[0], "2026-01-02T00:00:00Z", "inicial", activity1Questions);
  const beta7 = insertAttempt(database, 7, 6, 4, 1, 1, "beta-7", 100);
  sendActivity(database, beta7, flagsForEvolution[5], "2026-01-03T00:00:00Z", "inicial", activity7Questions);
  const beta8 = insertAttempt(database, 8, 7, 4, 1, 1, "beta-8", 100);
  sendActivity(database, beta8, flagsForPercentage[50], "2026-01-04T00:00:00Z", "en_proceso", activity8Questions);
  const beta9 = insertAttempt(database, 9, 8, 4, 1, 1, "beta-9", 100);
  sendActivity(database, beta9, flagsForPercentage[75], "2026-01-05T00:00:00Z", "logrado", activity9Questions);

  // Alumno 10: un único borrador en toda la cursada → promedio y mediana nulos.
  insertAttempt(database, 8, 7, 10, 1, 1, "borrador-10", 100);

  const propiaToken = await createSession(database, 1);
  const ajenaToken = await createSession(database, 2);
  const alumnoToken = await createSession(database, 3);
  const practicanteToken = await createSession(database, 9);
  database.close();
  database = undefined;

  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const workerConfig = join(persistenceRoot, "wrangler.teacher-student-results.json");
  writeFileSync(workerConfig, JSON.stringify({
    name: "profemacon-teacher-student-results-test",
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

  const get = async (groupId, studentId, token) => {
    const response = await fetch(`${baseUrl}/api/teacher/groups/${groupId}/students/${studentId}/results`, {
      headers: token ? { Cookie: `pm_session=${token}` } : undefined,
    });
    return { response, body: await response.json() };
  };

  // Autorización: sesión, rol docente, alcance del grupo y membresía del estudiante.
  const anonymous = await get(1, 3);
  assert.equal(anonymous.response.status, 401);
  assert.equal(anonymous.body.code, "SESSION_REQUIRED");

  const student = await get(1, 3, alumnoToken);
  assert.equal(student.response.status, 403);
  assert.equal(student.body.code, "TEACHER_ROLE_REQUIRED");

  const practitioner = await get(1, 3, practicanteToken);
  assert.equal(practitioner.response.status, 403);
  assert.equal(practitioner.body.code, "TEACHER_ROLE_REQUIRED");

  const foreignTeacher = await get(1, 3, ajenaToken);
  assert.equal(foreignTeacher.response.status, 403);
  assert.equal(foreignTeacher.body.code, "TEACHER_GROUP_REQUIRED");

  const foreignGroup = await get(2, 3, propiaToken);
  assert.equal(foreignGroup.response.status, 403);
  assert.equal(foreignGroup.body.code, "TEACHER_GROUP_REQUIRED");

  const missingGroup = await get(999999, 3, propiaToken);
  assert.equal(missingGroup.response.status, 404);
  assert.equal(missingGroup.body.code, "GROUP_NOT_FOUND");

  const archivedGroup = await get(5, 3, propiaToken);
  assert.equal(archivedGroup.response.status, 403);
  assert.equal(archivedGroup.body.code, "TEACHER_GROUP_REQUIRED");

  const missingStudent = await get(1, 999999, propiaToken);
  assert.equal(missingStudent.response.status, 404);
  assert.equal(missingStudent.body.code, "STUDENT_NOT_FOUND");

  // Estudiante existente pero fuera del grupo: 403 y sin filtrar su identidad.
  const otherGroupStudent = await get(1, 8, propiaToken);
  assert.equal(otherGroupStudent.response.status, 403);
  assert.equal(otherGroupStudent.body.code, "TEACHER_GROUP_REQUIRED");
  assert.deepEqual(Object.keys(otherGroupStudent.body).sort(), ["code", "error"]);
  assert.equal(JSON.stringify(otherGroupStudent.body).includes("Alumno otro grupo"), false);

  const pendingEnrollment = await get(1, 5, propiaToken);
  assert.equal(pendingEnrollment.response.status, 403);
  assert.equal(pendingEnrollment.body.code, "TEACHER_GROUP_REQUIRED");

  const suspendedUser = await get(1, 6, propiaToken);
  assert.equal(suspendedUser.response.status, 403);
  assert.equal(suspendedUser.body.code, "TEACHER_GROUP_REQUIRED");

  const withoutStudentRole = await get(1, 7, propiaToken);
  assert.equal(withoutStudentRole.response.status, 403);
  assert.equal(withoutStudentRole.body.code, "TEACHER_GROUP_REQUIRED");

  // Una cuenta docente tampoco ingresa por la ruta de estudiante.
  const teacherAsStudent = await get(1, 1, propiaToken);
  assert.equal(teacherAsStudent.response.status, 403);
  assert.equal(teacherAsStudent.body.code, "TEACHER_GROUP_REQUIRED");

  // Estudiante válido del grupo: contrato completo.
  const ok = await get(1, 3, propiaToken);
  assert.equal(ok.response.status, 200);
  assert.equal(ok.response.headers.get("Cache-Control"), "no-store");
  assert.equal(ok.response.headers.get("X-Content-Type-Options"), "nosniff");
  const payload = ok.body;

  assert.equal(payload.group.id, 1);
  assert.equal(payload.group.code, "grupo-a");
  assert.equal(payload.group.subjectName, "Programación de prueba");
  assert.equal(payload.group.editionId, 1);
  assert.equal(payload.group.year, 2026);
  assert.deepEqual(payload.student, { id: 3, displayName: "Alumno Alfa", username: "alumno-alfa" });

  // Universo: todas las actividades de la edición del grupo, en orden natural
  // (orden, título) y nunca por id. La actividad de otra edición no aparece.
  assert.deepEqual(payload.activities.map((activity) => activity.activityId), [1, 9, 3, 4, 5, 6, 7, 8, 2]);
  assert.equal(payload.summary.totalActivities, 9);
  assert.deepEqual(payload.activities.map((activity) => activity.unitCode), Array(9).fill("unidad-1"));

  const byActivity = new Map(payload.activities.map((activity) => [activity.activityId, activity]));
  assert.equal(byActivity.has(10), false);
  assert.equal(byActivity.get(1).availabilityStatus, "available");
  assert.equal(byActivity.get(1).maxAttempts, 10);
  assert.equal(byActivity.get(1).slug, "actividad-principal");
  assert.equal(byActivity.get(1).title, "Actividad principal");
  assert.equal(byActivity.get(1).editorialState, "activa");
  assert.equal(byActivity.get(2).availabilityStatus, "disabled");
  assert.equal(byActivity.get(3).availabilityStatus, "disabled");
  assert.equal(byActivity.get(3).editorialState, "borrador");
  assert.equal(byActivity.get(4).availabilityStatus, "not_open");
  assert.equal(byActivity.get(5).availabilityStatus, "closed");
  assert.equal(byActivity.get(6).availabilityStatus, "disabled");
  assert.equal(byActivity.get(6).editorialState, "archivada");
  assert.equal(byActivity.get(7).availabilityStatus, "available");
  assert.equal(byActivity.get(7).maxAttempts, 5);
  assert.equal(byActivity.get(8).availabilityStatus, "available");
  assert.equal(byActivity.get(9).availabilityStatus, "available");

  // Actividad 1: tres enviados, un anulado y un borrador vivo. attemptsUsed suma
  // enviados y borrador y excluye el anulado; el mejor es 75 % con el juicio
  // persistido y su ordinal corresponde al segundo envío.
  const principal = byActivity.get(1);
  assert.equal(principal.attemptsUsed, 4);
  assert.equal(principal.hasDraft, true);
  assert.equal(principal.lastSubmittedAt, "2026-01-10T00:00:00Z");
  assert.deepEqual(principal.best, {
    percentage: 75, score: 75, total: 100, judgment: "en_proceso", ordinal: 2, submittedAt: "2026-01-05T00:00:00Z",
  });
  assert.deepEqual(principal.submittedAttempts, [
    { ordinal: 1, percentage: 50, judgment: "en_proceso", submittedAt: "2026-01-01T00:00:00Z" },
    { ordinal: 2, percentage: 75, judgment: "en_proceso", submittedAt: "2026-01-05T00:00:00Z" },
    { ordinal: 3, percentage: 25, judgment: "inicial", submittedAt: "2026-01-10T00:00:00Z" },
  ]);

  // Actividad 7: secuencia descendente real 81 → 76, preservada en ese orden.
  const evolution = byActivity.get(7);
  assert.equal(evolution.attemptsUsed, 2);
  assert.equal(evolution.hasDraft, false);
  assert.equal(evolution.lastSubmittedAt, "2026-06-02T00:00:00Z");
  assert.deepEqual(evolution.best, {
    percentage: 81, score: 81, total: 100, judgment: "logrado", ordinal: 1, submittedAt: "2026-06-01T00:00:00Z",
  });
  // Actividad 9: 0 % enviado con juicio persistido `inicial` (no se recalcula).
  const persisted = byActivity.get(9);
  assert.equal(persisted.attemptsUsed, 1);
  assert.deepEqual(persisted.best, {
    percentage: 0, score: 0, total: 100, judgment: "inicial", ordinal: 1, submittedAt: "2026-07-01T00:00:00Z",
  });
  assert.deepEqual(persisted.submittedAttempts, [
    { ordinal: 1, percentage: 0, judgment: "inicial", submittedAt: "2026-07-01T00:00:00Z" },
  ]);

  // Actividad 8: sólo borrador: no compite como mejor y no entra en la secuencia.
  const draftOnly = byActivity.get(8);
  assert.equal(draftOnly.best, null);
  assert.equal(draftOnly.hasDraft, true);
  assert.equal(draftOnly.attemptsUsed, 1);
  assert.equal(draftOnly.lastSubmittedAt, null);
  assert.deepEqual(draftOnly.submittedAttempts, []);

  // Actividades sin intentos: valores explícitos y sin secuencia.
  for (const activityId of [2, 3, 4, 5, 6]) {
    const activity = byActivity.get(activityId);
    assert.equal(activity.best, null, `actividad ${activityId} sin mejor intento`);
    assert.equal(activity.attemptsUsed, 0, `actividad ${activityId} sin intentos usados`);
    assert.equal(activity.hasDraft, false, `actividad ${activityId} sin borrador`);
    assert.equal(activity.lastSubmittedAt, null);
    assert.deepEqual(activity.submittedAttempts, []);
  }

  // Aislamiento: el envío de 100 % del mismo estudiante en el grupo B no
  // contamina el grupo A.
  assert.equal(principal.best.percentage, 75);
  assert.equal(principal.submittedAttempts.some((attempt) => attempt.percentage === 100), false);

  // Resumen de Alfa: categorías mutuamente excluyentes que suman totalActivities.
  // El borrador de la actividad 1 cuenta por el juicio del mejor (en_proceso).
  assert.deepEqual(payload.summary, {
    totalActivities: 9,
    withoutAttempt: 5,
    inProgress: 1,
    inicial: 1,
    en_proceso: 1,
    logrado: 1,
    averageBestPercentage: 52,
    medianBestPercentage: 75,
  });
  assert.equal(
    payload.summary.withoutAttempt + payload.summary.inProgress + payload.summary.inicial
      + payload.summary.en_proceso + payload.summary.logrado,
    payload.summary.totalActivities,
  );

  // Beta: cuatro enviados (0, 5, 50 y 75 %) → promedio 32.5 y mediana 27.5, con
  // redondeo a un decimal en ambos casos.
  const beta = await get(1, 4, propiaToken);
  assert.equal(beta.response.status, 200);
  assert.deepEqual(beta.body.summary, {
    totalActivities: 9,
    withoutAttempt: 5,
    inProgress: 0,
    inicial: 2,
    en_proceso: 1,
    logrado: 1,
    averageBestPercentage: 32.5,
    medianBestPercentage: 27.5,
  });
  const betaByActivity = new Map(beta.body.activities.map((activity) => [activity.activityId, activity]));
  assert.equal(betaByActivity.get(1).best.percentage, 0);
  assert.equal(betaByActivity.get(1).best.judgment, "inicial");
  assert.equal(betaByActivity.get(7).best.percentage, 5);
  assert.equal(betaByActivity.get(8).best.percentage, 50);
  assert.equal(betaByActivity.get(9).best.percentage, 75);
  assert.equal(betaByActivity.get(7).submittedAttempts.length, 1);

  // Alumno 10: un único borrador en toda la cursada → promedio y mediana nulos.
  const draftOnlyStudent = await get(1, 10, propiaToken);
  assert.equal(draftOnlyStudent.response.status, 200);
  assert.deepEqual(draftOnlyStudent.body.summary, {
    totalActivities: 9,
    withoutAttempt: 8,
    inProgress: 1,
    inicial: 0,
    en_proceso: 0,
    logrado: 0,
    averageBestPercentage: null,
    medianBestPercentage: null,
  });

  // Grupo cuya edición no tiene actividades: resumen en cero y lista vacía.
  const emptyEdition = await get(4, 4, propiaToken);
  assert.equal(emptyEdition.response.status, 200);
  assert.equal(emptyEdition.body.student.id, 4);
  assert.deepEqual(emptyEdition.body.activities, []);
  assert.deepEqual(emptyEdition.body.summary, {
    totalActivities: 0,
    withoutAttempt: 0,
    inProgress: 0,
    inicial: 0,
    en_proceso: 0,
    logrado: 0,
    averageBestPercentage: null,
    medianBestPercentage: null,
  });

  // Privacidad: la respuesta nunca expone respuestas, claves, snapshots,
  // correcciones, documentos, identificadores internos ni umbrales.
  const serialized = JSON.stringify(payload);
  for (const forbidden of [
    "approvalThreshold", "achievementThreshold", "umbral",
    "clave", "clave_correccion", "respuesta_dada", "respuesta_normalizada",
    "correcta", "modo", "feedback", "devolucion", "submission", "submissionId",
    "respuestas_intento", "preguntas_intento", "snapshot", "documento", "archivo",
    "habilitacion_id", "puntaje_obtenido", "usuario_id",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `la respuesta no debe incluir "${forbidden}"`);
  }

  // La lista de actividades nunca expone los campos privados del intento.
  for (const activity of payload.activities) {
    assert.deepEqual(Object.keys(activity).sort(), [
      "activityId", "attemptsUsed", "availabilityStatus", "best", "editorialState",
      "hasDraft", "lastSubmittedAt", "maxAttempts", "slug", "submittedAttempts", "title", "unitCode",
    ]);
    assert.equal(activity.submittedAttempts.every((attempt) => Object.keys(attempt).sort().join() === "judgment,ordinal,percentage,submittedAt"), true);
  }
});
