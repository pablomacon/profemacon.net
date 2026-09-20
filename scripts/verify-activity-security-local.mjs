import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";

const projectRoot = process.cwd();
const persistenceRoot = mkdtempSync(join(tmpdir(), "profemacon-d1-security-"));
const command = process.execPath;
const wranglerPath = join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");

function findSqliteFile(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findSqliteFile(path);
      if (nested) return nested;
    } else if (entry.name.endsWith(".sqlite")) {
      return path;
    }
  }
  return null;
}

function attemptSql({ activity = 1, habilitation = activity, user = 1, number = 1, ordinal = number, submission, state = "en_progreso" }) {
  return `INSERT INTO intentos_actividad
    (actividad_id, habilitacion_id, usuario_id, numero_intento, ordinal_efectivo, estado,
     puntaje_obtenido, puntaje_total, porcentaje, juicio, devolucion, submission_id)
    VALUES (${activity}, ${habilitation}, ${user}, ${number}, ${ordinal}, '${state}',
      0, 1, 0, 'inicial', '', '${submission}')`;
}

function createConcurrentWriter(databasePath, sql, barrier) {
  const worker = new Worker(new URL("./activity-concurrent-writer.mjs", import.meta.url), {
    workerData: { databasePath, sql, barrier },
  });
  let readyResolve;
  let resultResolve;
  let finalResult;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  const result = new Promise((resolve) => { resultResolve = resolve; });
  worker.on("message", (message) => {
    if (message.ready) readyResolve();
    else finalResult = message;
  });
  worker.on("error", (error) => {
    readyResolve();
    finalResult = { code: -1, diagnostic: error.message };
  });
  worker.on("exit", (code) => resultResolve(finalResult ?? { code: code || -1, diagnostic: "El proceso concurrente terminó sin resultado" }));
  return { ready, result };
}

function assertSqlRejected(database, sql, expected) {
  assert.throws(
    () => database.exec(sql),
    (error) => error instanceof Error && expected.test(error.message),
  );
}

let database;
try {
  execFileSync(command, [
    wranglerPath, "d1", "migrations", "apply", "profemacon-beta-local", "--local",
    "--persist-to", persistenceRoot,
  ], { cwd: projectRoot, stdio: "ignore" });

  const databasePath = findSqliteFile(persistenceRoot);
  assert.ok(databasePath, "Wrangler no creó una base D1 local");
  database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    INSERT INTO roles (id, codigo, nombre) VALUES (1, 'estudiante', 'Estudiante');
    INSERT INTO usuarios (id, nombre_usuario, nombre_mostrado) VALUES
      (1, 'estudiante-uno', 'Estudiante Uno'),
      (2, 'estudiante-dos', 'Estudiante Dos'),
      (3, 'estudiante-tres', 'Estudiante Tres'),
      (4, 'usuario-sin-rol', 'Usuario Sin Rol');
    INSERT INTO usuario_roles (usuario_id, rol_id) VALUES (1, 1), (2, 1), (3, 1);
    INSERT INTO asignaturas (id, codigo, nombre) VALUES (1, 'asignatura-ficticia', 'Asignatura ficticia');
    INSERT INTO ediciones_anuales (id, asignatura_id, anio, nombre, estado)
      VALUES (1, 1, 2026, 'Edición ficticia', 'activa');
    INSERT INTO grupos (id, edicion_anual_id, codigo, nombre)
      VALUES (1, 1, 'grupo-ficticio', 'Grupo ficticio');
    INSERT INTO inscripciones (usuario_id, grupo_id, estado) VALUES
      (1, 1, 'activa'), (3, 1, 'activa'), (4, 1, 'activa');

    INSERT INTO actividades
      (id, slug, edicion_anual_id, unidad_codigo, tema, orden, titulo, estado,
       puntaje_total, maximo_intentos)
    VALUES
      (1, 'actividad-principal', 1, 'u-test', 'tema', 1, 'Actividad principal', 'activa', 1, 2),
      (2, 'actividad-ajena', 1, 'u-test', 'tema', 2, 'Actividad ajena', 'activa', 1, 2),
      (3, 'actividad-inactiva', 1, 'u-test', 'tema', 3, 'Actividad inactiva', 'borrador', 1, 2),
      (4, 'actividad-no-habilitada', 1, 'u-test', 'tema', 4, 'Actividad no habilitada', 'activa', 1, 2),
      (5, 'actividad-concurrente', 1, 'u-test', 'tema', 5, 'Actividad concurrente', 'activa', 1, 1),
      (6, 'actividad-futura', 1, 'u-test', 'tema', 6, 'Actividad futura', 'activa', 1, 1),
      (7, 'actividad-vencida', 1, 'u-test', 'tema', 7, 'Actividad vencida', 'activa', 1, 1),
      (8, 'actividad-con-anulacion', 1, 'u-test', 'tema', 8, 'Actividad con anulación', 'activa', 1, 2);

    INSERT INTO habilitaciones_actividad
      (id, actividad_id, grupo_id, habilitada, disponible_desde, disponible_hasta)
    VALUES
      (1, 1, 1, 1, NULL, NULL),
      (2, 2, 1, 1, NULL, NULL),
      (3, 3, 1, 1, NULL, NULL),
      (4, 4, 1, 0, NULL, NULL),
      (5, 5, 1, 1, NULL, NULL),
      (6, 6, 1, 1, '2099-01-01T00:00:00.000Z', NULL),
      (7, 7, 1, 1, NULL, '2020-01-01T00:00:00.000Z'),
      (8, 8, 1, 1, NULL, NULL);

    INSERT INTO preguntas_actividad
      (id, actividad_id, numero, tipo, enunciado, puntaje)
    VALUES
      (1, 1, 1, 'radio', 'Pregunta ficticia principal', 1),
      (2, 2, 1, 'radio', 'Pregunta ficticia ajena', 1);
  `);

  assertSqlRejected(database, `
    INSERT INTO intentos_actividad
      (actividad_id, habilitacion_id, usuario_id, numero_intento, ordinal_efectivo, estado,
       puntaje_obtenido, puntaje_total, porcentaje, juicio, devolucion)
    VALUES (1, 1, 1, 1, 1, 'en_progreso', 0, 1, 0, 'inicial', '')
  `, /submission_id válido/);
  assertSqlRejected(database, attemptSql({ submission: " entrega-con-espacios " }), /submission_id válido/);
  assertSqlRejected(database, attemptSql({ submission: "estado-inicial-invalido", state: "enviado" }), /debe comenzar en progreso/);

  database.exec(attemptSql({ submission: "entrega-uno" }));
  assert.equal(database.prepare("SELECT COUNT(*) AS total FROM intentos_actividad WHERE actividad_id = 1").get().total, 1);
  assertSqlRejected(database, "UPDATE intentos_actividad SET submission_id = 'otro-id' WHERE id = 1", /submission_id.*inmutable/);
  assertSqlRejected(database, "UPDATE intentos_actividad SET numero_intento = 2 WHERE id = 1", /identidad académica.*inmutable/);
  assertSqlRejected(database, "UPDATE intentos_actividad SET actividad_id = 2, habilitacion_id = 2 WHERE id = 1", /identidad académica.*inmutable/);

  assertSqlRejected(database, `
    INSERT INTO respuestas_intento_actividad
      (intento_id, pregunta_id, numero_pregunta, tipo_pregunta, enunciado_snapshot,
       respuesta_dada_json, respuesta_normalizada_json, correcta, puntaje_obtenido)
    VALUES (1, 2, 1, 'radio', 'Pregunta ficticia', 'null', 'null', 0, 0)
  `, /respuesta no es coherente/);
  assertSqlRejected(database, `
    INSERT INTO respuestas_intento_actividad
      (intento_id, pregunta_id, numero_pregunta, tipo_pregunta, enunciado_snapshot,
       respuesta_dada_json, respuesta_normalizada_json, correcta, puntaje_obtenido)
    VALUES (1, 1, 1, 'radio', 'Pregunta ficticia', 'null', 'null', 0, 0.5)
  `, /respuesta no es coherente/);
  assertSqlRejected(database, `
    INSERT INTO respuestas_intento_actividad
      (intento_id, pregunta_id, numero_pregunta, tipo_pregunta, enunciado_snapshot,
       respuesta_dada_json, respuesta_normalizada_json, correcta, puntaje_obtenido)
    VALUES (1, 1, 1, 'radio', 'Pregunta ficticia', 'null', 'null', 1, 2)
  `, /respuesta no es coherente/);

  database.exec(`
    INSERT INTO respuestas_intento_actividad
      (intento_id, pregunta_id, numero_pregunta, tipo_pregunta, enunciado_snapshot,
       respuesta_dada_json, respuesta_normalizada_json, correcta, puntaje_obtenido)
    VALUES (1, 1, 1, 'radio', 'Pregunta ficticia', 'null', 'null', 0, 0);
  `);
  assertSqlRejected(database, "UPDATE intentos_actividad SET puntaje_obtenido = 1, porcentaje = 100, estado = 'enviado' WHERE id = 1", /cierre del intento.*incoherente/);
  assertSqlRejected(database, "UPDATE intentos_actividad SET puntaje_total = 2, estado = 'enviado' WHERE id = 1", /cierre del intento.*incoherente/);
  assertSqlRejected(database, "UPDATE intentos_actividad SET porcentaje = 100, estado = 'enviado' WHERE id = 1", /cierre del intento.*incoherente/);
  database.exec("UPDATE intentos_actividad SET estado = 'enviado' WHERE id = 1");
  assertSqlRejected(database, "UPDATE intentos_actividad SET devolucion = 'cambio' WHERE id = 1", /intento enviado.*inmutable/);
  assertSqlRejected(database, "UPDATE intentos_actividad SET estado = 'anulado' WHERE id = 1", /intento enviado.*inmutable/);
  assertSqlRejected(database, "UPDATE respuestas_intento_actividad SET correcta = 1 WHERE id = 1", /intento cerrado.*inmutables/);
  assertSqlRejected(database, "DELETE FROM respuestas_intento_actividad WHERE id = 1", /intento cerrado.*inmutables/);
  assertSqlRejected(database, "DELETE FROM intentos_actividad WHERE id = 1", /intento enviado.*inmutable/);
  assertSqlRejected(database, `
    INSERT INTO respuestas_intento_actividad
      (intento_id, pregunta_id, numero_pregunta, tipo_pregunta, enunciado_snapshot,
       respuesta_dada_json, respuesta_normalizada_json, correcta, puntaje_obtenido)
    VALUES (1, 1, 1, 'radio', 'Pregunta ficticia', 'null', 'null', 0, 0)
  `, /intento cerrado.*inmutables/);

  assertSqlRejected(database, attemptSql({ number: 2, ordinal: 2, submission: "entrega-uno" }), /UNIQUE constraint failed.*submission_id/);
  database.exec(attemptSql({ number: 2, ordinal: 2, submission: "entrega-dos" }));
  const secondAttemptId = database.prepare("SELECT id FROM intentos_actividad WHERE submission_id = 'entrega-dos'").get().id;
  database.exec(`
    INSERT INTO respuestas_intento_actividad
      (intento_id, pregunta_id, numero_pregunta, tipo_pregunta, enunciado_snapshot,
       respuesta_dada_json, respuesta_normalizada_json, correcta, puntaje_obtenido)
    VALUES (${secondAttemptId}, 1, 1, 'radio', 'Pregunta ficticia', 'null', 'null', 0, 0);
    UPDATE intentos_actividad SET estado = 'enviado' WHERE id = ${secondAttemptId};
  `);
  assert.equal(database.prepare("SELECT COUNT(*) AS total FROM intentos_actividad WHERE actividad_id = 1").get().total, 2);
  assertSqlRejected(database, attemptSql({ number: 3, ordinal: 3, submission: "entrega-tres" }), /máximo de intentos/);
  assert.equal(database.prepare("SELECT COUNT(*) AS total FROM intentos_actividad WHERE submission_id = 'entrega-uno'").get().total, 1);

  database.exec(attemptSql({ activity: 2, submission: "sin-respuestas" }));
  const incompleteAttemptId = database.prepare("SELECT id FROM intentos_actividad WHERE submission_id = 'sin-respuestas'").get().id;
  assertSqlRejected(database, `UPDATE intentos_actividad SET estado = 'enviado' WHERE id = ${incompleteAttemptId}`, /cierre del intento.*incoherente/);
  assertSqlRejected(database, `DELETE FROM intentos_actividad WHERE id = ${incompleteAttemptId}`, /debe anularse, no eliminarse/);

  database.exec(attemptSql({ activity: 8, submission: "anulado-uno" }));
  const annulledAttemptId = database.prepare("SELECT id FROM intentos_actividad WHERE submission_id = 'anulado-uno'").get().id;
  database.exec(`UPDATE intentos_actividad SET estado = 'anulado' WHERE id = ${annulledAttemptId}`);
  database.exec(attemptSql({ activity: 8, number: 2, ordinal: 1, submission: "reemplazo-uno" }));
  const replacement = database.prepare("SELECT numero_intento, ordinal_efectivo FROM intentos_actividad WHERE submission_id = 'reemplazo-uno'").get();
  assert.equal(replacement.numero_intento, 2);
  assert.equal(replacement.ordinal_efectivo, 1);
  assertSqlRejected(database, `UPDATE intentos_actividad SET estado = 'en_progreso' WHERE id = ${annulledAttemptId}`, /intento anulado.*inmutable/);

  assertSqlRejected(database, attemptSql({ activity: 3, submission: "inactiva" }), /no está disponible/);
  assertSqlRejected(database, attemptSql({ activity: 4, submission: "no-habilitada" }), /no está disponible/);
  assertSqlRejected(database, attemptSql({ activity: 1, user: 2, number: 1, submission: "sin-inscripcion" }), /no está disponible/);
  assertSqlRejected(database, attemptSql({ activity: 1, user: 4, number: 1, submission: "sin-rol" }), /no está disponible/);
  assertSqlRejected(database, attemptSql({ activity: 6, submission: "futura" }), /no está disponible/);
  assertSqlRejected(database, attemptSql({ activity: 7, submission: "vencida" }), /no está disponible/);

  database.close();
  database = undefined;

  const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const writers = [
    createConcurrentWriter(databasePath, attemptSql({ activity: 5, user: 3, submission: "concurrente-a" }), barrier),
    createConcurrentWriter(databasePath, attemptSql({ activity: 5, user: 3, submission: "concurrente-b" }), barrier),
  ];
  await Promise.all(writers.map((writer) => writer.ready));
  Atomics.store(new Int32Array(barrier), 0, 1);
  Atomics.notify(new Int32Array(barrier), 0, writers.length);
  const concurrentResults = await Promise.all(writers.map((writer) => writer.result));
  assert.equal(concurrentResults.filter((result) => result.code === 0).length, 1, "Sólo una entrega concurrente debe ser aceptada");
  const loser = concurrentResults.find((result) => result.code !== 0);
  assert.ok(loser && /Se alcanzó el máximo de intentos/.test(loser.diagnostic), "La escritura perdedora debe ser rechazada por el máximo de intentos");

  database = new DatabaseSync(databasePath);
  assert.equal(database.prepare("SELECT COUNT(*) AS total FROM intentos_actividad WHERE actividad_id = 5").get().total, 1);
  database.exec("PRAGMA foreign_keys = ON");
  assertSqlRejected(database, attemptSql({ activity: 5, user: 3, number: 2, ordinal: 2, submission: "posterior-al-limite" }), /máximo de intentos/);
  console.log("D1 local: controles de persistencia y concurrencia aprobados.");
} finally {
  database?.close();
  rmSync(persistenceRoot, { recursive: true, force: true });
}
