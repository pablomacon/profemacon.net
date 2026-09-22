#!/usr/bin/env node
// Pipeline local de autoría y publicación de actividades mediante JSON canónico.
//
//   npm run activity:validate -- <archivo.json>
//   npm run activity:publish:local -- <archivo.json> [--apply] [--emit-public <ruta>]
//
// Escribe exclusivamente en la D1 local indicada por `--persist-to` (por defecto
// `.wrangler`) y sólo toca las tablas `actividades` y `preguntas_actividad`.
// Nunca imprime claves privadas de corrección ni valores del `grading`.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  MAX_DOCUMENT_BYTES,
  parseActivityDocument,
  publicProjectionOf,
  validateStoredGradingKey,
} from "../worker/activity-authoring.ts";

const EXIT_OK = 0;
const EXIT_VALIDATION = 1;
const EXIT_REJECTED = 2;
const EXIT_USAGE = 3;

const METADATA_ONLY_FIELDS = ["tags", "authoring"];

const USAGE = `Uso:
  node scripts/activity-authoring.mjs validate <archivo.json> [--json]
  node scripts/activity-authoring.mjs publish:local <archivo.json> [opciones]

Opciones de publish:local:
  --apply                                  escribe en D1 (por defecto sólo simula)
  --emit-public <ruta>                     escribe la proyección pública sin grading
  --allow-content-change-with-history      permite cambiar contenido si ya hay intentos
  --persist-to <dir>                       directorio de persistencia local (por defecto .wrangler)
  --database <archivo.sqlite>               ruta explícita a la base local
  --json                                   informe en JSON
`;

function parseArguments(argv) {
  const [command, documentPath, ...rest] = argv;
  const options = {
    command,
    documentPath,
    json: false,
    apply: false,
    allowContentChangeWithHistory: false,
    emitPublicPath: null,
    persistTo: ".wrangler",
    databasePath: null,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === "--json") options.json = true;
    else if (flag === "--apply") options.apply = true;
    else if (flag === "--allow-content-change-with-history") options.allowContentChangeWithHistory = true;
    else if (flag === "--emit-public") options.emitPublicPath = rest[++index] ?? null;
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
  const candidates = [
    join(persistTo, "state", "v3", "d1", "miniflare-D1DatabaseObject"),
    persistTo,
  ];
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
    throw new Error(`No se encontró una base D1 local en ${resolve(persistTo)}. Ejecutá «npm run db:migrate:local» primero.`);
  }
  found.sort((left, right) => right.size - left.size);
  return found[0].path;
}

function readDocument(documentPath) {
  if (!documentPath) throw new Error("Indicá el archivo JSON de la actividad.");
  if (!existsSync(documentPath)) throw new Error(`No existe el archivo: ${documentPath}`);
  const size = statSync(documentPath).size;
  if (size > MAX_DOCUMENT_BYTES) {
    return {
      parse: {
        ok: false,
        issues: [{ severity: "error", code: "DOCUMENT_TOO_LARGE", path: "", message: `El documento supera ${MAX_DOCUMENT_BYTES} bytes.` }],
        errors: [{ severity: "error", code: "DOCUMENT_TOO_LARGE", path: "", message: "Documento demasiado grande." }],
        warnings: [],
        notes: [],
        parsed: null,
      },
      raw: null,
    };
  }
  const text = readFileSync(documentPath, "utf8");
  let raw = null;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      parse: {
        ok: false,
        issues: [{ severity: "error", code: "INVALID_JSON", path: "", message: `El archivo no contiene JSON válido: ${error.message}` }],
        errors: [{ severity: "error", code: "INVALID_JSON", path: "", message: "JSON inválido." }],
        warnings: [],
        notes: [],
        parsed: null,
      },
      raw: null,
    };
  }
  return { parse: parseActivityDocument(raw), raw };
}

// ---- Hechos de D1 ------------------------------------------------------------
function loadFacts(db, parsed) {
  const edition = db.prepare(`
    SELECT ea.id, ea.anio, a.codigo AS subjectCode
    FROM ediciones_anuales ea
    JOIN asignaturas a ON a.id = ea.asignatura_id
    WHERE a.codigo = ?1 COLLATE NOCASE AND ea.anio = ?2
  `).get(parsed.edition.subjectCode, parsed.edition.year);

  const activity = db.prepare(`
    SELECT id, slug, edicion_anual_id, unidad_codigo, orden, titulo, descripcion, tema, estado,
           puntaje_total, maximo_intentos, umbral_aprobacion, umbral_destacado, mostrar_revision
    FROM actividades WHERE slug = ?1 COLLATE NOCASE
  `).get(parsed.activity.slug);

  const empty = { questions: [], attempts: [], habilitations: 0, grades: 0, snapshots: 0, answers: 0 };
  // El conflicto de orden se evalúa siempre: importa sobre todo al crear.
  const orderConflicts = db.prepare(`
    SELECT slug FROM actividades
    WHERE edicion_anual_id = ?1 AND unidad_codigo = ?2 AND orden = ?3 AND slug <> ?4 COLLATE NOCASE
  `).all(edition ? edition.id : -1, parsed.activity.unidadCodigo, parsed.activity.orden, parsed.activity.slug);
  const foreignTables = foreignTableCounts(db);

  if (!activity) return { edition, activity: null, orderConflicts, foreignTables, ...empty };

  return {
    edition,
    activity,
    orderConflicts,
    foreignTables,
    questions: db.prepare(`
      SELECT numero, tipo, enunciado, instrucciones, opciones_json, recursos_json, placeholder,
             puntaje, clave_correccion_json, retroalimentacion_correcta,
             retroalimentacion_incorrecta, explicacion_revision_final
      FROM preguntas_actividad WHERE actividad_id = ?1 ORDER BY numero
    `).all(activity.id),
    attempts: db.prepare("SELECT estado, COUNT(*) AS total FROM intentos_actividad WHERE actividad_id = ?1 GROUP BY estado").all(activity.id),
    habilitations: db.prepare("SELECT COUNT(*) AS total FROM habilitaciones_actividad WHERE actividad_id = ?1").get(activity.id).total,
    grades: db.prepare("SELECT COUNT(*) AS total FROM calificaciones_actividad WHERE actividad_id = ?1").get(activity.id).total,
    snapshots: db.prepare(`
      SELECT COUNT(*) AS total FROM preguntas_intento_actividad p
      JOIN intentos_actividad i ON i.id = p.intento_id WHERE i.actividad_id = ?1
    `).get(activity.id).total,
    answers: db.prepare(`
      SELECT COUNT(*) AS total FROM respuestas_intento_actividad r
      JOIN intentos_actividad i ON i.id = r.intento_id WHERE i.actividad_id = ?1
    `).get(activity.id).total,
  };
}

const ATTEMPT_STATES = ["en_progreso", "enviado", "anulado"];

// Tablas que el publicador nunca debe tocar. Se comparan antes y después.
const FOREIGN_TABLES = [
  "habilitaciones_actividad",
  "intentos_actividad",
  "respuestas_intento_actividad",
  "preguntas_intento_actividad",
  "calificaciones_actividad",
  "grupos",
  "usuarios",
  "inscripciones",
  "contenidos",
  "publicaciones_contenido",
];

function foreignTableCounts(db) {
  const counts = {};
  for (const table of FOREIGN_TABLES) {
    counts[table] = db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total;
  }
  return counts;
}

function attemptCounts(facts) {
  const counts = { en_progreso: 0, enviado: 0, anulado: 0 };
  for (const row of facts.attempts) counts[row.estado] = row.total;
  return counts;
}

const ACTIVITY_FIELDS = [
  ["titulo", "titulo"],
  ["descripcion", "descripcion"],
  ["tema", "tema"],
  ["unidad_codigo", "unidadCodigo"],
  ["orden", "orden"],
  ["estado", "estado"],
  ["puntaje_total", "puntajeTotal"],
  ["maximo_intentos", "maximoIntentos"],
  ["umbral_aprobacion", "umbralAprobacion"],
  ["umbral_destacado", "umbralDestacado"],
  ["mostrar_revision", "mostrarRevision"],
];

function diffQuestions(current, desired) {
  const remaining = new Map(current.map((question) => [question.numero, question]));
  const summary = [];
  const added = [];
  const changed = [];
  const optionCount = (json) => {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  };

  for (const want of desired) {
    const have = remaining.get(want.numero);
    const options = optionCount(want.opcionesJson);
    if (!have) {
      added.push(want.numero);
      summary.push({ number: want.numero, type: want.tipo, points: want.puntaje, options, status: "added" });
      continue;
    }
    remaining.delete(want.numero);
    const fields = [];
    if (have.tipo !== want.tipo) fields.push("tipo");
    if (have.enunciado !== want.enunciado) fields.push("enunciado");
    if (have.instrucciones !== want.instrucciones) fields.push("instrucciones");
    if (have.opciones_json !== want.opcionesJson) fields.push("opciones");
    if (have.recursos_json !== want.recursosJson) fields.push("recursos");
    if ((have.placeholder ?? null) !== want.placeholder) fields.push("placeholder");
    if (have.puntaje !== want.puntaje) fields.push("puntaje");
    if (have.clave_correccion_json !== want.claveCorreccionJson) fields.push("clave_correccion_json");
    if (have.retroalimentacion_correcta !== want.retroalimentacionCorrecta) fields.push("retroalimentacion_correcta");
    if (have.retroalimentacion_incorrecta !== want.retroalimentacionIncorrecta) fields.push("retroalimentacion_incorrecta");
    if ((have.explicacion_revision_final ?? null) !== want.explicacionRevisionFinal) fields.push("explicacion_revision_final");
    if (fields.length > 0) changed.push({ number: want.numero, fields });
    summary.push({
      number: want.numero,
      type: want.tipo,
      points: want.puntaje,
      options,
      status: fields.length > 0 ? "changed" : "unchanged",
      fields: fields.length > 0 ? fields : undefined,
    });
  }

  const removed = [...remaining.keys()].sort((left, right) => left - right);
  return {
    summary,
    added,
    removed,
    changed,
    contentChanges: added.length > 0 || removed.length > 0 || changed.length > 0,
  };
}

function diffActivity(current, parsed) {
  if (!current) return [];
  const changed = [];
  for (const [column, key] of ACTIVITY_FIELDS) {
    if (current[column] !== parsed.activity[key]) changed.push(column);
  }
  return changed;
}

// ---- Política de publicación -------------------------------------------------
function evaluatePolicy(facts, parsed, diff, options) {
  const blockers = [];
  const warnings = [];
  const counts = attemptCounts(facts);
  const attemptsTotal = counts.en_progreso + counts.enviado + counts.anulado;
  const block = (code, message) => blockers.push({ code, message });
  const warn = (code, message) => warnings.push({ code, message });
  const current = facts.activity;

  if (!facts.edition) {
    block("EDITION_NOT_FOUND", `No existe la edición ${parsed.edition.subjectCode} ${parsed.edition.year}. El pipeline no crea asignaturas ni ediciones.`);
  }
  if (current && facts.edition && current.edicion_anual_id !== facts.edition.id) {
    block("EDITION_MISMATCH", `El slug ${parsed.activity.slug} ya existe en otra edición anual. El pipeline nunca mueve una actividad de edición: usá otro slug, por ejemplo agregando el año (${parsed.activity.slug}-${parsed.edition.year}).`);
  }
  if (current && current.unidad_codigo !== parsed.activity.unidadCodigo) {
    block("UNIT_CHANGE_NOT_ALLOWED", "Cambiar de unidad una actividad existente no está permitido en v1.");
  }
  if (facts.orderConflicts.length > 0) {
    block("ORDER_CONFLICT", `El orden ${parsed.activity.orden} de ${parsed.activity.unidadCodigo} ya está usado por: ${facts.orderConflicts.map((row) => row.slug).join(", ")}.`);
  }

  if (current && attemptsTotal > 0) {
    if (current.maximo_intentos !== parsed.activity.maximoIntentos) {
      block("MAX_ATTEMPTS_CHANGE_BLOCKED", "No se puede cambiar maxAttempts si la actividad ya tiene intentos.");
    }
    if (diff.questions.removed.length > 0) {
      block("REMOVING_QUESTIONS_WITH_ATTEMPTS", `No se pueden eliminar preguntas con intentos existentes (números ${diff.questions.removed.join(", ")}).`);
    }
    if (diff.questions.contentChanges && !options.allowContentChangeWithHistory) {
      block("CONTENT_CHANGE_BLOCKED", "Hay cambios de contenido con intentos existentes: sólo se admite metadata segura. Repetí con --allow-content-change-with-history si querés aplicar el contenido igual.");
    }
    if (diff.questions.contentChanges && options.allowContentChangeWithHistory) {
      warn("CONTENT_CHANGE_WITH_HISTORY", `Se cambia contenido con ${attemptsTotal} intento(s) existente(s); los históricos conservan su snapshot.`);
    }
    if (diff.questions.added.length > 0) {
      warn("NEW_QUESTION_AFTER_ATTEMPTS", "Se agregan preguntas: los intentos nuevos tendrán un puntaje total mayor.");
    }
    if (counts.en_progreso > 0 && diff.questions.contentChanges) {
      warn("DRAFTS_USE_PREVIOUS_VERSION", `${counts.en_progreso} borrador(es) continuarán con la versión anterior.`);
    }
  }

  if (current && counts.enviado > 0) {
    if (current.umbral_aprobacion !== parsed.activity.umbralAprobacion || current.umbral_destacado !== parsed.activity.umbralDestacado) {
      warn("THRESHOLD_CHANGED_WITH_HISTORY", "Cambian los umbrales con intentos enviados; los juicios ya persistidos no se recalculan.");
    }
    if (current.mostrar_revision === 1 && parsed.activity.mostrarRevision === 0) {
      warn("REVIEW_DISABLED_WITH_HISTORY", "Se desactiva la revisión habiendo intentos enviados.");
    }
  }
  if (parsed.activity.estado === "activa" && facts.habilitations === 0) {
    warn("ACTIVE_WITHOUT_HABILITATION", "La actividad queda activa pero sin habilitación: sólo el preview docente podrá verla.");
  }

  return { blockers, warnings, attemptsTotal, counts };
}

// ---- Escritura transaccional y verificación posterior ------------------------
const QUESTION_UPDATE_SQL = `UPDATE preguntas_actividad
  SET tipo=?1, enunciado=?2, instrucciones=?3, opciones_json=?4, recursos_json=?5, placeholder=?6,
      puntaje=?7, clave_correccion_json=?8, retroalimentacion_correcta=?9,
      retroalimentacion_incorrecta=?10, explicacion_revision_final=?11
  WHERE actividad_id=?12 AND numero=?13`;

const QUESTION_INSERT_SQL = `INSERT INTO preguntas_actividad
  (actividad_id, numero, tipo, enunciado, instrucciones, opciones_json, recursos_json, placeholder,
   puntaje, clave_correccion_json, retroalimentacion_correcta, retroalimentacion_incorrecta,
   explicacion_revision_final)
  VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`;

function verifyAfterWrite(db, parsed, activityId, facts) {
  const issues = [];
  const activity = db.prepare(`
    SELECT id, slug, edicion_anual_id, unidad_codigo, orden, titulo, descripcion, tema, estado,
           puntaje_total, maximo_intentos, umbral_aprobacion, umbral_destacado, mostrar_revision
    FROM actividades WHERE id = ?1
  `).get(activityId);
  if (!activity) return [{ code: "POST_VERIFY_ACTIVITY_MISSING", message: "La actividad no quedó registrada." }];

  for (const [column, key] of ACTIVITY_FIELDS) {
    if (activity[column] !== parsed.activity[key]) {
      issues.push({ code: "POST_VERIFY_FIELD_MISMATCH", message: `El campo ${column} no coincide con el documento.` });
    }
  }
  const questions = db.prepare(`
    SELECT numero, tipo, puntaje, clave_correccion_json FROM preguntas_actividad
    WHERE actividad_id = ?1 ORDER BY numero
  `).all(activityId);
  if (questions.length !== parsed.questions.length) {
    issues.push({ code: "POST_VERIFY_QUESTION_COUNT", message: "La cantidad de preguntas no coincide con el documento." });
  }
  for (const question of parsed.questions) {
    const stored = questions.find((row) => row.numero === question.numero);
    if (!stored || stored.tipo !== question.tipo || stored.puntaje !== question.puntaje || stored.clave_correccion_json !== question.claveCorreccionJson) {
      issues.push({ code: "POST_VERIFY_QUESTION_MISMATCH", message: `La pregunta ${question.numero} no coincide con el documento.` });
    }
  }
  const sum = db.prepare("SELECT COALESCE(SUM(puntaje), 0) AS total FROM preguntas_actividad WHERE actividad_id = ?1").get(activityId).total;
  if (sum !== activity.puntaje_total) {
    issues.push({ code: "POST_VERIFY_TOTAL_POINTS", message: "El puntaje total de la actividad no coincide con la suma de sus preguntas." });
  }
  issues.push(...validateStoredGradingKey(questions.map((row) => ({
    numero: row.numero, tipo: row.tipo, puntaje: row.puntaje, claveCorreccionJson: row.clave_correccion_json,
  }))));

  const expectedNumbers = parsed.questions.map((question) => question.numero);
  const storedNumbers = questions.map((row) => row.numero);
  if (storedNumbers.join(",") !== expectedNumbers.join(",")) {
    issues.push({ code: "POST_VERIFY_NUMBERING", message: "La numeración de las preguntas no coincide con el documento." });
  }

  // Ninguna tabla ajena a la publicación puede cambiar de tamaño.
  const afterForeign = foreignTableCounts(db);
  for (const table of FOREIGN_TABLES) {
    if (afterForeign[table] !== facts.foreignTables[table]) {
      issues.push({ code: "POST_VERIFY_UNEXPECTED_WRITE", message: `El publicador modificó datos que no le corresponden (${table}).` });
    }
  }
  return issues;
}

function writeDocument(db, parsed, facts) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const activity = parsed.activity;
    let activityId;
    if (facts.activity) {
      activityId = facts.activity.id;
      db.prepare(`UPDATE actividades
        SET titulo=?1, descripcion=?2, tema=?3, unidad_codigo=?4, orden=?5, estado=?6, puntaje_total=?7,
            maximo_intentos=?8, umbral_aprobacion=?9, umbral_destacado=?10, mostrar_revision=?11,
            actualizada_en=CURRENT_TIMESTAMP
        WHERE id=?12`).run(
        activity.titulo, activity.descripcion, activity.tema, activity.unidadCodigo, activity.orden,
        activity.estado, activity.puntajeTotal, activity.maximoIntentos, activity.umbralAprobacion,
        activity.umbralDestacado, activity.mostrarRevision, activityId,
      );
    } else {
      const inserted = db.prepare(`INSERT INTO actividades
        (slug, edicion_anual_id, unidad_codigo, tema, orden, titulo, descripcion, estado,
         puntaje_total, maximo_intentos, umbral_aprobacion, umbral_destacado, mostrar_revision)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`).run(
        activity.slug, facts.edition.id, activity.unidadCodigo, activity.tema, activity.orden,
        activity.titulo, activity.descripcion, activity.estado, activity.puntajeTotal,
        activity.maximoIntentos, activity.umbralAprobacion, activity.umbralDestacado, activity.mostrarRevision,
      );
      activityId = Number(inserted.lastInsertRowid);
    }

    const existingNumbers = new Set(facts.questions.map((question) => question.numero));
    for (const question of parsed.questions) {
      if (existingNumbers.has(question.numero)) {
        db.prepare(QUESTION_UPDATE_SQL).run(
          question.tipo, question.enunciado, question.instrucciones, question.opcionesJson,
          question.recursosJson, question.placeholder, question.puntaje, question.claveCorreccionJson,
          question.retroalimentacionCorrecta, question.retroalimentacionIncorrecta,
          question.explicacionRevisionFinal, activityId, question.numero,
        );
      } else {
        db.prepare(QUESTION_INSERT_SQL).run(
          activityId, question.numero, question.tipo, question.enunciado, question.instrucciones,
          question.opcionesJson, question.recursosJson, question.placeholder, question.puntaje,
          question.claveCorreccionJson, question.retroalimentacionCorrecta,
          question.retroalimentacionIncorrecta, question.explicacionRevisionFinal,
        );
      }
    }

    const issues = verifyAfterWrite(db, parsed, activityId, facts);
    if (issues.length > 0) {
      db.exec("ROLLBACK");
      return { activityId: null, issues };
    }
    db.exec("COMMIT");
    return { activityId, issues: [] };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* la transacción ya estaba cerrada */ }
    throw error;
  }
}

// ---- Informe -----------------------------------------------------------------
function issueLine(issue) {
  return `${issue.severity.padEnd(7)} ${issue.code} ${issue.path || "-"}: ${issue.message}`;
}

function printReport(report, asJson) {
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Estado: ${report.status}${report.dryRun ? " (simulación, sin escrituras)" : ""}`);
  console.log(`Documento: ${report.document ?? "-"}`);
  if (report.database) console.log(`Base local: ${report.database}`);
  if (report.slug) {
    console.log(`Actividad: ${report.slug} · edición ${report.edition.subjectCode} ${report.edition.year} · ` +
      `${report.questions} preguntas · ${report.totalPoints} puntos · ${report.editorialState}`);
  }
  if (report.facts) {
    console.log(`Hechos: intentos=${report.facts.attempts} (borradores ${report.facts.drafts}, enviados ${report.facts.submitted}, ` +
      `anulados ${report.facts.annulled}) · habilitaciones=${report.facts.habilitations} · calificaciones=${report.facts.grades}`);
  }
  if (report.changes) {
    console.log(`Cambios: actividad=[${report.changes.activity.join(", ") || "sin cambios"}] · ` +
      `preguntas=[${report.changes.questions.map((row) => `${row.number}:${row.fields.join("+")}`).join(", ") || "sin cambios"}]`);
  }
  for (const issue of report.errors) console.log(issueLine(issue));
  if (report.databaseError) console.log(issueLine({ severity: "error", code: "DATABASE_ERROR", path: "", message: report.databaseError }));
  for (const issue of report.policyBlockers) console.log(issueLine({ severity: "error", ...issue, path: "" }));
  for (const issue of report.postVerify) console.log(issueLine({ severity: "error", ...issue, path: "" }));
  for (const issue of report.warnings) console.log(issueLine(issue));
  for (const issue of report.policyWarnings) console.log(issueLine({ severity: "warning", ...issue, path: "" }));
  for (const issue of report.notes) console.log(issueLine(issue));
  if (report.publicProjection.emitted) console.log(`Proyección pública: ${report.publicProjection.path}`);
}

function emptyReport(command, documentPath, dryRun) {
  return {
    status: "rejected",
    command,
    dryRun,
    document: documentPath ? resolve(documentPath) : null,
    database: null,
    activityId: null,
    slug: null,
    edition: null,
    unitCode: null,
    order: null,
    editorialState: null,
    questions: 0,
    totalPoints: 0,
    metadataOnlyFields: METADATA_ONLY_FIELDS,
    questionsSummary: [],
    facts: null,
    changes: null,
    errors: [],
    warnings: [],
    notes: [],
    policyBlockers: [],
    policyWarnings: [],
    postVerify: [],
    databaseError: null,
    publicProjection: { emitted: false, path: null },
  };
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    return EXIT_USAGE;
  }
  if (!options.command || options.command === "help") {
    console.log(USAGE);
    return EXIT_OK;
  }
  if (options.command !== "validate" && options.command !== "publish:local") {
    console.error(`Comando desconocido: ${options.command}`);
    console.error(USAGE);
    return EXIT_USAGE;
  }

  const dryRun = options.command === "validate" ? true : !options.apply;
  const report = emptyReport(options.command, options.documentPath, dryRun);

  let document;
  try {
    document = readDocument(options.documentPath);
  } catch (error) {
    console.error(error.message);
    return EXIT_USAGE;
  }

  const parse = document.parse;
  report.errors = parse.errors;
  report.warnings = parse.warnings;
  report.notes = parse.notes;
  if (!parse.ok || !parse.parsed) {
    printReport(report, options.json);
    return EXIT_VALIDATION;
  }

  const parsed = parse.parsed;
  report.slug = parsed.activity.slug;
  report.edition = { subjectCode: parsed.edition.subjectCode, year: parsed.edition.year, editionId: null };
  report.unitCode = parsed.activity.unidadCodigo;
  report.order = parsed.activity.orden;
  report.editorialState = parsed.activity.estado;
  report.questions = parsed.questions.length;
  report.totalPoints = parsed.totalPoints;

  if (options.command === "validate") {
    report.status = "validated";
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
    const facts = loadFacts(db, parsed);
    const diff = {
      activity: diffActivity(facts.activity, parsed),
      questions: diffQuestions(facts.questions, parsed.questions),
    };
    const policy = evaluatePolicy(facts, parsed, diff, options);

    report.edition.editionId = facts.edition ? facts.edition.id : null;
    report.facts = {
      attempts: policy.attemptsTotal,
      drafts: policy.counts.en_progreso,
      submitted: policy.counts.enviado,
      annulled: policy.counts.anulado,
      habilitations: facts.habilitations,
      grades: facts.grades,
      snapshots: facts.snapshots,
      answers: facts.answers,
      orderConflicts: facts.orderConflicts.map((row) => row.slug),
    };
    report.changes = {
      activity: diff.activity,
      questions: diff.questions.changed.map((row) => ({ number: row.number, fields: row.fields })),
    };
    report.questionsSummary = diff.questions.summary;
    report.policyBlockers = policy.blockers;
    report.policyWarnings = policy.warnings;

    if (policy.blockers.length > 0) {
      printReport(report, options.json);
      return EXIT_REJECTED;
    }

    report.status = !facts.activity
      ? "created"
      : (diff.activity.length === 0 && !diff.questions.contentChanges ? "unchanged" : "updated");

    if (!options.apply) {
      printReport(report, options.json);
      return EXIT_OK;
    }

    if (report.status === "unchanged") {
      report.activityId = facts.activity.id;
    } else {
      const result = writeDocument(db, parsed, facts);
      report.postVerify = result.issues;
      if (result.issues.length > 0) {
        report.status = "rejected";
        printReport(report, options.json);
        return EXIT_REJECTED;
      }
      report.activityId = result.activityId;
    }

    if (options.emitPublicPath) {
      const target = resolve(options.emitPublicPath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(publicProjectionOf(parsed), null, 2)}\n`, "utf8");
      report.publicProjection = { emitted: true, path: target };
    }

    printReport(report, options.json);
    return EXIT_OK;
  } catch (error) {
    report.status = "rejected";
    report.databaseError = `La base local rechazó la operación: ${error.message}`;
    printReport(report, options.json);
    return EXIT_REJECTED;
  } finally {
    db.close();
  }
}

process.exitCode = main();


