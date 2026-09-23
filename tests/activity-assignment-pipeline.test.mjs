import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const projectRoot = process.cwd();
const wranglerPath = join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const cliPath = join(projectRoot, "scripts", "activity-assignment.mjs");

// Datos exclusivamente ficticios: ningún nombre, documento ni respuesta real.
const PERSONAL_MARKERS = ["sonda-uno", "Sonda Uno", "sonda-dos", "Sonda Dos", "clave_correccion", "respuesta_dada", "submission_id", "envio-ficticio", "Enunciado ficticio", "ordinal_efectivo"];

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

function runCli(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd: projectRoot, encoding: "utf8" });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function parseJsonReport(run) {
  const start = run.stdout.indexOf("{");
  assert.ok(start >= 0, `El informe no contiene JSON: ${run.output}`);
  return JSON.parse(run.stdout.slice(start));
}

function removeQuietly(directory) {
  try { rmSync(directory, { recursive: true, force: true }); } catch { /* Windows puede retener el directorio */ }
}

const OPEN = "2026-09-28T08:00:00-03:00";
const OPEN_UTC = "2026-09-28T11:00:00.000Z";
const CLOSE = "2026-10-02T23:59:00-03:00";
const CLOSE_UTC = "2026-10-03T02:59:00.000Z";

const assignment = (overrides = {}) => ({ groupCode: "1MF", enabled: true, opensAt: OPEN, closesAt: CLOSE, ...overrides });

function documentFor(slug, assignments, edition = { subjectCode: "programacion-prueba", year: 2026 }) {
  return {
    schemaVersion: 1,
    activity: { slug, edition },
    assignments,
    authoring: { createdBy: "prueba-automatica", version: 1 },
  };
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
    INSERT INTO usuarios (id, nombre_usuario, nombre_mostrado) VALUES
      (1, 'sonda-uno', 'Sonda Uno'),
      (2, 'sonda-dos', 'Sonda Dos');
    INSERT INTO usuario_roles (usuario_id, rol_id) VALUES (1, 1), (2, 1);
    INSERT INTO asignaturas (id, codigo, nombre) VALUES (1, 'programacion-prueba', 'Programación de prueba');
    INSERT INTO ediciones_anuales (id, asignatura_id, anio, nombre, estado) VALUES
      (1, 1, 2026, 'Edición de prueba', 'activa'),
      (2, 1, 2027, 'Edición siguiente', 'activa');
    INSERT INTO grupos (id, edicion_anual_id, codigo, nombre, estado) VALUES
      (1, 1, '1MF', 'Grupo 1MF', 'activo'),
      (2, 1, '1MG', 'Grupo 1MG', 'activo'),
      (3, 1, '1MH', 'Grupo 1MH', 'archivado'),
      (4, 2, '2MF', 'Grupo 2MF', 'activo'),
      (5, 1, '1MI', 'Grupo 1MI', 'activo');
    INSERT INTO inscripciones (id, usuario_id, grupo_id, estado) VALUES
      (1, 1, 1, 'activa'), (2, 2, 1, 'activa'), (3, 1, 2, 'activa');
    INSERT INTO actividades (id, slug, edicion_anual_id, unidad_codigo, tema, orden, titulo, descripcion, estado, puntaje_total, maximo_intentos) VALUES
      (1, 'variables-sonda-01', 1, 'unidad-1', 'Tema ficticio', 1, 'Actividad sonda activa', '', 'activa', 1, 2),
      (2, 'variables-sonda-02', 2, 'unidad-1', 'Tema ficticio', 1, 'Actividad de otra edición', '', 'activa', 1, 2),
      (3, 'variables-sonda-archivada', 1, 'unidad-1', 'Tema ficticio', 2, 'Actividad archivada', '', 'archivada', 1, 2),
      (4, 'variables-sonda-borrador', 1, 'unidad-1', 'Tema ficticio', 3, 'Actividad en borrador', '', 'borrador', 1, 2);
    INSERT INTO preguntas_actividad (id, actividad_id, numero, tipo, enunciado, opciones_json, puntaje) VALUES
      (1, 1, 1, 'radio', 'Enunciado ficticio', '[{"valor":"a","texto":"A"},{"valor":"b","texto":"B"}]', 1);
    INSERT INTO habilitaciones_actividad (id, actividad_id, grupo_id, habilitada) VALUES
      (1, 1, 1, 1),
      (2, 1, 2, 0);
    INSERT INTO intentos_actividad (id, actividad_id, habilitacion_id, usuario_id, numero_intento, ordinal_efectivo, estado, puntaje_obtenido, puntaje_total, porcentaje, juicio, devolucion, submission_id) VALUES
      (1, 1, 1, 1, 1, 1, 'en_progreso', 0, 1, 0, 'inicial', '', 'envio-ficticio-1'),
      (2, 1, 1, 2, 1, 1, 'en_progreso', 0, 1, 0, 'inicial', '', 'envio-ficticio-2');
    INSERT INTO respuestas_intento_actividad (intento_id, pregunta_id, numero_pregunta, tipo_pregunta, enunciado_snapshot, respuesta_dada_json, respuesta_normalizada_json, correcta, puntaje_obtenido) VALUES
      (2, 1, 1, 'radio', 'Enunciado ficticio', '"a"', '"a"', 1, 1);
    UPDATE intentos_actividad SET estado = 'enviado', puntaje_obtenido = 1, porcentaje = 100, juicio = 'logrado' WHERE id = 2;
    INSERT INTO intentos_actividad (id, actividad_id, habilitacion_id, usuario_id, numero_intento, ordinal_efectivo, estado, puntaje_obtenido, puntaje_total, porcentaje, juicio, devolucion, submission_id) VALUES
      (3, 1, 1, 2, 2, 2, 'en_progreso', 0, 1, 0, 'inicial', '', 'envio-ficticio-3');
    UPDATE intentos_actividad SET estado = 'anulado' WHERE id = 3;
  `);
  seed.close();
  return { persistenceRoot, databasePath };
}

test("pipeline local de asignación: resolución, dry-run, apply, idempotencia y post-verify", async (t) => {
  const { persistenceRoot, databasePath } = createEnvironment("profemacon-assignment-");
  const outputs = [];
  const documentPath = join(persistenceRoot, "asignacion-sonda.json");
  const writeDocument = (document) => writeFileSync(documentPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

  const withDatabase = (sql, args = []) => {
    const db = new DatabaseSync(databasePath);
    try { return db.prepare(sql).all(...args); } finally { db.close(); }
  };
  const assignments = () => withDatabase("SELECT id, actividad_id, grupo_id, habilitada, disponible_desde, disponible_hasta, creada_en FROM habilitaciones_actividad ORDER BY id");
  const foreignCounts = () => Object.fromEntries(["actividades", "preguntas_actividad", "intentos_actividad", "respuestas_intento_actividad", "calificaciones_actividad", "grupos", "usuarios", "inscripciones", "publicaciones_contenido", "contenidos"]
    .map((table) => [table, withDatabase(`SELECT COUNT(*) AS total FROM ${table}`)[0].total]));
  const attempts = () => withDatabase("SELECT id, estado, puntaje_obtenido, porcentaje, juicio, submission_id FROM intentos_actividad ORDER BY id");
  const run = (args) => { const result = runCli([...args, "--database", databasePath]); outputs.push(result.output); return result; };

  try {
    const baseline = assignments();
    const baselineForeign = foreignCounts();
    const baselineAttempts = attempts();

    // 1. `validate` no abre la base: sólo comprueba el contrato.
    writeDocument(documentFor("variables-sonda-01", [assignment(), assignment({ groupCode: "1MG" })]));
    const validate = runCli(["validate", documentPath, "--json"]);
    outputs.push(validate.output);
    assert.equal(validate.code, 0, validate.output);
    assert.equal(parseJsonReport(validate).status, "validated");
    assert.deepEqual(assignments(), baseline, "validate nunca debe escribir");

    // 2. Simulación: informa la actualización sin escribir.
    const dryRun = run(["assign:local", documentPath, "--json"]);
    assert.equal(dryRun.code, 0, dryRun.output);
    const dryReport = parseJsonReport(dryRun);
    assert.equal(dryReport.status, "updated");
    assert.equal(dryReport.dryRun, true);
    assert.deepEqual(dryReport.summary, { create: 0, update: 2, unchanged: 0 });
    assert.deepEqual(dryReport.groups.map((group) => [group.groupCode, group.action, group.changedFields]), [
      ["1MF", "update", ["opensAt", "closesAt"]],
      ["1MG", "update", ["enabled", "opensAt", "closesAt"]],
    ]);
    assert.deepEqual(dryReport.groups[0].current, { enabled: true, opensAt: null, closesAt: null });
    assert.deepEqual(dryReport.groups[0].desired, { enabled: true, opensAt: OPEN_UTC, closesAt: CLOSE_UTC });
    assert.deepEqual(dryReport.history, { drafts: 1, submitted: 1, annulled: 1 });
    assert.deepEqual(assignments(), baseline, "la simulación no debe escribir");
    t.diagnostic("simulación sin escritura verificada");

    // 3. Aplicación real con ventanas UTC exactas y un alta.
    writeDocument(documentFor("variables-sonda-01", [assignment(), assignment({ groupCode: "1MG" }), assignment({ groupCode: "1MI", enabled: false, opensAt: null, closesAt: null })]));
    const applied = run(["assign:local", documentPath, "--json", "--apply"]);
    assert.equal(applied.code, 0, applied.output);
    const appliedReport = parseJsonReport(applied);
    assert.equal(appliedReport.status, "mixed");
    assert.deepEqual(appliedReport.summary, { create: 1, update: 2, unchanged: 0 });
    assert.deepEqual(appliedReport.postVerify, []);
    assert.equal(appliedReport.activity.slug, "variables-sonda-01");
    assert.equal(appliedReport.activity.editorialState, "activa");

    const afterApply = assignments();
    assert.equal(afterApply.length, 3, "debe existir una sola fila por actividad y grupo");
    const first = afterApply.find((row) => row.grupo_id === 1);
    const second = afterApply.find((row) => row.grupo_id === 2);
    const created = afterApply.find((row) => row.grupo_id === 5);
    assert.deepEqual([first.habilitada, first.disponible_desde, first.disponible_hasta], [1, OPEN_UTC, CLOSE_UTC]);
    assert.deepEqual([second.habilitada, second.disponible_desde, second.disponible_hasta], [1, OPEN_UTC, CLOSE_UTC]);
    assert.deepEqual([created.habilitada, created.disponible_desde, created.disponible_hasta], [0, null, null]);
    assert.deepEqual(foreignCounts(), baselineForeign, "no debe cambiar ninguna tabla ajena");
    assert.equal(withDatabase("PRAGMA foreign_key_check").length, 0);
    t.diagnostic("aplicación creada y verificada");

    // 4. Idempotencia: repetir el mismo archivo no escribe ni toca `creada_en`.
    const beforeRepeat = assignments();
    const repeated = run(["assign:local", documentPath, "--json", "--apply"]);
    assert.equal(repeated.code, 0, repeated.output);
    const repeatedReport = parseJsonReport(repeated);
    assert.equal(repeatedReport.status, "unchanged");
    assert.deepEqual(repeatedReport.summary, { create: 0, update: 0, unchanged: 3 });
    assert.deepEqual(repeatedReport.groups.map((group) => group.changedFields), [[], [], []]);
    assert.deepEqual(assignments(), beforeRepeat, "la segunda aplicación no debe modificar filas ni `creada_en`");
    t.diagnostic("idempotencia verificada");
    // 5. Blockers de resolución: todos se rechazan sin escribir.
    const blockers = [
      ["variables-sonda-99", [assignment()], { subjectCode: "programacion-prueba", year: 2026 }, "ACTIVITY_NOT_FOUND"],
      ["variables-sonda-01", [assignment()], { subjectCode: "otra-asignatura", year: 2026 }, "EDITION_NOT_FOUND"],
      ["variables-sonda-02", [assignment()], { subjectCode: "programacion-prueba", year: 2026 }, "EDITION_MISMATCH"],
      ["variables-sonda-archivada", [assignment()], { subjectCode: "programacion-prueba", year: 2026 }, "ACTIVITY_ARCHIVED"],
      ["variables-sonda-01", [assignment({ groupCode: "9ZZ" })], { subjectCode: "programacion-prueba", year: 2026 }, "GROUP_NOT_FOUND"],
      ["variables-sonda-01", [assignment({ groupCode: "2MF" })], { subjectCode: "programacion-prueba", year: 2026 }, "GROUP_NOT_IN_EDITION"],
      ["variables-sonda-01", [assignment({ groupCode: "1MH" })], { subjectCode: "programacion-prueba", year: 2026 }, "GROUP_ARCHIVED"],
    ];
    const beforeBlockers = assignments();
    for (const [slug, list, edition, code] of blockers) {
      writeDocument(documentFor(slug, list, edition));
      const result = run(["assign:local", documentPath, "--json", "--apply"]);
      assert.equal(result.code, 2, `${code}: ${result.output}`);
      const report = parseJsonReport(result);
      assert.equal(report.status, "rejected");
      assert.ok(report.errors.some((issue) => issue.code === code), `${code} en ${JSON.stringify(report.errors.map((issue) => issue.code))}`);
      assert.deepEqual(report.postVerify, []);
    }
    assert.deepEqual(assignments(), beforeBlockers, "ningún blocker debe escribir");
    t.diagnostic("blockers sin escritura verificados");

    // 6. Actividad en borrador: advertencia, nunca bloqueo.
    writeDocument(documentFor("variables-sonda-borrador", [assignment({ groupCode: "1MI" })]));
    const draftRun = run(["assign:local", documentPath, "--json"]);
    assert.equal(draftRun.code, 0, draftRun.output);
    const draftReport = parseJsonReport(draftRun);
    assert.equal(draftReport.activity.editorialState, "borrador");
    assert.ok(draftReport.warnings.some((issue) => issue.code === "ACTIVITY_NOT_ACTIVE"));

    // 7. Atomicidad: un grupo válido y uno inválido no aplican ningún cambio.
    writeDocument(documentFor("variables-sonda-01", [assignment({ groupCode: "1MG", enabled: false, opensAt: null, closesAt: null }), assignment({ groupCode: "9ZZ" })]));
    const atomicBefore = assignments();
    const atomic = run(["assign:local", documentPath, "--json", "--apply"]);
    assert.equal(atomic.code, 2, atomic.output);
    assert.deepEqual(assignments(), atomicBefore, "la transacción debe ser atómica");
    t.diagnostic("atomicidad verificada");

    // 8. Historia: deshabilitar y quitar la ventana avisa, aplica y no toca intentos.
    const answersBefore = withDatabase("SELECT id, correcta, puntaje_obtenido FROM respuestas_intento_actividad ORDER BY id");
    writeDocument(documentFor("variables-sonda-01", [assignment({ enabled: false, opensAt: null, closesAt: null })]));
    const historyRun = run(["assign:local", documentPath, "--json", "--apply"]);
    assert.equal(historyRun.code, 0, historyRun.output);
    const historyReport = parseJsonReport(historyRun);
    assert.deepEqual(historyReport.history, { drafts: 1, submitted: 1, annulled: 1 });
    assert.deepEqual(historyReport.warnings.map((issue) => issue.code).sort(), ["DISABLE_WITH_DRAFTS", "DISABLE_WITH_SUBMITTED", "WINDOW_REMOVED_WITH_HISTORY"]);
    const disabled = assignments().find((row) => row.grupo_id === 1);
    assert.deepEqual([disabled.habilitada, disabled.disponible_desde, disabled.disponible_hasta], [0, null, null]);
    assert.deepEqual(attempts(), baselineAttempts, "los intentos no se tocan");
    assert.deepEqual(withDatabase("SELECT id, correcta, puntaje_obtenido FROM respuestas_intento_actividad ORDER BY id"), answersBefore);
    t.diagnostic("política con historia verificada");

    // 9. Reapertura con apertura futura: advertencia y persistencia exacta en UTC.
    writeDocument(documentFor("variables-sonda-01", [assignment({ enabled: true, opensAt: "2026-10-10T08:00:00-03:00", closesAt: "2026-10-20T23:59:00-03:00" })]));
    const reopen = run(["assign:local", documentPath, "--json", "--apply"]);
    assert.equal(reopen.code, 0, reopen.output);
    const reopenReport = parseJsonReport(reopen);
    assert.deepEqual(reopenReport.groups[0].changedFields, ["enabled", "opensAt", "closesAt"]);
    assert.deepEqual(reopenReport.warnings.map((issue) => issue.code), ["OPENING_IN_FUTURE_WITH_DRAFTS"]);
    const reopened = assignments().find((row) => row.grupo_id === 1);
    assert.deepEqual([reopened.habilitada, reopened.disponible_desde, reopened.disponible_hasta], [1, "2026-10-10T11:00:00.000Z", "2026-10-21T02:59:00.000Z"]);
    t.diagnostic("reapertura verificada");

    // 10. El pipeline nunca elimina filas y su salida no contiene datos privados.
    assert.ok(assignments().length >= baseline.length, "el pipeline nunca elimina habilitaciones");
    assert.deepEqual(foreignCounts(), baselineForeign, "ninguna tabla ajena debe cambiar");
    assert.equal(withDatabase("PRAGMA foreign_key_check").length, 0);
    const leaked = outputs.filter((output) => PERSONAL_MARKERS.some((marker) => output.includes(marker)));
    assert.deepEqual(leaked, [], "la salida no debe contener nombres, respuestas ni identificadores de envío");
    t.diagnostic("salida segura verificada");
  } finally {
    removeQuietly(persistenceRoot);
  }
});

test("validate no abre la base y rechaza documentos fuera del contrato", () => {
  const directory = mkdtempSync(join(tmpdir(), "profemacon-assignment-validate-"));
  const documentPath = join(directory, "documento.json");
  const writeDocument = (value) => writeFileSync(documentPath, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    writeDocument({ ...documentFor("variables-sonda-01", [assignment()]), extra: true });
    const unknown = runCli(["validate", documentPath, "--json"]);
    assert.equal(unknown.code, 1, unknown.output);
    assert.equal(parseJsonReport(unknown).status, "rejected");
    assert.ok(parseJsonReport(unknown).errors.some((issue) => issue.code === "UNKNOWN_KEY"));

    writeDocument({ ...documentFor("variables-sonda-01", [assignment()]), activity: { slug: "variables-sonda-01", edition: { subjectCode: "programacion-prueba", year: 2026 }, maxAttempts: 2 } });
    const maxAttempts = runCli(["validate", documentPath, "--json"]);
    assert.equal(maxAttempts.code, 1, maxAttempts.output);
    assert.ok(parseJsonReport(maxAttempts).errors.some((issue) => issue.code === "UNKNOWN_KEY" && issue.message.includes("6A")));

    writeDocument("{ no es json");
    const broken = runCli(["validate", documentPath, "--json"]);
    assert.equal(broken.code, 1, broken.output);
    assert.ok(parseJsonReport(broken).errors.some((issue) => issue.code === "INVALID_JSON"));

    // Un BOM UTF-8 (Notepad, PowerShell) no debe invalidar un documento correcto.
    writeFileSync(documentPath, `\uFEFF${JSON.stringify(documentFor("variables-sonda-01", [assignment()]), null, 2)}\n`, "utf8");
    const withBom = runCli(["validate", documentPath, "--json"]);
    assert.equal(withBom.code, 0, withBom.output);
    assert.equal(parseJsonReport(withBom).status, "validated");

    const missing = runCli(["validate", join(directory, "no-existe.json"), "--json"]);
    assert.equal(missing.code, 1, missing.output);
  } finally {
    removeQuietly(directory);
  }
});


