import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { gradeActivity } from "../worker/activity-grading.ts";

const projectRoot = process.cwd();
const wranglerPath = join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const cliPath = join(projectRoot, "scripts", "activity-authoring.mjs");
const SENTINEL = "sentinela-privada-9f21";

function findDatabaseFile(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findDatabaseFile(path);
      if (nested) return nested;
    } else if (entry.name.endsWith(".sqlite") && entry.name !== "metadata.sqlite") {
      return path;
    }
  }
  return null;
}

function canonicalDocument(overrides = {}) {
  const base = {
    schemaVersion: 1,
    activity: {
      slug: "actividad-sonda-01",
      title: "Actividad de sonda",
      description: "Descripción ficticia del pipeline.",
      topic: "Tema ficticio",
      unitCode: "unidad-1",
      order: 1,
      edition: { subjectCode: "programacion-prueba", year: 2026 },
      maxAttempts: 2,
      showReview: true,
      approvalThreshold: 50,
      achievementThreshold: 76,
      editorialState: "draft",
    },
    questions: [
      {
        number: 1,
        type: "radio",
        prompt: "¿Cuál es la opción correcta?",
        instructions: "Elegí una opción.",
        points: 2,
        options: [
          { value: "a", text: "Opción A" },
          { value: "b", text: "Opción B" },
          { value: "c", text: "Opción C" },
        ],
        grading: { mode: "single", correct: "a" },
        explanation: "Explicación ficticia de la pregunta 1.",
      },
      {
        number: 2,
        type: "checkbox",
        prompt: "Seleccioná todas las correctas.",
        points: 3,
        options: [
          { value: "x", text: "Opción X" },
          { value: "y", text: "Opción Y" },
          { value: "z", text: "Opción Z" },
        ],
        grading: { mode: "exact-selection", correct: ["x", "z"] },
        explanation: "Explicación ficticia de la pregunta 2.",
      },
      {
        number: 3,
        type: "text",
        prompt: "Escribí la respuesta ficticia.",
        points: 2,
        placeholder: "Escribí acá",
        grading: { mode: "accepted-text", accepted: [SENTINEL], trim: true, caseSensitive: true },
        explanation: "Explicación ficticia de la pregunta 3.",
        resources: [
          { type: "image", src: "/actividades/sonda/q3.webp", alt: "Imagen ficticia con texto alternativo suficiente" },
          { type: "code", language: "java", content: "int edad = 15;", title: "Ejemplo ficticio" },
        ],
      },
    ],
    tags: ["sonda"],
    authoring: { createdBy: "prueba-automatica", version: 1 },
  };
  const merged = { ...base, ...overrides };
  if (overrides.activity) merged.activity = { ...base.activity, ...overrides.activity };
  return merged;
}

function runCli(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd: projectRoot, encoding: "utf8" });
  return {
    code: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function parseJsonReport(run) {
  const start = run.stdout.indexOf("{");
  assert.ok(start >= 0, `El informe no contiene JSON: ${run.output}`);
  return JSON.parse(run.stdout.slice(start));
}

function createEnvironment(prefix) {
  const persistenceRoot = mkdtempSync(join(tmpdir(), prefix));
  const environment = { ...process.env, XDG_CONFIG_HOME: persistenceRoot };
  execFileSync(process.execPath, [
    wranglerPath, "d1", "migrations", "apply", "profemacon-beta-local", "--local", "--persist-to", persistenceRoot,
  ], { cwd: projectRoot, stdio: "ignore", env: environment });
  const databasePath = findDatabaseFile(persistenceRoot);
  assert.ok(databasePath, "Wrangler no creó la base D1 temporal");
  const seed = new DatabaseSync(databasePath);
  seed.exec("PRAGMA foreign_keys = ON");
  seed.exec(`
    INSERT INTO roles (id, codigo, nombre) VALUES (1, 'estudiante', 'Estudiante ficticio');
    INSERT INTO usuarios (id, nombre_usuario, nombre_mostrado) VALUES (1, 'sonda-estudiante', 'Sonda Estudiante');
    INSERT INTO usuario_roles (usuario_id, rol_id) VALUES (1, 1);
    INSERT INTO asignaturas (id, codigo, nombre) VALUES (1, 'programacion-prueba', 'Programación de prueba');
    INSERT INTO ediciones_anuales (id, asignatura_id, anio, nombre, estado) VALUES
      (1, 1, 2026, 'Edición de prueba', 'activa'),
      (2, 1, 2027, 'Edición siguiente', 'activa');
    INSERT INTO grupos (id, edicion_anual_id, codigo, nombre) VALUES (1, 1, 'grupo-a', 'Grupo A');
    INSERT INTO inscripciones (id, usuario_id, grupo_id, estado) VALUES (1, 1, 1, 'activa');
  `);
  seed.close();
  return { persistenceRoot, databasePath, environment };
}

function snapshotOtherTables(databasePath) {
  const db = new DatabaseSync(databasePath);
  const counts = {
    intentos: db.prepare("SELECT COUNT(*) AS total FROM intentos_actividad").get().total,
    respuestas: db.prepare("SELECT COUNT(*) AS total FROM respuestas_intento_actividad").get().total,
    habilitaciones: db.prepare("SELECT COUNT(*) AS total FROM habilitaciones_actividad").get().total,
    calificaciones: db.prepare("SELECT COUNT(*) AS total FROM calificaciones_actividad").get().total,
    snapshots: db.prepare("SELECT COUNT(*) AS total FROM preguntas_intento_actividad").get().total,
  };
  db.close();
  return counts;
}

// En Windows el archivo recién liberado por el subproceso de Wrangler puede
// seguir bloqueado unos milisegundos: se reintenta el borrado del directorio.
function removeQuietly(directory) {
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      rmSync(directory, { recursive: true, force: true });
      return;
    } catch {
      Atomics.wait(sleeper, 0, 0, 150);
    }
  }
}

test("el publicador es idempotente, respeta la historia y revierte sin dejar rastros", async (t) => {
  const { persistenceRoot, databasePath } = createEnvironment("profemacon-authoring-policy-");
  const outputs = [];
  const run = (args) => {
    const result = runCli(args);
    outputs.push(result.output);
    return result;
  };

  try {
    const documentPath = join(persistenceRoot, "documento.json");
    const write = (document) => writeFileSync(documentPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    const base = ["--database", databasePath, "--json"];
    const readActivity = () => {
      const db = new DatabaseSync(databasePath);
      const row = db.prepare("SELECT * FROM actividades WHERE slug = 'actividad-sonda-01'").get();
      db.close();
      return row;
    };
    const readQuestions = () => {
      const db = new DatabaseSync(databasePath);
      const rows = db.prepare("SELECT * FROM preguntas_actividad WHERE actividad_id = ?1 ORDER BY numero").all(readActivity().id);
      db.close();
      return rows;
    };

    write(canonicalDocument());
    assert.equal(run(["publish:local", documentPath, ...base, "--apply"]).code, 0);
    const externalBefore = snapshotOtherTables(databasePath);

    // Idempotencia: publicar dos veces no duplica ni reescribe timestamps.
    const before = readActivity();
    const second = run(["publish:local", documentPath, ...base, "--apply"]);
    assert.equal(second.code, 0, second.output);
    assert.equal(parseJsonReport(second).status, "unchanged");
    assert.equal(readActivity().actualizada_en, before.actualizada_en, "no debe reescribirse actualizada_en");
    assert.equal(readQuestions().length, 3);
    assert.deepEqual(snapshotOtherTables(databasePath), externalBefore);

    // Actualización de metadata y de la explicación de una pregunta.
    const updatedDocument = canonicalDocument({ activity: { title: "Actividad de sonda (revisada)" } });
    updatedDocument.questions[1].explanation = "Explicación corregida de la pregunta 2.";
    write(updatedDocument);
    const updated = run(["publish:local", documentPath, ...base, "--apply"]);
    assert.equal(updated.code, 0, updated.output);
    const updatedReport = parseJsonReport(updated);
    assert.equal(updatedReport.status, "updated");
    assert.deepEqual(updatedReport.changes.activity, ["titulo"]);
    assert.deepEqual(updatedReport.changes.questions, [{ number: 2, fields: ["explicacion_revision_final"] }]);
    assert.equal(readActivity().titulo, "Actividad de sonda (revisada)");
    assert.equal(readQuestions()[1].explicacion_revision_final, "Explicación corregida de la pregunta 2.");
    assert.deepEqual(snapshotOtherTables(databasePath), externalBefore);

    // Alta de una pregunta nueva.
    const fourthQuestion = {
      number: 4,
      type: "radio",
      prompt: "Pregunta agregada.",
      points: 2,
      options: [{ value: "si", text: "Sí" }, { value: "no", text: "No" }],
      grading: { mode: "single", correct: "si" },
      explanation: "Explicación de la pregunta agregada.",
    };
    const withFourth = canonicalDocument({ activity: { title: "Actividad de sonda (revisada)" } });
    withFourth.questions[1].explanation = "Explicación corregida de la pregunta 2.";
    withFourth.questions.push(fourthQuestion);
    write(withFourth);
    const added = run(["publish:local", documentPath, ...base, "--apply"]);
    assert.equal(added.code, 0, added.output);
    assert.equal(parseJsonReport(added).status, "updated");
    assert.equal(readQuestions().length, 4);
    assert.equal(readActivity().puntaje_total, 9, "el puntaje total se recalcula");
    assert.deepEqual(snapshotOtherTables(databasePath), externalBefore);
    t.diagnostic("creación, idempotencia y actualización verificadas");
  } finally {
    removeQuietly(persistenceRoot);
    assert.deepEqual(outputs.filter((output) => output.includes(SENTINEL)), [], "ninguna salida debe contener valores aceptados");
  }
});

test("con intentos existentes el publicador exige el flag explícito y nunca pierde historia", async (t) => {
  const { persistenceRoot, databasePath } = createEnvironment("profemacon-authoring-history-");
  const outputs = [];
  const run = (args) => {
    const result = runCli(args);
    outputs.push(result.output);
    return result;
  };

  try {
    const documentPath = join(persistenceRoot, "documento.json");
    const write = (document) => writeFileSync(documentPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    const base = ["--database", databasePath, "--json"];
    const readActivity = () => {
      const db = new DatabaseSync(databasePath);
      const row = db.prepare("SELECT * FROM actividades WHERE slug = 'actividad-sonda-01'").get();
      db.close();
      return row;
    };
    const readQuestions = () => {
      const db = new DatabaseSync(databasePath);
      const rows = db.prepare("SELECT * FROM preguntas_actividad WHERE actividad_id = ?1 ORDER BY numero").all(readActivity().id);
      db.close();
      return rows;
    };

    write(canonicalDocument());
    assert.equal(run(["publish:local", documentPath, ...base, "--apply"]).code, 0);

    // Historial ficticio mínimo: actividad activa, habilitación e intento en progreso.
    const seed = new DatabaseSync(databasePath);
    seed.exec("PRAGMA foreign_keys = ON");
    seed.exec(`
      UPDATE actividades SET estado = 'activa' WHERE slug = 'actividad-sonda-01';
      INSERT INTO habilitaciones_actividad (id, actividad_id, grupo_id, habilitada)
        SELECT 1, id, 1, 1 FROM actividades WHERE slug = 'actividad-sonda-01';
      INSERT INTO intentos_actividad
        (actividad_id, habilitacion_id, usuario_id, numero_intento, ordinal_efectivo, estado,
         puntaje_obtenido, puntaje_total, porcentaje, juicio, devolucion, submission_id)
        SELECT id, 1, 1, 1, 1, 'en_progreso', 0, puntaje_total, 0, 'inicial', '', 'sonda-intento-01'
        FROM actividades WHERE slug = 'actividad-sonda-01';
    `);
    seed.close();
    const historyBefore = snapshotOtherTables(databasePath);
    const activityBefore = readActivity();

    // maxAttempts queda congelado si existen intentos.
    write(canonicalDocument({ activity: { maxAttempts: 5, editorialState: "active" } }));
    const blockedAttempts = run(["publish:local", documentPath, ...base, "--apply"]);
    assert.equal(blockedAttempts.code, 2, blockedAttempts.output);
    assert.deepEqual(parseJsonReport(blockedAttempts).policyBlockers.map((issue) => issue.code), ["MAX_ATTEMPTS_CHANGE_BLOCKED"]);
    assert.deepEqual(readActivity(), activityBefore, "un bloqueo no debe escribir nada");

    // No se pueden quitar preguntas con intentos.
    const twoQuestions = canonicalDocument({ activity: { editorialState: "active" } });
    twoQuestions.questions = twoQuestions.questions.slice(0, 2);
    write(twoQuestions);
    const blockedRemoval = run(["publish:local", documentPath, ...base, "--apply"]);
    assert.equal(blockedRemoval.code, 2, blockedRemoval.output);
    assert.ok(parseJsonReport(blockedRemoval).policyBlockers.some((issue) => issue.code === "REMOVING_QUESTIONS_WITH_ATTEMPTS"));
    assert.equal(readQuestions().length, 3, "las preguntas no se eliminan");
    assert.deepEqual(readActivity(), activityBefore);

    // Un cambio de contenido sin flag se rechaza.
    const contentChange = canonicalDocument({ activity: { editorialState: "active" } });
    contentChange.questions[0].prompt = "Enunciado modificado.";
    contentChange.questions[0].points = 3;
    write(contentChange);
    const blockedContent = run(["publish:local", documentPath, ...base, "--apply"]);
    assert.equal(blockedContent.code, 2, blockedContent.output);
    assert.ok(parseJsonReport(blockedContent).policyBlockers.some((issue) => issue.code === "CONTENT_CHANGE_BLOCKED"));
    assert.equal(readQuestions()[0].enunciado, "¿Cuál es la opción correcta?", "sin flag no se toca el contenido");
    assert.deepEqual(snapshotOtherTables(databasePath), historyBefore);

    // Con el flag explícito se aplica y avisa.
    const allowed = run(["publish:local", documentPath, ...base, "--apply", "--allow-content-change-with-history"]);
    assert.equal(allowed.code, 0, allowed.output);
    const allowedReport = parseJsonReport(allowed);
    assert.equal(allowedReport.status, "updated");
    assert.ok(allowedReport.policyWarnings.some((issue) => issue.code === "CONTENT_CHANGE_WITH_HISTORY"));
    assert.ok(allowedReport.policyWarnings.some((issue) => issue.code === "DRAFTS_USE_PREVIOUS_VERSION"));
    assert.equal(readQuestions()[0].enunciado, "Enunciado modificado.");
    assert.equal(readQuestions()[0].puntaje, 3);
    assert.equal(readActivity().puntaje_total, 8, "el puntaje total se recalcula");
    assert.deepEqual(snapshotOtherTables(databasePath), historyBefore, "intentos, snapshots y respuestas no se tocan");
    t.diagnostic("política con historia verificada");
  } finally {
    removeQuietly(persistenceRoot);
    assert.deepEqual(outputs.filter((output) => output.includes(SENTINEL)), [], "ninguna salida debe contener valores aceptados");
  }
});

test("conflictos de orden, edición inexistente y contrato de salida sin secretos", async (t) => {
  const { persistenceRoot, databasePath } = createEnvironment("profemacon-authoring-conflict-");
  const outputs = [];
  const run = (args) => {
    const result = runCli(args);
    outputs.push(result.output);
    return result;
  };

  try {
    const documentPath = join(persistenceRoot, "documento.json");
    const write = (document) => writeFileSync(documentPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    const base = ["--database", databasePath, "--json"];

    write(canonicalDocument());
    const created = run(["publish:local", documentPath, ...base, "--apply"]);
    assert.equal(created.code, 0, created.output);

    // Contrato de salida: campos esperados y ausencia absoluta de material privado.
    const contract = parseJsonReport(created);
    for (const key of ["status", "command", "dryRun", "slug", "edition", "unitCode", "order", "editorialState", "questions", "totalPoints", "metadataOnlyFields", "questionsSummary", "facts", "warnings", "notes", "errors", "policyBlockers", "postVerify", "publicProjection"]) {
      assert.ok(Object.hasOwn(contract, key), `el contrato debe incluir ${key}`);
    }
    assert.equal(contract.status, "created");
    assert.equal(contract.edition.subjectCode, "programacion-prueba");
    assert.equal(contract.questions, 3);
    assert.deepEqual(contract.metadataOnlyFields, ["tags", "authoring"]);
    assert.deepEqual(contract.policyWarnings, []);
    const serializedContract = JSON.stringify(contract);
    for (const forbidden of ["clave_correccion_json", "texto-exacto", "seleccion-exacta", "opcion", "aceptadas", "correctas", SENTINEL]) {
      assert.equal(serializedContract.includes(forbidden), false, `el contrato no debe incluir ${forbidden}`);
    }

    // Conflicto de orden dentro de la misma unidad y edición.
    const occupant = new DatabaseSync(databasePath);
    occupant.exec(`
      INSERT INTO actividades (slug, edicion_anual_id, unidad_codigo, tema, orden, titulo, estado, puntaje_total, maximo_intentos)
      VALUES ('actividad-ocupante', 1, 'unidad-1', 'Tema', 2, 'Ocupante', 'borrador', 1, 1);
    `);
    occupant.close();
    write(canonicalDocument({ activity: { slug: "actividad-nueva-02", order: 2 } }));
    const conflict = run(["publish:local", documentPath, ...base, "--apply"]);
    assert.equal(conflict.code, 2, conflict.output);
    assert.deepEqual(parseJsonReport(conflict).policyBlockers.map((issue) => issue.code), ["ORDER_CONFLICT"]);
    assert.equal(parseJsonReport(conflict).facts.orderConflicts.length, 1);

    // Mismo slug en otra edición: no se mueve ni se duplica.
    write(canonicalDocument({ activity: { edition: { subjectCode: "programacion-prueba", year: 2027 } } }));
    const mismatch = run(["publish:local", documentPath, ...base, "--apply"]);
    assert.equal(mismatch.code, 2, mismatch.output);
    assert.deepEqual(parseJsonReport(mismatch).policyBlockers.map((issue) => issue.code), ["EDITION_MISMATCH"]);

    // Edición inexistente: el pipeline nunca crea asignaturas ni ediciones.
    write(canonicalDocument({ activity: { slug: "actividad-sin-edicion", edition: { subjectCode: "asignatura-inexistente", year: 2026 } } }));
    const missingEdition = run(["publish:local", documentPath, ...base, "--apply"]);
    assert.equal(missingEdition.code, 2, missingEdition.output);
    assert.deepEqual(parseJsonReport(missingEdition).policyBlockers.map((issue) => issue.code), ["EDITION_NOT_FOUND"]);

    // Documento inválido: se rechaza antes de abrir la base.
    write({ ...canonicalDocument(), schemaVersion: 9 });
    const invalid = run(["publish:local", documentPath, ...base, "--apply"]);
    assert.equal(invalid.code, 1, invalid.output);
    assert.equal(parseJsonReport(invalid).status, "rejected");
    assert.ok(parseJsonReport(invalid).errors.some((issue) => issue.code === "UNSUPPORTED_SCHEMA_VERSION"));

    // Sólo dos actividades quedaron registradas: la publicada y la ocupante.
    const inspect = new DatabaseSync(databasePath);
    const slugs = inspect.prepare("SELECT slug FROM actividades ORDER BY slug").all().map((row) => row.slug);
    inspect.close();
    assert.deepEqual(slugs, ["actividad-ocupante", "actividad-sonda-01"]);
    t.diagnostic("conflictos y contrato de salida verificados");
  } finally {
    removeQuietly(persistenceRoot);
    assert.deepEqual(outputs.filter((output) => output.includes(SENTINEL)), [], "ninguna salida debe contener valores aceptados");
  }
});

test("un borrador conserva su snapshot v1 y un intento nuevo recibe la versión publicada", async (t) => {
  const { persistenceRoot, databasePath } = createEnvironment("profemacon-authoring-snapshot-");
  const outputs = [];
  const run = (args) => {
    const result = runCli(args);
    outputs.push(result.output);
    return result;
  };

  try {
    const documentPath = join(persistenceRoot, "documento.json");
    const write = (document) => writeFileSync(documentPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    const base = ["--database", databasePath, "--json"];

    // Versión 1 publicada y un borrador iniciado sobre ella.
    write(canonicalDocument());
    assert.equal(run(["publish:local", documentPath, ...base, "--apply"]).code, 0);
    const seed = new DatabaseSync(databasePath);
    seed.exec("PRAGMA foreign_keys = ON");
    seed.exec(`
      UPDATE actividades SET estado = 'activa' WHERE slug = 'actividad-sonda-01';
      INSERT INTO habilitaciones_actividad (id, actividad_id, grupo_id, habilitada)
        SELECT 1, id, 1, 1 FROM actividades WHERE slug = 'actividad-sonda-01';
      INSERT INTO intentos_actividad
        (actividad_id, habilitacion_id, usuario_id, numero_intento, ordinal_efectivo, estado,
         puntaje_obtenido, puntaje_total, porcentaje, juicio, devolucion, submission_id)
        SELECT id, 1, 1, 1, 1, 'en_progreso', 0, puntaje_total, 0, 'inicial', '', 'sonda-snapshot-v1'
        FROM actividades WHERE slug = 'actividad-sonda-01';
    `);
    seed.close();

    const readSnapshots = (submissionId) => {
      const db = new DatabaseSync(databasePath);
      const rows = db.prepare(`
        SELECT s.numero_pregunta, s.enunciado_snapshot, s.clave_correccion_snapshot_json, s.puntaje_maximo, s.tipo_pregunta
        FROM preguntas_intento_actividad s
        JOIN intentos_actividad i ON i.id = s.intento_id
        WHERE i.submission_id = ?1 ORDER BY s.numero_pregunta
      `).all(submissionId);
      db.close();
      return rows;
    };
    const gradeSnapshot = (rows, answers) => gradeActivity(rows.map((row) => ({
      id: row.numero_pregunta,
      numero: row.numero_pregunta,
      tipo: row.tipo_pregunta,
      puntaje: row.puntaje_maximo,
      claveCorreccionJson: row.clave_correccion_snapshot_json,
      retroalimentacionCorrecta: "",
      retroalimentacionIncorrecta: "",
    })), answers);

    const version1 = readSnapshots("sonda-snapshot-v1");
    assert.equal(version1.length, 3, "el borrador recibe un snapshot completo de la versión 1");

    // Versión 2: cambia el enunciado y la opción correcta de la primera pregunta.
    const version2Document = canonicalDocument({ activity: { editorialState: "active" } });
    version2Document.questions[0].prompt = "Enunciado de la versión 2.";
    version2Document.questions[0].grading = { mode: "single", correct: "b" };
    write(version2Document);

    const blocked = run(["publish:local", documentPath, ...base, "--apply"]);
    assert.equal(blocked.code, 2, blocked.output);
    assert.ok(parseJsonReport(blocked).policyBlockers.some((issue) => issue.code === "CONTENT_CHANGE_BLOCKED"));

    const applied = run(["publish:local", documentPath, ...base, "--apply", "--allow-content-change-with-history"]);
    assert.equal(applied.code, 0, applied.output);
    assert.equal(parseJsonReport(applied).status, "updated");

    // El borrador sigue viendo exactamente la versión 1.
    const version1After = readSnapshots("sonda-snapshot-v1");
    assert.deepEqual(version1After, version1, "el snapshot del borrador no puede cambiar");
    assert.equal(gradeSnapshot(version1After, { 1: "a", 2: ["x", "z"], 3: SENTINEL }).score, 7, "para el borrador sigue siendo correcta la opción de v1");
    assert.equal(gradeSnapshot(version1After, { 1: "b", 2: ["x", "z"], 3: SENTINEL }).score, 5, "la opción de v2 no puntúa en el borrador de v1");

    // Un intento nuevo usa la versión vigente.
    const second = new DatabaseSync(databasePath);
    second.exec("PRAGMA foreign_keys = ON");
    second.exec(`
      UPDATE intentos_actividad SET estado = 'anulado' WHERE submission_id = 'sonda-snapshot-v1';
      INSERT INTO intentos_actividad
        (actividad_id, habilitacion_id, usuario_id, numero_intento, ordinal_efectivo, estado,
         puntaje_obtenido, puntaje_total, porcentaje, juicio, devolucion, submission_id)
        SELECT id, 1, 1, 2, 1, 'en_progreso', 0, puntaje_total, 0, 'inicial', '', 'sonda-snapshot-v2'
        FROM actividades WHERE slug = 'actividad-sonda-01';
    `);
    second.close();

    const version2Snapshot = readSnapshots("sonda-snapshot-v2");
    assert.equal(version2Snapshot[0].enunciado_snapshot, "Enunciado de la versión 2.");
    assert.notEqual(version2Snapshot[0].clave_correccion_snapshot_json, version1[0].clave_correccion_snapshot_json);
    assert.equal(gradeSnapshot(version2Snapshot, { 1: "b", 2: ["x", "z"], 3: SENTINEL }).score, 7, "el intento nuevo se corrige con la versión publicada");
    assert.equal(gradeSnapshot(version2Snapshot, { 1: "a", 2: ["x", "z"], 3: SENTINEL }).score, 5);

    const inspect = new DatabaseSync(databasePath);
    assert.equal(inspect.prepare("SELECT COUNT(*) AS total FROM preguntas_intento_actividad").get().total, 6, "snapshots intactos: 3 de v1 y 3 de v2");
    const current = inspect.prepare("SELECT enunciado FROM preguntas_actividad p JOIN actividades a ON a.id = p.actividad_id WHERE a.slug = 'actividad-sonda-01' AND p.numero = 1").get();
    inspect.close();
    assert.equal(current.enunciado, "Enunciado de la versión 2.");
    t.diagnostic("borrador v1 intacto y intento nuevo con v2");
  } finally {
    removeQuietly(persistenceRoot);
    assert.deepEqual(outputs.filter((output) => output.includes(SENTINEL)), [], "ninguna salida debe contener valores aceptados");
  }
});

test("pipeline local de autoría: validar, publicar, idempotencia, política y rollback", async (t) => {
  const persistenceRoot = mkdtempSync(join(tmpdir(), "profemacon-authoring-"));
  const environment = { ...process.env, XDG_CONFIG_HOME: persistenceRoot };
  const outputs = [];

  try {
    execFileSync(process.execPath, [
      wranglerPath, "d1", "migrations", "apply", "profemacon-beta-local", "--local", "--persist-to", persistenceRoot,
    ], { cwd: projectRoot, stdio: "ignore", env: environment });

    const databasePath = findDatabaseFile(persistenceRoot);
    assert.ok(databasePath, "Wrangler no creó la base D1 temporal");

    const seed = new DatabaseSync(databasePath);
    seed.exec("PRAGMA foreign_keys = ON");
    seed.exec(`
      INSERT INTO roles (id, codigo, nombre) VALUES (1, 'estudiante', 'Estudiante ficticio');
      INSERT INTO usuarios (id, nombre_usuario, nombre_mostrado) VALUES (1, 'sonda-estudiante', 'Sonda Estudiante');
      INSERT INTO usuario_roles (usuario_id, rol_id) VALUES (1, 1);
      INSERT INTO asignaturas (id, codigo, nombre) VALUES (1, 'programacion-prueba', 'Programación de prueba');
      INSERT INTO ediciones_anuales (id, asignatura_id, anio, nombre, estado) VALUES
        (1, 1, 2026, 'Edición de prueba', 'activa'),
        (2, 1, 2027, 'Edición siguiente', 'activa');
      INSERT INTO grupos (id, edicion_anual_id, codigo, nombre) VALUES (1, 1, 'grupo-a', 'Grupo A');
      INSERT INTO inscripciones (id, usuario_id, grupo_id, estado) VALUES (1, 1, 1, 'activa');
    `);
    seed.close();

    const documentPath = join(persistenceRoot, "actividad-sonda-01.json");
    const writeDocumentFile = (document) => {
      writeFileSync(documentPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    };
    const document = canonicalDocument();
    writeDocumentFile(document);
    const base = ["--database", databasePath, "--json"];

    // 1. Validación sin tocar la base.
    const validate = runCli(["validate", documentPath, "--json"]);
    outputs.push(validate.output);
    assert.equal(validate.code, 0, validate.output);
    assert.equal(parseJsonReport(validate).status, "validated");

    const countActivities = () => {
      const db = new DatabaseSync(databasePath);
      const total = db.prepare("SELECT COUNT(*) AS total FROM actividades").get().total;
      db.close();
      return total;
    };
    assert.equal(countActivities(), 0, "validate nunca debe escribir");

    // 2. Simulación: informa created sin escribir.
    const dryRun = runCli(["publish:local", documentPath, ...base]);
    outputs.push(dryRun.output);
    assert.equal(dryRun.code, 0, dryRun.output);
    const dryReport = parseJsonReport(dryRun);
    assert.equal(dryReport.status, "created");
    assert.equal(dryReport.dryRun, true);
    assert.equal(countActivities(), 0, "la simulación no debe escribir");

    // 3. Publicación real.
    const projectionPath = join(persistenceRoot, "proyeccion.public.json");
    const created = runCli(["publish:local", documentPath, ...base, "--apply", "--emit-public", projectionPath]);
    outputs.push(created.output);
    assert.equal(created.code, 0, created.output);
    const createdReport = parseJsonReport(created);
    assert.equal(createdReport.status, "created");
    assert.equal(createdReport.totalPoints, 7);
    assert.equal(createdReport.questionsSummary.length, 3);
    assert.deepEqual(createdReport.postVerify, []);
    assert.ok(createdReport.activityId > 0);

    const inspect = new DatabaseSync(databasePath);
    const activity = inspect.prepare("SELECT * FROM actividades WHERE slug = ?1").get("actividad-sonda-01");
    assert.ok(activity);
    assert.equal(activity.puntaje_total, 7);
    assert.equal(activity.maximo_intentos, 2);
    assert.equal(activity.estado, "borrador");
    assert.equal(activity.mostrar_revision, 1);
    const questions = inspect.prepare("SELECT * FROM preguntas_actividad WHERE actividad_id = ?1 ORDER BY numero").all(activity.id);
    assert.equal(questions.length, 3);
    assert.equal(questions[0].clave_correccion_json, JSON.stringify({ modo: "opcion", correctas: ["a"] }));
    assert.equal(questions[1].clave_correccion_json, JSON.stringify({ modo: "seleccion-exacta", correctas: ["x", "z"] }));
    assert.equal(questions[2].clave_correccion_json, JSON.stringify({ modo: "texto-exacto", aceptadas: [SENTINEL] }));
    assert.equal(questions[0].opciones_json, JSON.stringify([
      { valor: "a", texto: "Opción A" }, { valor: "b", texto: "Opción B" }, { valor: "c", texto: "Opción C" },
    ]));
    assert.ok(questions[2].recursos_json.includes("\"type\":\"image\""));
    assert.equal(inspect.prepare("PRAGMA foreign_key_check").all().length, 0);
    inspect.close();
    t.diagnostic("publicación creada y verificada");
  } finally {
    removeQuietly(persistenceRoot);
    assert.deepEqual(
      outputs.filter((output) => output.includes(SENTINEL)),
      [],
      "ninguna salida del publicador debe contener valores aceptados",
    );
  }
});