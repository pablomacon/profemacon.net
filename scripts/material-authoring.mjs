#!/usr/bin/env node
// Pipeline local de autoría e instalación de materiales teóricos (Hito 6D-A).
//
//   npm run material:validate -- <archivo.md>
//   npm run material:install  -- <archivo.md> [--apply] [--with-images] [--force] [--check] [--json]
//
// Fuente (fuera del repositorio):
//   %USERPROFILE%\profemacon-authoring-private\materials\<asignatura>\<unidad>\<slug>\<slug>.md
//   %USERPROFILE%\profemacon-authoring-private\materials\<asignatura>\<unidad>\<slug>\img\
//
// Resultado publicable (dentro del repositorio):
//   content\<asignatura>\<unidad>\<slug>.md
//   assets\materiales\<asignatura>\<unidad>\<slug>\<imagen>
//
// Garantías de este corte:
//   · nunca escribe fuera de `content/` ni de `assets/materiales/`;
//   · nunca borra archivos (los huérfanos se informan, no se eliminan);
//   · por defecto sólo simula: hace falta `--apply` para escribir;
//   · no toca D1, ni endpoints, ni el frontend.
//
// Para pruebas, las raíces se pueden redirigir con variables de entorno
// (PROFEMACON_CONTENT_ROOT, PROFEMACON_ASSETS_ROOT, PROFEMACON_MATERIALS_ROOT).
// No son flags: el conjunto de flags de este corte está cerrado en cinco.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IMAGE_EXTENSIONS,
  MATERIAL_ASSET_PREFIX,
  POLICY_ISSUE_CODES,
  SUBJECT_CODE_PATTERN,
  UNIT_CODE_PATTERN,
  checkUnitConsistency,
  parseContentPath,
  parseMaterialDocument,
  sha256Hex,
  stripBom,
} from "../worker/material-authoring.ts";

const EXIT_OK = 0;
const EXIT_VALIDATION = 1;
const EXIT_REJECTED = 2;
const EXIT_USAGE = 3;

// Sufijo de los archivos temporales. Se escriben en el directorio destino para
// que el reemplazo por renombrado ocurra en el mismo volumen.
const TEMP_SUFFIX = ".pm-material.tmp";

const FLAGS = ["--apply", "--with-images", "--force", "--json", "--check"];

const USAGE = `Uso:
  node scripts/material-authoring.mjs validate <archivo.md> [--json]
  node scripts/material-authoring.mjs install <archivo.md> [opciones]

Opciones de install:
  --apply          escribe content/ y assets/materiales/ (por defecto sólo simula)
  --with-images    copia las imágenes de <origen>/img/ al destino
  --force          permite reemplazar destinos que ya existen con otro contenido
  --check          no escribe: falla si el destino difiere del origen
  --json           informe en JSON

Raíces por defecto:
  content/            material publicable
  assets/materiales/  imágenes del material
  ${join(homedir(), "profemacon-authoring-private", "materials")}
`;

function parseArguments(argv) {
  const disabled = { json: false, apply: false, withImages: false, force: false, check: false };
  if (argv.includes("--help") || argv.includes("-h")) {
    return { command: "help", documentPath: null, ...disabled };
  }
  const [command, documentPath, ...rest] = argv;
  const options = { command, documentPath, ...disabled };
  for (const flag of rest) {
    if (flag === "--json") options.json = true;
    else if (flag === "--apply") options.apply = true;
    else if (flag === "--with-images") options.withImages = true;
    else if (flag === "--force") options.force = true;
    else if (flag === "--check") options.check = true;
    else throw new Error(`Opción desconocida: ${flag}. Admitidas: ${FLAGS.join(", ")}.`);
  }
  return options;
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function rootsFromEnvironment() {
  const contentRoot = process.env.PROFEMACON_CONTENT_ROOT
    ? resolve(process.env.PROFEMACON_CONTENT_ROOT) : join(repositoryRoot, "content");
  const assetsRoot = process.env.PROFEMACON_ASSETS_ROOT
    ? resolve(process.env.PROFEMACON_ASSETS_ROOT) : join(repositoryRoot, "assets");
  const materialsRoot = process.env.PROFEMACON_MATERIALS_ROOT
    ? resolve(process.env.PROFEMACON_MATERIALS_ROOT)
    : join(homedir(), "profemacon-authoring-private", "materials");
  return { contentRoot, assetsRoot, materialsRoot, materialsDir: join(assetsRoot, "materiales") };
}

const toSlashes = (value) => value.split(sep).join("/");

/** Comprueba que un destino quede estrictamente dentro de su raíz. */
function assertInsideRoot(root, target) {
  const relativePath = relative(root, target);
  if (relativePath.length === 0 || relativePath.startsWith("..") || relativePath.includes(":")) {
    throw new Error(`El destino ${target} no queda dentro de ${root}.`);
  }
  return target;
}

function listFilesRecursive(directory) {
  if (!existsSync(directory)) return [];
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...listFilesRecursive(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

function issueLine(issue) {
  return `${String(issue.severity).padEnd(7)} ${issue.code} ${issue.path || "-"}: ${issue.message}`;
}

// ---- Lectura y ubicación -----------------------------------------------------
function readSource(documentPath) {
  if (!documentPath) throw new Error("Falta la ruta del archivo Markdown del material.");
  const absolute = resolve(documentPath);
  if (!existsSync(absolute)) throw new Error(`No existe el archivo indicado: ${absolute}`);
  if (!statSync(absolute).isFile()) throw new Error(`La ruta indicada no es un archivo: ${absolute}`);
  return { absolute, bytes: statSync(absolute).size, text: stripBom(readFileSync(absolute, "utf8")) };
}

/**
 * Fuente esperada: `<...>/<asignatura>/<unidad>/<slug>/<slug>.md`.
 * La carpeta del material debe llamarse igual que el archivo.
 */
function deriveLocation(absolute) {
  return {
    fileName: basename(absolute),
    slugFromFile: basename(absolute).toLowerCase().endsWith(".md") ? basename(absolute).slice(0, -3) : null,
    slugFolder: basename(dirname(absolute)),
    unitFolder: basename(dirname(dirname(absolute))),
    subjectFolder: basename(dirname(dirname(dirname(absolute)))),
  };
}

function collectInstalledAssets(roots) {
  return listFilesRecursive(roots.assetsRoot).map((absolute) => ({
    path: `/${toSlashes(relative(roots.assetsRoot, absolute))}`,
    bytes: statSync(absolute).size,
    origin: "installed",
  }));
}

function collectPendingAssets(sourceDirectory, info) {
  const imgDirectory = join(sourceDirectory, "img");
  return listFilesRecursive(imgDirectory).map((absolute) => ({
    path: `${MATERIAL_ASSET_PREFIX}${info.subjectCode}/${info.unitCode}/${info.slug}/${basename(absolute)}`,
    bytes: statSync(absolute).size,
    origin: "pending",
    file: absolute,
  }));
}

function isCopyableImageName(name) {
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return (IMAGE_EXTENSIONS).includes(extension);
}

/** Materiales v1 ya instalados en la misma unidad, para cruzar `unitTitle`. */
function installedUnitEntries(roots, subjectCode, unitCode, excludeSlug) {
  const unitDirectory = join(roots.contentRoot, subjectCode, unitCode);
  if (!existsSync(unitDirectory)) return [];
  const entries = [];
  for (const name of readdirSync(unitDirectory)) {
    if (!name.toLowerCase().endsWith(".md")) continue;
    const file = join(unitDirectory, name);
    if (!statSync(file).isFile()) continue;
    const slug = name.slice(0, -3);
    if (slug === excludeSlug) continue;
    const result = parseMaterialDocument(stripBom(readFileSync(file, "utf8")), {
      contentPath: `content/${subjectCode}/${unitCode}/${slug}.md`,
    });
    if (result.parsed === null) continue;
    entries.push({
      slug,
      unitCode: result.parsed.header.unitCode,
      unitTitle: result.parsed.header.unitTitle,
    });
  }
  return entries;
}

// ---- Plan, escritura atómica y verificación ----------------------------------
function buildPlan(context) {
  const { source, parsed, contentPath, withImages, pendingImages, installedAssets, imageTarget } = context;
  const actions = [];
  const notes = [];
  const blockers = [];

  const markdownExists = existsSync(contentPath) && statSync(contentPath).isFile();
  const markdownKind = !markdownExists
    ? "create"
    : (stripBom(readFileSync(contentPath, "utf8")) === source.text ? "unchanged" : "update");
  actions.push({
    kind: markdownKind, label: "markdown", target: contentPath,
    bytes: Buffer.byteLength(source.text, "utf8"), read: () => source.text,
  });

  if (withImages) {
    for (const entry of pendingImages) {
      const name = basename(entry.file);
      if (!isCopyableImageName(name)) {
        notes.push({
          severity: "note", code: "IMAGE_IGNORED", path: `img/${name}`,
          message: "La imagen no usa una extensión admitida: no se copia.",
        });
        continue;
      }
      const target = imageTarget(name);
      const exists = existsSync(target) && statSync(target).isFile();
      const kind = !exists ? "create" : (readFileSync(entry.file).equals(readFileSync(target)) ? "unchanged" : "update");
      actions.push({ kind, label: `imagen ${name}`, target, bytes: entry.bytes, read: () => readFileSync(entry.file) });
    }
  }

  // Sin --with-images, cualquier imagen referenciada debe estar ya instalada.
  const missingInstalled = parsed.images
    .map((image) => image.src)
    .filter((path) => !installedAssets.has(path));
  if (!withImages && missingInstalled.length > 0) {
    blockers.push({
      severity: "error",
      code: "IMAGES_NOT_INSTALLED",
      path: "assets",
      message: `Faltan ${missingInstalled.length} imágenes en el destino (${missingInstalled.join(", ")}). ` +
        "Volvé a ejecutar con --with-images.",
    });
  }

  const conflicts = actions.filter((action) => action.kind === "update");
  return { actions, conflicts, blockers, notes, missingInstalled };
}

/**
 * Escribe el plan en dos fases: primero todos los archivos temporales (en el
 * directorio destino, para que el renombrado ocurra en el mismo volumen) y sólo
 * después los reemplazos. Si la preparación falla, se limpian los temporales y no
 * se toca ningún destino. El reemplazo múltiple no es atómico en Windows: si un
 * renombrado falla, se informa archivo por archivo y nunca se borra un destino.
 */
function writePlan(actions) {
  const temporaries = [];
  const failures = [];
  const cleanup = () => {
    for (const entry of temporaries) {
      try {
        if (existsSync(entry.temporary)) rmSync(entry.temporary, { force: true });
      } catch {
        // La limpieza es best-effort: se informa el fallo original.
      }
    }
  };

  try {
    for (const action of actions) {
      if (action.kind === "unchanged") continue;
      mkdirSync(dirname(action.target), { recursive: true });
      const temporary = `${action.target}${TEMP_SUFFIX}`;
      writeFileSync(temporary, action.read());
      temporaries.push({ temporary, action });
    }
  } catch (error) {
    cleanup();
    return {
      written: [],
      failures: [{ code: "INSTALL_FAILED", message: `No se pudo preparar la escritura: ${error.message}` }],
    };
  }

  const written = [];
  for (const entry of temporaries) {
    try {
      renameSync(entry.temporary, entry.action.target);
      written.push(entry.action.target);
    } catch (error) {
      failures.push({ code: "REPLACE_FAILED", message: `No se pudo reemplazar ${entry.action.target}: ${error.message}` });
    }
  }
  cleanup();
  return { written, failures };
}

/** Resume el estado de los assets referenciados por el material. */
function describeAssets(parsed, installedAssets, pendingImages) {
  const referenced = parsed.images.map((image) => image.src);
  const pendingPaths = new Set(pendingImages.map((entry) => entry.path));
  return {
    referenced: referenced.length,
    installed: referenced.filter((path) => installedAssets.has(path)).length,
    pending: referenced.filter((path) => pendingPaths.has(path)).length,
    missing: referenced.filter((path) => !installedAssets.has(path) && !pendingPaths.has(path)),
    orphans: parsed.orphanImages,
  };
}

function checkSynchronization(context) {
  const { source, contentPath, pendingImages, parsed, installedAssets, imageTarget } = context;
  const drift = [];
  if (!existsSync(contentPath) || !statSync(contentPath).isFile()) {
    drift.push({ kind: "missing", target: contentPath, detail: "El material no está instalado." });
  } else if (stripBom(readFileSync(contentPath, "utf8")) !== source.text) {
    drift.push({ kind: "different", target: contentPath, detail: "El material instalado difiere del origen." });
  }
  for (const entry of pendingImages) {
    const name = basename(entry.file);
    if (!isCopyableImageName(name)) continue;
    const target = imageTarget(name);
    if (!existsSync(target) || !statSync(target).isFile()) {
      drift.push({ kind: "missing", target, detail: "La imagen del origen no está instalada." });
    } else if (!readFileSync(entry.file).equals(readFileSync(target))) {
      drift.push({ kind: "different", target, detail: "La imagen instalada difiere del origen." });
    }
  }
  for (const imagePath of parsed.images.map((image) => image.src)) {
    if (installedAssets.has(imagePath)) continue;
    if (pendingImages.some((entry) => entry.path === imagePath)) continue;
    drift.push({ kind: "missing", target: imagePath, detail: "La imagen referenciada no está instalada." });
  }
  return drift;
}

// ---- Informe -----------------------------------------------------------------
const hasPolicyIssue = (issues) => issues.some((issue) => POLICY_ISSUE_CODES.includes(issue.code));

function emptyReport(command, options) {
  return {
    status: "rejected",
    command,
    dryRun: command === "validate" ? true : (options.check ? true : !options.apply),
    check: Boolean(options.check),
    source: null,
    contentPath: null,
    roots: null,
    kind: null,
    material: null,
    hash: null,
    bytes: null,
    assets: { referenced: 0, installed: 0, pending: 0, missing: [], orphans: [] },
    actions: [],
    summary: { create: 0, update: 0, unchanged: 0, conflict: 0 },
    drift: [],
    errors: [],
    warnings: [],
    notes: [],
    failures: [],
  };
}

function summarizeActions(actions) {
  const summary = { create: 0, update: 0, unchanged: 0, conflict: 0 };
  for (const action of actions) if (action.kind in summary) summary[action.kind] += 1;
  return summary;
}

function printReport(report, asJson) {
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`${report.command === "validate" ? "Validación de material" : "Instalación de material"}: ${report.status}` +
    `${report.dryRun ? " (simulación, sin escrituras)" : ""}`);
  if (report.source) console.log(`Origen: ${report.source}`);
  if (report.contentPath) console.log(`Destino: ${report.contentPath}`);
  if (report.material) {
    const material = report.material;
    console.log(`Material: ${material.slug} · ${material.unitCode} · orden ${material.order} · ${material.title}`);
    console.log(`Contrato: v${material.schemaVersion} · authoring ${material.authoring}` +
      `${material.tags.length > 0 ? ` · etiquetas ${material.tags.join(", ")}` : ""}`);
    console.log(`Cuerpo: ${material.words} palabras · ${material.lines} líneas · ${material.headings} encabezados · ` +
      `${material.images} imágenes · ${material.videos} videos · ${material.codeBlocks} bloques de código`);
  }
  if (report.hash) console.log(`Hash SHA-256: ${report.hash} · ${report.bytes} bytes`);
  if (report.assets.referenced > 0 || report.assets.missing.length > 0) {
    console.log(`Assets: ${report.assets.referenced} referenciadas · ${report.assets.installed} instaladas · ` +
      `${report.assets.pending} pendientes${report.assets.missing.length > 0 ? ` · faltan ${report.assets.missing.length}` : ""}`);
  }
  if (report.check) {
    console.log(`Sincronización: ${report.drift.length === 0 ? "sin diferencias" : `${report.drift.length} diferencia(s)`}`);
    for (const item of report.drift) console.log(`  ${item.kind} ${item.target}: ${item.detail}`);
  }
  if (report.actions.length > 0) {
    for (const action of report.actions) console.log(`  ${action.kind.padEnd(9)} ${action.label} → ${action.target}`);
    console.log(`Resumen: ${report.summary.create} crear · ${report.summary.update} actualizar · ` +
      `${report.summary.unchanged} sin cambios · ${report.summary.conflict} en conflicto`);
  }
  for (const issue of report.errors) console.log(issueLine(issue));
  for (const failure of report.failures) {
    console.log(issueLine({ severity: "error", code: failure.code, path: "", message: failure.message }));
  }
  for (const issue of report.warnings) console.log(issueLine(issue));
  for (const issue of report.notes) console.log(issueLine(issue));
}

// ---- Flujo principal ---------------------------------------------------------
function isInside(root, target) {
  const relativePath = relative(root, target);
  return relativePath.length > 0 && !relativePath.startsWith("..") && !relativePath.includes(":");
}

/**
 * Determina la ubicación destino del material.
 *   · `content`   el archivo ya está instalado (validate);
 *   · `authoring` la fuente sigue `<asignatura>/<unidad>/<slug>/<slug>.md`;
 *   · `unknown`   no hay contexto de path (se valida sin cruce de ruta).
 */
function resolveContentContext(roots, source) {
  const installed = parseContentPath(source.absolute);
  if (installed !== null && isInside(roots.contentRoot, source.absolute)) {
    return { info: installed, contentPath: source.absolute, source: "content" };
  }
  const location = deriveLocation(source.absolute);
  const layoutOk = location.slugFromFile !== null
    && location.slugFromFile === location.slugFolder
    && UNIT_CODE_PATTERN.test(location.unitFolder)
    && SUBJECT_CODE_PATTERN.test(location.subjectFolder);
  if (layoutOk) {
    const info = {
      subjectCode: location.subjectFolder,
      unitCode: location.unitFolder,
      slug: location.slugFromFile,
    };
    return {
      info,
      contentPath: join(roots.contentRoot, info.subjectCode, info.unitCode, `${info.slug}.md`),
      source: "authoring",
    };
  }
  return { info: null, contentPath: null, source: "unknown" };
}

async function main() {
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
  if (options.command !== "validate" && options.command !== "install") {
    console.error(`Comando desconocido: ${options.command}`);
    console.error(USAGE);
    return EXIT_USAGE;
  }

  const roots = rootsFromEnvironment();
  const report = emptyReport(options.command, options);

  let source;
  try {
    source = readSource(options.documentPath);
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    return EXIT_USAGE;
  }

  report.source = source.absolute;
  report.bytes = source.bytes;
  report.roots = { content: roots.contentRoot, assets: roots.assetsRoot, materials: roots.materialsRoot };

  const context = resolveContentContext(roots, source);
  report.contentPath = context.contentPath;

  if (options.command === "install") {
    if (context.source === "content") {
      console.error(`El archivo ya está dentro de content/: no hay nada que instalar (${source.absolute}).`);
      return EXIT_USAGE;
    }
    if (context.info === null) {
      console.error("La fuente debe seguir la forma <...>/<asignatura>/<unidad>/<slug>/<slug>.md, " +
        "con la carpeta del material con el mismo nombre que el archivo.");
      return EXIT_USAGE;
    }
    if (!isInside(roots.materialsRoot, source.absolute)) {
      console.error(`La fuente debe vivir dentro de ${roots.materialsRoot} (configurable con PROFEMACON_MATERIALS_ROOT).`);
      return EXIT_USAGE;
    }
  }

  const installedAssets = new Map();
  for (const entry of collectInstalledAssets(roots)) installedAssets.set(entry.path, entry.bytes);
  const pendingImages = context.info === null ? [] : collectPendingAssets(dirname(source.absolute), context.info);
  const assetEntries = [...installedAssets.entries()].map(([path, bytes]) => ({ path, bytes }));
  for (const entry of pendingImages) assetEntries.push({ path: entry.path, bytes: entry.bytes });

  const parse = parseMaterialDocument(source.text, {
    contentPath: context.contentPath,
    assets: assetEntries,
    bytes: source.bytes,
  });
  report.kind = parse.kind;
  report.errors.push(...parse.errors);
  report.warnings.push(...parse.warnings);
  report.notes.push(...parse.notes);
  if (parse.kind !== "material-v1") {
    report.errors.unshift({
      severity: "error", code: "MATERIAL_SCHEMA", path: "frontmatter",
      message: "Sólo los materiales con «schemaVersion: 1» pasan por este pipeline. " +
        "Los materiales legacy de Unidad 0 y Unidad 1 no se migran automáticamente.",
    });
  }

  if (parse.parsed !== null && parse.errors.length === 0) {
    const parsed = parse.parsed;
    report.material = {
      schemaVersion: parsed.header.schemaVersion,
      slug: parsed.header.slug,
      title: parsed.header.title,
      unitCode: parsed.header.unitCode,
      order: parsed.header.order,
      summary: parsed.header.summary,
      unitTitle: parsed.header.unitTitle,
      estimatedMinutes: parsed.header.estimatedMinutes,
      tags: parsed.header.tags,
      authoring: parsed.header.authoring,
      words: parsed.stats.words,
      lines: parsed.stats.lines,
      headings: parsed.stats.headings,
      paragraphs: parsed.stats.paragraphs,
      tables: parsed.stats.tables,
      codeBlocks: parsed.stats.codeBlocks,
      images: parsed.images.length,
      videos: parsed.videos.length,
      links: parsed.links.length,
    };
    report.hash = await sha256Hex(source.text);
    report.assets = describeAssets(parsed, installedAssets, pendingImages);

    if (context.info !== null) {
      const siblings = installedUnitEntries(roots, context.info.subjectCode, context.info.unitCode, context.info.slug);
      report.errors.push(...checkUnitConsistency([
        ...siblings,
        { slug: parsed.header.slug, unitCode: parsed.header.unitCode, unitTitle: parsed.header.unitTitle },
      ], "unit"));
    }
  }

  if (report.errors.length > 0) {
    report.status = "rejected";
    printReport(report, options.json);
    return hasPolicyIssue(report.errors) ? EXIT_REJECTED : EXIT_VALIDATION;
  }

  if (options.command === "validate") {
    report.status = "validated";
    printReport(report, options.json);
    return EXIT_OK;
  }

  const info = context.info;
  const imageTarget = (name) => assertInsideRoot(roots.materialsDir,
    join(roots.materialsDir, info.subjectCode, info.unitCode, info.slug, name));
  const plan = buildPlan({
    source,
    parsed: parse.parsed,
    contentPath: context.contentPath,
    withImages: options.withImages,
    pendingImages,
    installedAssets,
    imageTarget,
  });
  report.notes.push(...plan.notes);
  report.actions = plan.actions.map((action) => ({
    kind: action.kind, label: action.label, target: action.target, bytes: action.bytes,
  }));
  report.summary = summarizeActions(plan.actions);

  if (options.check) {
    report.drift = checkSynchronization({
      source, contentPath: context.contentPath, pendingImages, parsed: parse.parsed, installedAssets, imageTarget,
    });
    report.dryRun = true;
    if (report.drift.length > 0) {
      report.errors.push({
        severity: "error", code: "MATERIAL_DRIFT", path: "check",
        message: `El destino no coincide con el origen: ${report.drift.length} diferencia(s).`,
      });
    }
    report.status = report.drift.length === 0 ? "synced" : "drifted";
    printReport(report, options.json);
    return report.drift.length === 0 ? EXIT_OK : EXIT_REJECTED;
  }

  if (plan.blockers.length > 0) {
    report.errors.push(...plan.blockers);
    report.status = "rejected";
    printReport(report, options.json);
    return EXIT_REJECTED;
  }

  if (plan.conflicts.length > 0 && !options.force) {
    for (const conflict of plan.conflicts) {
      report.errors.push({
        severity: "error", code: "TARGET_CONFLICT", path: "",
        message: `${conflict.label} ya existe con otro contenido: revisá el destino o volvé a ejecutar con --force.`,
      });
    }
    report.summary.conflict = plan.conflicts.length;
    report.status = "rejected";
    printReport(report, options.json);
    return EXIT_REJECTED;
  }

  if (!options.apply) {
    report.status = "simulated";
    printReport(report, options.json);
    return EXIT_OK;
  }

  const outcome = writePlan(plan.actions);
  report.failures = outcome.failures;
  report.status = outcome.failures.length > 0
    ? "rejected"
    : (report.summary.create + report.summary.update === 0 ? "unchanged" : "installed");
  if (outcome.failures.length === 0 && parse.parsed !== null) {
    const refreshed = new Map();
    for (const entry of collectInstalledAssets(roots)) refreshed.set(entry.path, entry.bytes);
    report.assets = describeAssets(parse.parsed, refreshed, []);
  }
  printReport(report, options.json);
  return outcome.failures.length > 0 ? EXIT_REJECTED : EXIT_OK;
}

main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  console.error(error?.message ?? String(error));
  process.exitCode = EXIT_REJECTED;
});
