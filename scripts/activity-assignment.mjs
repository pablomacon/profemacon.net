#!/usr/bin/env node
// Pipeline local de asignación y habilitación de actividades por grupos (Hito 6C).
//
//   npm run activity:assign:validate -- <archivo.json>
//   npm run activity:assign:local    -- <archivo.json> [--apply] [--json]
//
// Escribe exclusivamente en la D1 local indicada por `--persist-to` (por defecto
// `.wrangler`) o por `--database`, y sólo toca la tabla
// `habilitaciones_actividad`. Nunca borra filas, nunca toca intentos, respuestas,
// snapshots ni calificaciones, y nunca imprime datos personales.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  MAX_ASSIGNMENT_DOCUMENT_BYTES,
  compareAssignmentState,
  compareDates,
  historyWarnings,
  parseAssignmentDocument,
  toD1Assignment,
} from "../worker/activity-assignment.ts";

const EXIT_OK = 0;
const EXIT_VALIDATION = 1;
const EXIT_REJECTED = 2;
const EXIT_USAGE = 3;

// Tablas que el pipeline nunca debe modificar. Se comparan antes y después.
const FOREIGN_TABLES = [
  "actividades",
  "preguntas_actividad",
  "intentos_actividad",
  "respuestas_intento_actividad",
  "preguntas_intento_actividad",
  "calificaciones_actividad",
  "grupos",
  "usuarios",
  "inscripciones",
  "publicaciones_contenido",
  "contenidos",
];

const USAGE = `Uso:
  node scripts/activity-assignment.mjs validate <archivo.json> [--json]
  node scripts/activity-assignment.mjs assign:local <archivo.json> [opciones]

Opciones de assign:local:
  --apply                 escribe en D1 (por defecto sólo simula)
  --json                  informe en JSON
  --persist-to <dir>      directorio de persistencia local (por defecto .wrangler)
  --database <archivo>    ruta explícita a la base local
`;

function parseArguments(argv) {
  const [command, documentPath, ...rest] = argv;
  const options = { command, documentPath, json: false, apply: false, persistTo: ".wrangler", databasePath: null };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === "--json") options.json = true;
    else if (flag === "--apply") options.apply = true;
    else if (flag === "--persist-to") options.persistTo = rest[++index] ?? ".wrangler";
    else if (flag === "--database") options.databasePath = rest[++index] ?? null;
    else if (flag === "--help" || flag === "-h") options.command = "help";
    else throw new Error(`Opción desconocida: ${flag}`);
  }
  return options;
}

function findDatabaseFile(persistTo, explicitPath) {
  if (explicitPath) {
    if (!existsSync(explicitPath)) throw new Error(`No existe la base indicada: ${explicitPath}`);
    return resolve(explicitPath);
  }
  const candidates = [join(persistTo, "state", "v3", "d1", "miniflare-D1DatabaseObject"), persistTo];
  const found = [];
  for (const directory of candidates) {
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory)) {
      if (!entry.endsWith(".sqlite")) continue;
      if (entry === "metadata.sqlite") continue;
      const path = join(directory, entry);
      found.push({ path, size: statSync(path).size });
    }
  }
  if (found.length === 0) {
    throw new Error(`No se encontró una base D1 local en ${resolve(persistTo)}. Ejecutá «npm run db:migrate:local» o indicá --database.`);
  }
  // Se elige la base más grande y se descarta el archivo de metadatos.
  found.sort((left, right) => right.size - left.size);
  return resolve(found[0].path);
}

function readDocument(documentPath) {
  if (!documentPath) throw new Error("Falta la ruta del documento JSON.");
  const absolute = resolve(documentPath);
  if (!existsSync(absolute)) throw new Error(`No existe el archivo indicado: ${absolute}`);
  if (statSync(absolute).size > MAX_ASSIGNMENT_DOCUMENT_BYTES) {
    throw new Error(`El documento supera el máximo de ${Math.round(MAX_ASSIGNMENT_DOCUMENT_BYTES / 1024)} KiB.`);
  }
  // Se tolera el BOM UTF-8 que agregan algunas herramientas de Windows.
  const source = readFileSync(absolute, "utf8").replace(/^\uFEFF/, "");
  try {
    return { absolute, document: JSON.parse(source) };
  } catch (error) {
    const failure = new Error(`El archivo no es JSON válido: ${error.message}`);
    failure.code = "INVALID_JSON";
    throw failure;
  }
}

function issueLine(issue) {
  return `${issue.severity.padEnd(7)} ${issue.code} ${issue.path || "-"}: ${issue.message}`;
}

function printReport(report, asJson) {
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Asignación de actividad: ${report.status}${report.dryRun ? " (simulación)" : ""}`);
  if (report.activity) console.log(`Actividad ${report.activity.slug} · estado editorial ${report.activity.editorialState ?? "-"}`);
  for (const group of report.groups ?? []) {
    console.log(`  ${group.groupCode} ${group.action}${group.changedFields.length ? ` [${group.changedFields.join(", ")}]` : ""}`);
  }
  if (report.summary) console.log(`Resumen: ${report.summary.create} creadas, ${report.summary.update} actualizadas, ${report.summary.unchanged} sin cambios`);
  for (const issue of [...(report.errors ?? []), ...(report.warnings ?? []), ...(report.postVerify ?? [])]) console.log(issueLine(issue));
}

// ---- Lectura de estado ------------------------------------------------------
function foreignTableCounts(db) {
  const counts = {};
  for (const table of FOREIGN_TABLES) counts[table] = db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total;
  return counts;
}

const countAssignments = (db, activityId) =>
  db.prepare("SELECT COUNT(*) AS total FROM habilitaciones_actividad WHERE actividad_id = ?1").get(activityId).total;

function resolveActivity(db, slug, edition) {
  const editionRow = db.prepare(`
    SELECT ea.id, ea.anio AS year, ea.nombre AS name, a.codigo AS subjectCode
    FROM ediciones_anuales ea JOIN asignaturas a ON a.id = ea.asignatura_id
    WHERE a.codigo = ?1 COLLATE NOCASE AND ea.anio = ?2
  `).get(edition.subjectCode, edition.year);
  const activityRow = db.prepare("SELECT id, slug, edicion_anual_id AS editionId, estado, maximo_intentos AS maxAttempts FROM actividades WHERE slug = ?1 COLLATE NOCASE").get(slug);

  const errors = [];
  const warnings = [];
  if (!editionRow) {
    errors.push({ severity: "error", code: "EDITION_NOT_FOUND", path: "activity.edition", message: `No existe la edición ${edition.subjectCode} ${edition.year}. El pipeline no crea asignaturas ni ediciones.` });
  }
  if (!activityRow) {
    errors.push({ severity: "error", code: "ACTIVITY_NOT_FOUND", path: "activity.slug", message: `No existe la actividad ${slug}. Publicá el contenido con el pipeline de autoría (Hito 6A) antes de asignarla.` });
  } else if (editionRow && activityRow.editionId !== editionRow.id) {
    errors.push({ severity: "error", code: "EDITION_MISMATCH", path: "activity.edition", message: `La actividad ${slug} ya existe en otra edición anual: el pipeline nunca la mueve de edición.` });
  } else if (activityRow.estado === "archivada") {
    errors.push({ severity: "error", code: "ACTIVITY_ARCHIVED", path: "activity.slug", message: "La actividad está archivada: no se asignan actividades archivadas." });
  } else if (activityRow.estado !== "activa") {
    warnings.push({ severity: "warning", code: "ACTIVITY_NOT_ACTIVE", path: "activity.slug", message: `La actividad está en estado «${activityRow.estado}»: se habilitará, pero los estudiantes seguirán viéndola deshabilitada hasta publicarla como activa.` });
  }
  return { edition: editionRow ?? null, activity: activityRow ?? null, errors, warnings };
}

function resolveGroups(db, editionId, assignments) {
  const rows = db.prepare("SELECT id, codigo AS code, estado FROM grupos WHERE edicion_anual_id = ?1").all(editionId);
  const byCode = new Map(rows.map((row) => [row.code.toLowerCase(), row]));
  const elsewhere = new Set();
  const missing = assignments.filter((assignment) => !byCode.has(assignment.groupKey));
  if (missing.length > 0) {
    const placeholders = missing.map((_, index) => `?${index + 1}`).join(",");
    const others = db.prepare(`SELECT DISTINCT codigo AS code FROM grupos WHERE codigo IN (${placeholders})`).all(...missing.map((assignment) => assignment.groupCode));
    for (const row of others) elsewhere.add(row.code.toLowerCase());
  }

  const resolved = [];
  const errors = [];
  assignments.forEach((assignment, index) => {
    const path = `assignments[${index}].groupCode`;
    const row = byCode.get(assignment.groupKey);
    if (!row) {
      errors.push(elsewhere.has(assignment.groupKey)
        ? { severity: "error", code: "GROUP_NOT_IN_EDITION", path, message: `El grupo ${assignment.groupCode} existe, pero en otra edición anual.` }
        : { severity: "error", code: "GROUP_NOT_FOUND", path, message: `No existe el grupo ${assignment.groupCode} en la edición de la actividad.` });
      return;
    }
    if (row.estado !== "activo") {
      errors.push({ severity: "error", code: "GROUP_ARCHIVED", path, message: `El grupo ${assignment.groupCode} está archivado.` });
      return;
    }
    resolved.push({ groupId: row.id, groupCode: assignment.groupCode, assignment });
  });
  return { resolved, errors };
}

function currentAssignment(db, activityId, groupId) {
  const row = db.prepare("SELECT id, habilitada, disponible_desde AS opensAt, disponible_hasta AS closesAt FROM habilitaciones_actividad WHERE actividad_id = ?1 AND grupo_id = ?2").get(activityId, groupId);
  if (!row) return { habilitationId: null, state: null };
  return { habilitationId: row.id, state: { enabled: row.habilitada === 1, opensAt: row.opensAt, closesAt: row.closesAt } };
}

function groupHistory(db, activityId, habilitationId) {
  const history = { drafts: 0, submitted: 0, annulled: 0 };
  if (!habilitationId) return history;
  const rows = db.prepare("SELECT estado, COUNT(*) AS total FROM intentos_actividad WHERE actividad_id = ?1 AND habilitacion_id = ?2 GROUP BY estado").all(activityId, habilitationId);
  for (const row of rows) {
    if (row.estado === "en_progreso") history.drafts = row.total;
    if (row.estado === "enviado") history.submitted = row.total;
    if (row.estado === "anulado") history.annulled = row.total;
  }
  return history;
}

// ---- Escritura transaccional y verificación posterior ------------------------
const INSERT_SQL = "INSERT INTO habilitaciones_actividad (actividad_id, grupo_id, habilitada, disponible_desde, disponible_hasta) VALUES (?1, ?2, ?3, ?4, ?5)";
const UPDATE_SQL = "UPDATE habilitaciones_actividad SET habilitada = ?1, disponible_desde = ?2, disponible_hasta = ?3 WHERE actividad_id = ?4 AND grupo_id = ?5";

function verifyAfterWrite(db, facts) {
  const issues = [];
  const push = (code, path, message) => issues.push({ severity: "error", code, path, message });

  for (const plan of facts.plans) {
    const rows = db.prepare("SELECT habilitada, disponible_desde AS opensAt, disponible_hasta AS closesAt FROM habilitaciones_actividad WHERE actividad_id = ?1 AND grupo_id = ?2").all(facts.activityId, plan.groupId);
    if (rows.length !== 1) {
      push("POST_VERIFY_ROW_MISSING", plan.groupCode, "No quedó exactamente una fila de habilitación para el grupo.");
      continue;
    }
    const stored = rows[0];
    if (stored.habilitada !== (plan.desired.enabled ? 1 : 0)) push("POST_VERIFY_FIELD_MISMATCH", plan.groupCode, "El estado habilitada/deshabilitada no coincide con el documento.");
    if (!compareDates(stored.opensAt, plan.desired.opensAt)) push("POST_VERIFY_FIELD_MISMATCH", plan.groupCode, "La apertura almacenada no coincide con el documento.");
    if (!compareDates(stored.closesAt, plan.desired.closesAt)) push("POST_VERIFY_FIELD_MISMATCH", plan.groupCode, "El cierre almacenado no coincide con el documento.");
    const coherent = db.prepare("SELECT 1 AS ok FROM actividades a JOIN grupos g ON g.id = ?2 WHERE a.id = ?1 AND a.edicion_anual_id = g.edicion_anual_id").get(facts.activityId, plan.groupId);
    if (!coherent) push("POST_VERIFY_EDITION_MISMATCH", plan.groupCode, "La actividad y el grupo dejaron de pertenecer a la misma edición anual.");
  }

  if (db.prepare("PRAGMA foreign_key_check").all().length > 0) {
    push("POST_VERIFY_FOREIGN_KEY", "", "Quedaron referencias inválidas en la base local.");
  }
  const after = foreignTableCounts(db);
  for (const table of FOREIGN_TABLES) {
    if (after[table] !== facts.foreignCounts[table]) push("POST_VERIFY_UNEXPECTED_WRITE", "", `El pipeline modificó datos que no le corresponden (${table}).`);
  }
  if (countAssignments(db, facts.activityId) < facts.assignmentsBefore) {
    push("POST_VERIFY_ROW_REMOVED", "", "El pipeline eliminó habilitaciones existentes.");
  }
  return issues;
}

function writeAssignments(db, facts) {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const plan of facts.plans) {
      if (plan.action === "unchanged") continue;
      const values = toD1Assignment(plan.desired);
      if (plan.action === "create") {
        db.prepare(INSERT_SQL).run(facts.activityId, plan.groupId, values.habilitada, values.disponibleDesde, values.disponibleHasta);
      } else {
        db.prepare(UPDATE_SQL).run(values.habilitada, values.disponibleDesde, values.disponibleHasta, facts.activityId, plan.groupId);
      }
    }
    const issues = verifyAfterWrite(db, facts);
    if (issues.length > 0) {
      db.exec("ROLLBACK");
      return { applied: false, issues };
    }
    db.exec("COMMIT");
    return { applied: true, issues: [] };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* la transacción ya estaba cerrada */ }
    throw error;
  }
}

// ---- Comando principal ------------------------------------------------------
function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    return EXIT_USAGE;
  }
  if (options.command === "help") { console.log(USAGE); return EXIT_OK; }
  if (options.command !== "validate" && options.command !== "assign:local") {
    console.error(`Comando desconocido: ${options.command ?? "(ninguno)"}`);
    console.error(USAGE);
    return EXIT_USAGE;
  }

  let loaded;
  try {
    loaded = readDocument(options.documentPath);
  } catch (error) {
    const report = { status: "rejected", dryRun: !options.apply, errors: [{ severity: "error", code: error.code ?? "INVALID_DOCUMENT", path: "", message: error.message }], warnings: [] };
    printReport(report, options.json);
    return EXIT_VALIDATION;
  }

  const parse = parseAssignmentDocument(loaded.document);
  const report = {
    status: "validated",
    dryRun: !options.apply,
    document: loaded.absolute,
    activity: null,
    groups: [],
    summary: { create: 0, update: 0, unchanged: 0 },
    history: { drafts: 0, submitted: 0, annulled: 0 },
    errors: [...parse.errors],
    warnings: [...parse.warnings],
    postVerify: [],
  };
  if (!parse.ok || !parse.parsed) {
    report.status = "rejected";
    printReport(report, options.json);
    return EXIT_VALIDATION;
  }

  const parsed = parse.parsed;
  report.activity = { slug: parsed.slug, edition: { ...parsed.edition }, editionId: null, editorialState: null, maxAttempts: null };
  if (options.command === "validate") {
    printReport(report, options.json);
    return EXIT_OK;
  }

  let databasePath;
  try {
    databasePath = findDatabaseFile(options.persistTo, options.databasePath);
  } catch (error) {
    console.error(error.message);
    return EXIT_USAGE;
  }
  report.database = databasePath;

  const db = new DatabaseSync(databasePath);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");

    const resolution = resolveActivity(db, parsed.slug, parsed.edition);
    report.errors.push(...resolution.errors);
    report.warnings.push(...resolution.warnings);
    if (resolution.edition) report.activity.editionId = resolution.edition.id;
    if (resolution.activity) {
      report.activity.editorialState = resolution.activity.estado;
      report.activity.maxAttempts = resolution.activity.maxAttempts;
    }
    if (resolution.errors.length > 0) {
      report.status = "rejected";
      printReport(report, options.json);
      return EXIT_REJECTED;
    }

    // Todos los grupos se resuelven antes de escribir: si uno falla, no se aplica ninguno.
    const groupResolution = resolveGroups(db, resolution.edition.id, parsed.assignments);
    report.errors.push(...groupResolution.errors);
    if (groupResolution.errors.length > 0) {
      report.status = "rejected";
      printReport(report, options.json);
      return EXIT_REJECTED;
    }

    const nowIso = new Date().toISOString();
    const plans = groupResolution.resolved.map((group, index) => {
      const current = currentAssignment(db, resolution.activity.id, group.groupId);
      const history = groupHistory(db, resolution.activity.id, current.habilitationId);
      const comparison = compareAssignmentState(current.state, group.assignment.state);
      report.history.drafts += history.drafts;
      report.history.submitted += history.submitted;
      report.history.annulled += history.annulled;
      report.warnings.push(...historyWarnings(current.state, group.assignment.state, history, nowIso)
        .map((issue) => ({ ...issue, path: `assignments[${index}].groupCode` })));
      return {
        groupId: group.groupId,
        groupCode: group.groupCode,
        action: comparison.action,
        changedFields: comparison.changedFields,
        current: current.state,
        desired: group.assignment.state,
      };
    });

    for (const plan of plans) report.summary[plan.action] += 1;
    report.status = report.summary.create + report.summary.update === 0
      ? "unchanged"
      : (report.summary.create > 0 && report.summary.update === 0 ? "created"
        : (report.summary.update > 0 && report.summary.create === 0 ? "updated" : "mixed"));
    report.groups = plans.map((plan) => ({
      groupCode: plan.groupCode, action: plan.action, current: plan.current, desired: plan.desired, changedFields: plan.changedFields,
    }));

    if (!options.apply) {
      printReport(report, options.json);
      return EXIT_OK;
    }

    const facts = {
      activityId: resolution.activity.id,
      plans,
      assignmentsBefore: countAssignments(db, resolution.activity.id),
      foreignCounts: foreignTableCounts(db),
    };
    const result = writeAssignments(db, facts);
    report.postVerify = result.issues;
    if (!result.applied) {
      report.status = "rejected";
      printReport(report, options.json);
      return EXIT_REJECTED;
    }
    printReport(report, options.json);
    return EXIT_OK;
  } catch (error) {
    report.status = "rejected";
    report.errors.push({ severity: "error", code: "DATABASE_ERROR", path: "", message: `La base local rechazó la operación: ${error.message}` });
    printReport(report, options.json);
    return EXIT_REJECTED;
  } finally {
    db.close();
  }
}

process.exitCode = main();

