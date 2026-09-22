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

// Actividad principal: una pregunta de cada tipo revisable. Las opciones usan
// `{ valor, texto }` para comprobar que el docente recibe textos visibles y no los
// valores internos, y los puntajes suman 100.
const radioQuestion = { id: 1, number: 1, type: "radio", points: 30 };
const checkboxQuestion = { id: 2, number: 2, type: "checkbox", points: 40 };
const textQuestion = { id: 3, number: 3, type: "text", points: 30 };

// Actividad de empates: total 1000 permite dos porcentajes iguales (50 %) con
// puntajes distintos, para ejercitar el desempate por puntaje.
const tieHighQuestion = { id: 7, number: 1, type: "radio", points: 504 };
const tieLowQuestion = { id: 8, number: 2, type: "radio", points: 496 };

// Actividad con un tipo todavía sin revisión pública.
const sortableQuestion = { id: 6, number: 1, type: "ordenar", points: 10 };

function insertAttempt(database, activityId, habilitationId, userId, number, ordinal, submission, total) {
  database.prepare(`
    INSERT INTO intentos_actividad
      (actividad_id, habilitacion_id, usuario_id, numero_intento, ordinal_efectivo, estado,
       puntaje_obtenido, puntaje_total, porcentaje, juicio, devolucion, submission_id)
    VALUES (?1, ?2, ?3, ?4, ?5, 'en_progreso', 0, ?6, 0, 'inicial', '', ?7)
  `).run(activityId, habilitationId, userId, number, ordinal, total, submission);
  return database.prepare("SELECT id FROM intentos_actividad WHERE submission_id = ?1").get(submission).id;
}

// Respuesta parcial de un borrador o de un intento que se anulará: es evidencia
// no entregada y nunca debe aparecer en la respuesta docente.
function savePartialAnswer(database, attemptId, question, value) {
  database.prepare(`
    INSERT INTO respuestas_intento_actividad
      (intento_id, pregunta_id, numero_pregunta, tipo_pregunta, enunciado_snapshot,
       respuesta_dada_json, respuesta_normalizada_json, correcta, puntaje_obtenido)
    VALUES (?1, ?2, ?3, ?4, 'Respuesta parcial', ?5, 'null', 0, 0)
  `).run(attemptId, question.id, question.number, question.type, JSON.stringify(value));
}

// Cierra un intento con resultados persistidos exactos. Cada respuesta debe ser
// coherente con su pregunta (acierto = puntaje completo, error = 0), el total
// debe coincidir con la suma de puntajes vigentes y el porcentaje con el redondeo
// que exige D1. El juicio se persiste tal cual se recibe: nunca se recalcula.
function closeAttempt(database, attemptId, answers, sentAt, judgment) {
  for (const answer of answers) {
    database.prepare(`
      INSERT INTO respuestas_intento_actividad
        (intento_id, pregunta_id, numero_pregunta, tipo_pregunta, enunciado_snapshot,
         respuesta_dada_json, respuesta_normalizada_json, correcta, puntaje_obtenido)
      VALUES (?1, ?2, ?3, ?4, 'Pregunta de prueba', ?5, 'null', ?6, ?7)
    `).run(
      attemptId,
      answer.question.id,
      answer.question.number,
      answer.question.type,
      JSON.stringify(answer.value === undefined ? null : answer.value),
      answer.correct ? 1 : 0,
      answer.correct ? answer.question.points : 0,
    );
  }
  const score = answers.reduce((total, answer) => total + (answer.correct ? answer.question.points : 0), 0);
  const total = answers.reduce((sum, answer) => sum + answer.question.points, 0);
  const percentage = Math.round((100 * score) / total);
  database.prepare(`
    UPDATE intentos_actividad
    SET puntaje_obtenido = ?1, puntaje_total = ?2, porcentaje = ?3, enviado_en = ?4, estado = 'enviado', juicio = ?5
    WHERE id = ?6
  `).run(score, total, percentage, sentAt, judgment, attemptId);
  return { score, total, percentage };
}

test("GET /api/teacher/groups/:groupId/students/:studentId/activities/:activityId/attempts aplica el contrato C4 con D1 local", async (t) => {
  const projectRoot = process.cwd();
  const persistenceRoot = mkdtempSync(join(tmpdir(), "profemacon-teacher-student-attempts-"));
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
      (9, 'practicante', 'Practicante', 'activo');
    INSERT INTO usuario_roles (usuario_id, rol_id) VALUES
      (1, 2), (2, 2), (3, 1), (4, 1), (5, 1), (6, 1), (8, 1), (9, 3);
    INSERT INTO asignaturas (id, codigo, nombre) VALUES (1, 'programacion-prueba', 'Programación de prueba');
    INSERT INTO ediciones_anuales (id, asignatura_id, anio, nombre, estado) VALUES
      (1, 1, 2026, 'Edición de prueba', 'activa'),
      (2, 1, 2027, 'Otra edición', 'activa');
    INSERT INTO grupos (id, edicion_anual_id, codigo, nombre, estado) VALUES
      (1, 1, 'grupo-a', 'Grupo A', 'activo'),
      (2, 1, 'grupo-b', 'Grupo B', 'activo'),
      (5, 1, 'grupo-archivado', 'Grupo archivado', 'archivado');
    INSERT INTO inscripciones (usuario_id, grupo_id, estado) VALUES
      (3, 1, 'activa'), (3, 2, 'activa'), (4, 1, 'activa'),
      (5, 1, 'pendiente'), (6, 1, 'activa'), (7, 1, 'activa'), (8, 2, 'activa');
    INSERT INTO asignaciones_grupo (usuario_id, grupo_id, tipo, estado) VALUES
      (1, 1, 'docente', 'activa'), (1, 5, 'docente', 'activa'), (2, 2, 'docente', 'activa');
  `);
  database.exec(`
    INSERT INTO actividades
      (id, slug, edicion_anual_id, unidad_codigo, tema, orden, titulo, descripcion, estado, puntaje_total, maximo_intentos)
    VALUES
      (1, 'actividad-principal', 1, 'unidad-1', 'tema', 1, 'Actividad principal', '', 'activa', 100, 5),
      (2, 'actividad-sin-intentos', 1, 'unidad-1', 'tema', 2, 'Actividad sin intentos', '', 'activa', 10, 1),
      (4, 'actividad-no-revisable', 1, 'unidad-1', 'tema', 3, 'Actividad no revisable', '', 'activa', 10, 2),
      (5, 'actividad-empates', 1, 'unidad-1', 'tema', 4, 'Actividad empates', '', 'activa', 1000, 3),
      (3, 'actividad-otra-edicion', 2, 'unidad-1', 'tema', 1, 'Actividad de otra edición', '', 'activa', 10, 1);
    INSERT INTO habilitaciones_actividad (id, actividad_id, grupo_id, habilitada, disponible_desde, disponible_hasta) VALUES
      (1, 1, 1, 1, NULL, NULL),
      (2, 2, 1, 1, NULL, NULL),
      (3, 4, 1, 1, NULL, NULL),
      (4, 5, 1, 1, NULL, NULL),
      (5, 1, 2, 1, NULL, NULL);
    INSERT INTO preguntas_actividad
      (id, actividad_id, numero, tipo, enunciado, instrucciones, opciones_json, recursos_json, puntaje, explicacion_revision_final, clave_correccion_json)
    VALUES
      (1, 1, 1, 'radio', 'Pregunta radio', '', '[{"valor":"r-a","texto":"Opción A"},{"valor":"r-b","texto":"Opción B"},{"valor":"r-c","texto":"Opción C"}]', '[]', 30, 'Explicación uno', '{"modo":"opcion","correctas":["r-b"]}'),
      (2, 1, 2, 'checkbox', 'Pregunta checkbox', '', '[{"valor":"c-a","texto":"Alternativa A"},{"valor":"c-b","texto":"Alternativa B"},{"valor":"c-c","texto":"Alternativa C"}]', '[]', 40, NULL, '{"modo":"seleccion-exacta","correctas":["c-a","c-c"]}'),
      (3, 1, 3, 'text', 'Pregunta texto', '', '[]', '[]', 30, 'Explicación tres', '{"modo":"texto-exacto","aceptadas":["Java","java"]}'),
      (4, 2, 1, 'radio', 'Pregunta sin intentos', '', '["a"]', '[]', 10, NULL, '{"modo":"opcion","correctas":["a"]}'),
      (5, 3, 1, 'radio', 'Pregunta de otra edición', '', '["a"]', '[]', 10, NULL, '{"modo":"opcion","correctas":["a"]}'),
      (6, 4, 1, 'ordenar', 'Pregunta de ordenamiento', '', '["a","b"]', '[]', 10, NULL, '{"modo":"orden-exacto","orden":["b","a"]}'),
      (7, 5, 1, 'radio', 'Pregunta empate alta', '', '[{"valor":"p-a","texto":"Primera"},{"valor":"p-b","texto":"Segunda"}]', '[]', 504, NULL, '{"modo":"opcion","correctas":["p-a"]}'),
      (8, 5, 2, 'radio', 'Pregunta empate baja', '', '[{"valor":"q-a","texto":"Primera"},{"valor":"q-b","texto":"Segunda"}]', '[]', 496, NULL, '{"modo":"opcion","correctas":["q-a"]}');
  `);

  // Alfa (3) en la actividad principal (habilitación 1, máximo 5):
  //  - intento 1: 30 % (radio correcta, checkbox incompleta en orden inverso y
  //    texto sin responder)
  //  - intento 2: 70 % con juicio persistido `inicial` y misma fecha que el 1
  //  - intento 3: 70 % con juicio persistido `logrado`, entregado más tarde
  //  - intento 4: anulado, con una respuesta parcial que nunca debe exponerse
  //  - intento 5: borrador vivo (reutiliza el ordinal liberado), también parcial
  const alfaFirst = insertAttempt(database, 1, 1, 3, 1, 1, "alfa-1", 100);
  closeAttempt(database, alfaFirst, [
    { question: radioQuestion, correct: true, value: "r-b" },
    { question: checkboxQuestion, correct: false, value: ["c-c", "c-b"] },
    { question: textQuestion, correct: false },
  ], "2026-01-10T10:00:00Z", "inicial");

  const alfaSecond = insertAttempt(database, 1, 1, 3, 2, 2, "alfa-2", 100);
  closeAttempt(database, alfaSecond, [
    { question: radioQuestion, correct: false, value: "r-a" },
    { question: checkboxQuestion, correct: true, value: ["c-a", "c-c"] },
    { question: textQuestion, correct: true, value: "Java" },
  ], "2026-01-10T10:00:00Z", "inicial");

  const alfaThird = insertAttempt(database, 1, 1, 3, 3, 3, "alfa-3", 100);
  closeAttempt(database, alfaThird, [
    { question: radioQuestion, correct: true, value: "r-b" },
    { question: checkboxQuestion, correct: true, value: ["c-a", "c-c"] },
    { question: textQuestion, correct: false, value: "javascript" },
  ], "2026-02-01T10:00:00Z", "logrado");

  const alfaAnnulled = insertAttempt(database, 1, 1, 3, 4, 4, "alfa-anulado", 100);
  savePartialAnswer(database, alfaAnnulled, radioQuestion, "respuesta-anulada-privada");
  database.exec(`UPDATE intentos_actividad SET estado = 'anulado' WHERE id = ${alfaAnnulled}`);

  const alfaDraft = insertAttempt(database, 1, 1, 3, 5, 4, "alfa-borrador", 100);
  savePartialAnswer(database, alfaDraft, textQuestion, "borrador-privado");

  // Beta (4) tiene un envío perfecto en la misma actividad y habilitación: no debe
  // aparecer en el detalle de Alfa.
  const betaOnly = insertAttempt(database, 1, 1, 4, 1, 1, "beta-1", 100);
  closeAttempt(database, betaOnly, [
    { question: radioQuestion, correct: true, value: "r-b" },
    { question: checkboxQuestion, correct: true, value: ["c-a", "c-c"] },
    { question: textQuestion, correct: true, value: "Java" },
  ], "2026-01-05T10:00:00Z", "logrado");

  // El mismo estudiante entregó la misma actividad en otro grupo: tampoco debe
  // filtrarse al consultar el grupo autorizado.
  const alfaOtherGroup = insertAttempt(database, 1, 5, 3, 1, 1, "alfa-grupo-b", 100);
  closeAttempt(database, alfaOtherGroup, [
    { question: radioQuestion, correct: true, value: "r-b" },
    { question: checkboxQuestion, correct: true, value: ["c-a", "c-c"] },
    { question: textQuestion, correct: true, value: "Java" },
  ], "2026-04-01T10:00:00Z", "logrado");

  // Actividad de empates: tres enviados con 50 %. Gana el de mayor puntaje y,
  // entre los empatados, el de fecha más antigua y después el de id menor. El que
  // se entregó antes pierde porque su puntaje es menor.
  const tieWinner = insertAttempt(database, 5, 4, 3, 1, 1, "alfa-empate-a", 1000);
  closeAttempt(database, tieWinner, [
    { question: tieHighQuestion, correct: true, value: "p-a" },
    { question: tieLowQuestion, correct: false, value: "q-b" },
  ], "2026-03-05T10:00:00Z", "logrado");

  const tieLoser = insertAttempt(database, 5, 4, 3, 2, 2, "alfa-empate-b", 1000);
  closeAttempt(database, tieLoser, [
    { question: tieHighQuestion, correct: true, value: "p-a" },
    { question: tieLowQuestion, correct: false, value: "q-b" },
  ], "2026-03-05T10:00:00Z", "en_proceso");

  const tieEarlier = insertAttempt(database, 5, 4, 3, 3, 3, "alfa-empate-c", 1000);
  closeAttempt(database, tieEarlier, [
    { question: tieHighQuestion, correct: false, value: "p-b" },
    { question: tieLowQuestion, correct: true, value: "q-a" },
  ], "2026-03-01T10:00:00Z", "inicial");

  // Actividad con un tipo todavía sin revisión pública.
  const sortableAttempt = insertAttempt(database, 4, 3, 3, 1, 1, "alfa-ordenar", 10);
  closeAttempt(database, sortableAttempt, [
    { question: sortableQuestion, correct: true, value: ["b", "a"] },
  ], "2026-05-01T10:00:00Z", "logrado");

  // La actividad se edita después de las entregas: el detalle docente debe seguir
  // mostrando exclusivamente el snapshot de cada intento y nunca la versión actual.
  database.exec(`
    UPDATE preguntas_actividad SET
      enunciado = 'Enunciado editado',
      opciones_json = '[{"valor":"r-z","texto":"Opción Z"}]',
      puntaje = 1,
      explicacion_revision_final = 'Explicación editada',
      clave_correccion_json = '{"modo":"opcion","correctas":["r-z"]}'
    WHERE id = 1;
    UPDATE preguntas_actividad SET
      enunciado = 'Enunciado editado',
      clave_correccion_json = '{"modo":"seleccion-exacta","correctas":["c-z"]}'
    WHERE id = 2;
    UPDATE preguntas_actividad SET
      enunciado = 'Enunciado editado',
      clave_correccion_json = '{"modo":"texto-exacto","aceptadas":["clave-editada"]}'
    WHERE id = 3;
    UPDATE preguntas_actividad SET
      enunciado = 'Enunciado editado',
      clave_correccion_json = '{"modo":"orden-exacto","orden":["z"]}'
    WHERE id = 6;
  `);

  const propiaToken = await createSession(database, 1);
  const ajenaToken = await createSession(database, 2);
  const alumnoToken = await createSession(database, 3);
  const practicanteToken = await createSession(database, 9);
  database.close();
  database = undefined;

  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const workerConfig = join(persistenceRoot, "wrangler.teacher-student-attempts.json");
  writeFileSync(workerConfig, JSON.stringify({
    name: "profemacon-teacher-student-attempts-test",
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

  const get = async (groupId, studentId, activityId, token) => {
    const response = await fetch(`${baseUrl}/api/teacher/groups/${groupId}/students/${studentId}/activities/${activityId}/attempts`, {
      headers: token ? { Cookie: `pm_session=${token}` } : undefined,
    });
    return { response, body: await response.json() };
  };

  // Autorización: sesión, rol docente, alcance del grupo, membresía y actividad.
  const anonymous = await get(1, 3, 1);
  assert.equal(anonymous.response.status, 401);
  assert.equal(anonymous.body.code, "SESSION_REQUIRED");

  const student = await get(1, 3, 1, alumnoToken);
  assert.equal(student.response.status, 403);
  assert.equal(student.body.code, "TEACHER_ROLE_REQUIRED");

  const practitioner = await get(1, 3, 1, practicanteToken);
  assert.equal(practitioner.response.status, 403);
  assert.equal(practitioner.body.code, "TEACHER_ROLE_REQUIRED");

  const foreignTeacher = await get(1, 3, 1, ajenaToken);
  assert.equal(foreignTeacher.response.status, 403);
  assert.equal(foreignTeacher.body.code, "TEACHER_GROUP_REQUIRED");

  const foreignGroup = await get(2, 3, 1, propiaToken);
  assert.equal(foreignGroup.response.status, 403);
  assert.equal(foreignGroup.body.code, "TEACHER_GROUP_REQUIRED");

  const missingGroup = await get(999999, 3, 1, propiaToken);
  assert.equal(missingGroup.response.status, 404);
  assert.equal(missingGroup.body.code, "GROUP_NOT_FOUND");

  const archivedGroup = await get(5, 3, 1, propiaToken);
  assert.equal(archivedGroup.response.status, 403);
  assert.equal(archivedGroup.body.code, "TEACHER_GROUP_REQUIRED");

  const missingStudent = await get(1, 999999, 1, propiaToken);
  assert.equal(missingStudent.response.status, 404);
  assert.equal(missingStudent.body.code, "STUDENT_NOT_FOUND");

  const otherGroupStudent = await get(1, 8, 1, propiaToken);
  assert.equal(otherGroupStudent.response.status, 403);
  assert.equal(otherGroupStudent.body.code, "TEACHER_GROUP_REQUIRED");
  assert.deepEqual(Object.keys(otherGroupStudent.body).sort(), ["code", "error"]);

  const pendingEnrollment = await get(1, 5, 1, propiaToken);
  assert.equal(pendingEnrollment.response.status, 403);
  assert.equal(pendingEnrollment.body.code, "TEACHER_GROUP_REQUIRED");

  const suspendedUser = await get(1, 6, 1, propiaToken);
  assert.equal(suspendedUser.response.status, 403);
  assert.equal(suspendedUser.body.code, "TEACHER_GROUP_REQUIRED");

  const withoutStudentRole = await get(1, 7, 1, propiaToken);
  assert.equal(withoutStudentRole.response.status, 403);
  assert.equal(withoutStudentRole.body.code, "TEACHER_GROUP_REQUIRED");

  const missingActivity = await get(1, 3, 999999, propiaToken);
  assert.equal(missingActivity.response.status, 404);
  assert.equal(missingActivity.body.code, "ACTIVITY_NOT_FOUND");

  // La actividad existe, pero pertenece a otra edición anual.
  const otherEditionActivity = await get(1, 3, 3, propiaToken);
  assert.equal(otherEditionActivity.response.status, 403);
  assert.equal(otherEditionActivity.body.code, "TEACHER_GROUP_REQUIRED");

  const ok = await get(1, 3, 1, propiaToken);
  assert.equal(ok.response.status, 200);
  assert.equal(ok.response.headers.get("Cache-Control"), "no-store");
  assert.equal(ok.response.headers.get("X-Content-Type-Options"), "nosniff");
  const payload = ok.body;

  assert.equal(payload.group.id, 1);
  assert.equal(payload.group.code, "grupo-a");
  assert.equal(payload.group.editionId, 1);
  assert.deepEqual(payload.student, { id: 3, displayName: "Alumno Alfa", username: "alumno-alfa" });
  assert.deepEqual(payload.activity, {
    activityId: 1,
    slug: "actividad-principal",
    title: "Actividad principal",
    unitCode: "unidad-1",
    editorialState: "activa",
    availabilityStatus: "available",
    maxAttempts: 5,
  });

  // Intentos enviados: sólo enviados, orden cronológico real (fecha y luego id) y
  // `isBest` marcando únicamente al mejor.
  assert.deepEqual(payload.submittedAttempts.map((attempt) => attempt.attemptId), [alfaFirst, alfaSecond, alfaThird]);
  assert.deepEqual(payload.submittedAttempts.map((attempt) => attempt.number), [1, 2, 3]);
  assert.deepEqual(payload.submittedAttempts.map((attempt) => attempt.ordinal), [1, 2, 3]);
  assert.deepEqual(payload.submittedAttempts.map((attempt) => attempt.percentage), [30, 70, 70]);
  assert.deepEqual(payload.submittedAttempts.map((attempt) => attempt.score), [30, 70, 70]);
  assert.deepEqual(payload.submittedAttempts.map((attempt) => attempt.total), [100, 100, 100]);
  assert.deepEqual(payload.submittedAttempts.map((attempt) => attempt.submittedAt), [
    "2026-01-10T10:00:00Z", "2026-01-10T10:00:00Z", "2026-02-01T10:00:00Z",
  ]);
  assert.deepEqual(payload.submittedAttempts.map((attempt) => attempt.isBest), [false, true, false]);
  // El juicio se lee persistido, aunque no coincida con el porcentaje obtenido.
  assert.deepEqual(payload.submittedAttempts.map((attempt) => attempt.judgment), ["inicial", "inicial", "logrado"]);
  assert.deepEqual(payload.submittedAttempts.map((attempt) => attempt.questions.length), [3, 3, 3]);

  // Mejor intento y defecto: mismo criterio que C1/C2/C3, sobre los enviados.
  assert.deepEqual(payload.summary.best, {
    attemptId: alfaSecond,
    ordinal: 2,
    percentage: 70,
    score: 70,
    total: 100,
    judgment: "inicial",
    submittedAt: "2026-01-10T10:00:00Z",
  });
  assert.equal(payload.summary.judgment, "inicial");
  assert.equal(payload.defaultAttemptId, alfaSecond);

  // Resumen: enviados, anulados, usados (el borrador cuenta), último envío y borrador.
  assert.equal(payload.summary.submittedCount, 3);
  assert.equal(payload.summary.annulledCount, 1);
  assert.equal(payload.summary.attemptsUsed, 4);
  assert.equal(payload.summary.lastSubmittedAt, "2026-02-01T10:00:00Z");
  assert.equal(payload.summary.hasDraft, true);
  assert.equal(typeof payload.summary.draftStartedAt, "string");

  // Aislamiento: ni el envío perfecto de Beta ni el del mismo estudiante en el otro
  // grupo aparecen en este detalle.
  assert.equal(payload.submittedAttempts.length, 3);
  assert.equal(payload.submittedAttempts.some((attempt) => attempt.percentage === 100), false);
  assert.equal(payload.summary.lastSubmittedAt === "2026-04-01T10:00:00Z", false);

  // Anulados: colección aparte, compacta y sin preguntas ni respuestas.
  assert.equal(payload.annulledAttempts.length, 1);
  const annulled = payload.annulledAttempts[0];
  assert.equal(annulled.attemptId, alfaAnnulled);
  assert.equal(annulled.number, 4);
  assert.equal(annulled.ordinal, 4);
  assert.equal(annulled.state, "anulado");
  assert.equal(annulled.countsForResults, false);
  assert.equal(typeof annulled.startedAt, "string");
  assert.deepEqual(Object.keys(annulled).sort(), ["attemptId", "countsForResults", "number", "ordinal", "startedAt", "state"]);

  // Beta ve únicamente su propio intento.
  const betaPayload = await get(1, 4, 1, propiaToken);
  assert.equal(betaPayload.response.status, 200);
  assert.equal(betaPayload.body.summary.submittedCount, 1);
  assert.equal(betaPayload.body.summary.attemptsUsed, 1);
  assert.equal(betaPayload.body.summary.annulledCount, 0);
  assert.equal(betaPayload.body.summary.hasDraft, false);
  assert.equal(betaPayload.body.summary.draftStartedAt, null);
  assert.equal(betaPayload.body.summary.judgment, "logrado");
  assert.equal(betaPayload.body.submittedAttempts[0].percentage, 100);
  assert.equal(betaPayload.body.submittedAttempts[0].isBest, true);
  assert.equal(betaPayload.body.defaultAttemptId, betaPayload.body.submittedAttempts[0].attemptId);

  // Actividad sin intentos: todo explícito en cero o nulo.
  const withoutAttempts = await get(1, 3, 2, propiaToken);
  assert.equal(withoutAttempts.response.status, 200);
  assert.deepEqual(withoutAttempts.body.submittedAttempts, []);
  assert.deepEqual(withoutAttempts.body.annulledAttempts, []);
  assert.equal(withoutAttempts.body.defaultAttemptId, null);
  assert.deepEqual(withoutAttempts.body.summary, {
    attemptsUsed: 0,
    submittedCount: 0,
    annulledCount: 0,
    best: null,
    judgment: null,
    lastSubmittedAt: null,
    hasDraft: false,
    draftStartedAt: null,
  });

  // Actividad de empates: gana el mayor puntaje; entre iguales, la fecha más
  // antigua y después el id menor. El orden del payload sigue siendo cronológico.
  const ties = await get(1, 3, 5, propiaToken);
  assert.equal(ties.response.status, 200);
  assert.deepEqual(ties.body.submittedAttempts.map((attempt) => attempt.attemptId), [tieEarlier, tieWinner, tieLoser]);
  assert.deepEqual(ties.body.submittedAttempts.map((attempt) => attempt.percentage), [50, 50, 50]);
  assert.deepEqual(ties.body.submittedAttempts.map((attempt) => attempt.score), [496, 504, 504]);
  assert.deepEqual(ties.body.submittedAttempts.map((attempt) => attempt.submittedAt), [
    "2026-03-01T10:00:00Z", "2026-03-05T10:00:00Z", "2026-03-05T10:00:00Z",
  ]);
  assert.deepEqual(ties.body.submittedAttempts.map((attempt) => attempt.isBest), [false, true, false]);
  assert.equal(ties.body.summary.best.attemptId, tieWinner);
  assert.equal(ties.body.summary.best.score, 504);
  assert.equal(ties.body.summary.best.percentage, 50);
  assert.equal(ties.body.defaultAttemptId, tieWinner);
  assert.equal(ties.body.summary.submittedCount, 3);
  assert.equal(ties.body.summary.attemptsUsed, 3);
  assert.equal(ties.body.summary.annulledCount, 0);
  assert.equal(ties.body.summary.hasDraft, false);
  assert.equal(ties.body.summary.draftStartedAt, null);

  // Preguntas del primer intento: radio con texto visible, checkbox parcial en el
  // orden del snapshot y texto sin responder. Los valores vienen del snapshot y no
  // de la edición posterior de la actividad.
  const firstQuestions = payload.submittedAttempts[0].questions;
  assert.deepEqual(firstQuestions[0], {
    number: 1,
    type: "radio",
    prompt: "Pregunta radio",
    maxPoints: 30,
    answered: true,
    correct: true,
    pointsAwarded: 30,
    answer: { value: "Opción B" },
    expected: { value: "Opción B" },
    explanation: "Explicación uno",
  });
  assert.deepEqual(firstQuestions[1], {
    number: 2,
    type: "checkbox",
    prompt: "Pregunta checkbox",
    maxPoints: 40,
    answered: true,
    correct: false,
    pointsAwarded: 0,
    answer: { values: ["Alternativa B", "Alternativa C"] },
    expected: { values: ["Alternativa A", "Alternativa C"] },
    explanation: null,
  });
  assert.deepEqual(firstQuestions[2], {
    number: 3,
    type: "text",
    prompt: "Pregunta texto",
    maxPoints: 30,
    answered: false,
    correct: false,
    pointsAwarded: 0,
    answer: null,
    expected: { values: ["Java", "java"] },
    explanation: "Explicación tres",
  });

  // Segundo intento: radio incorrecta con su texto y texto aceptado.
  const secondQuestions = payload.submittedAttempts[1].questions;
  assert.deepEqual(secondQuestions[0].answer, { value: "Opción A" });
  assert.deepEqual(secondQuestions[0].expected, { value: "Opción B" });
  assert.equal(secondQuestions[0].correct, false);
  assert.equal(secondQuestions[0].pointsAwarded, 0);
  assert.deepEqual(secondQuestions[1].answer, { values: ["Alternativa A", "Alternativa C"] });
  assert.equal(secondQuestions[1].correct, true);
  assert.equal(secondQuestions[1].pointsAwarded, 40);
  assert.deepEqual(secondQuestions[2].answer, { value: "Java" });
  assert.deepEqual(secondQuestions[2].expected, { values: ["Java", "java"] });
  assert.equal(secondQuestions[2].correct, true);
  assert.equal(secondQuestions[2].pointsAwarded, 30);

  // Tercer intento: texto incorrecto, sin análisis semántico ni valoraciones blandas.
  const thirdText = payload.submittedAttempts[2].questions[2];
  assert.deepEqual(thirdText.answer, { value: "javascript" });
  assert.equal(thirdText.correct, false);
  assert.equal(thirdText.pointsAwarded, 0);
  assert.equal(JSON.stringify(thirdText).includes("casi"), false);

  // Tipo todavía sin revisión pública: `expected: null` sin romper el resto.
  const sortable = await get(1, 3, 4, propiaToken);
  assert.equal(sortable.response.status, 200);
  assert.deepEqual(sortable.body.submittedAttempts[0].questions[0], {
    number: 1,
    type: "ordenar",
    prompt: "Pregunta de ordenamiento",
    maxPoints: 10,
    answered: true,
    correct: true,
    pointsAwarded: 10,
    answer: { values: ["b", "a"] },
    expected: null,
    explanation: null,
  });

  // Historial: nada de la edición posterior aparece en la respuesta.
  const serialized = JSON.stringify(payload);
  for (const forbidden of [
    "approvalThreshold", "achievementThreshold", "umbral",
    "clave", "clave_correccion", "modo", "seleccion-exacta", "texto-exacto", "orden-exacto",
    "aceptadas", "respuesta_normalizada", "submission", "snapshot", "documento", "archivo",
    "usuario_id", "habilitacion_id",
    "Enunciado editado", "Opción Z", "clave-editada", "Explicación editada",
    "respuesta-anulada-privada", "borrador-privado",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `la respuesta no debe incluir "${forbidden}"`);
  }
  assert.equal(JSON.stringify(sortable.body).includes("orden-exacto"), false);
});
