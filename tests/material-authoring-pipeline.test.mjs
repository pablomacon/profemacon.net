// Pruebas del pipeline local de materiales teóricos (Hito 6D-A).
// Todo corre sobre directorios temporales: nunca escribe en content/ ni en
// assets/ del repositorio, ni en la carpeta privada real de autoría.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep, dirname } from "node:path";
import test from "node:test";

const projectRoot = process.cwd();
const cliPath = join(projectRoot, "scripts", "material-authoring.mjs");
const repositoryContent = join(projectRoot, "content");
const repositoryAssets = join(projectRoot, "assets");

const SUBJECT = "programacion-prueba";
const UNIT = "unidad-1";
const SLUG = "clase-prueba";
const IMAGE_NAME = "01-diagrama.webp";
const IMAGE_PATH = `/materiales/${SUBJECT}/${UNIT}/${SLUG}/${IMAGE_NAME}`;
const FENCE = String.fromCharCode(96).repeat(3);
const fence = (language, content) => `${FENCE}${language}\n${content}\n${FENCE}\n`;

function createEnvironment() {
  const root = mkdtempSync(join(tmpdir(), "profemacon-material-hito6d-"));
  const roots = {
    materials: join(root, "materials"),
    content: join(root, "content"),
    assets: join(root, "assets"),
  };
  for (const directory of Object.values(roots)) mkdirSync(directory, { recursive: true });
  return {
    root,
    roots,
    environment: {
      ...process.env,
      PROFEMACON_MATERIALS_ROOT: roots.materials,
      PROFEMACON_CONTENT_ROOT: roots.content,
      PROFEMACON_ASSETS_ROOT: roots.assets,
    },
  };
}

function runCli(environment, args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd: projectRoot, encoding: "utf8", env: environment });
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

function snapshot(directory) {
  const entries = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else entries.push(`${relative(directory, path).split(sep).join("/")}:${statSync(path).size}`);
    }
  };
  if (existsSync(directory)) walk(directory);
  return entries.sort();
}

function findTemporaries(directory) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".pm-material.tmp")) found.push(path);
    }
  };
  if (existsSync(directory)) walk(directory);
  return found;
}

function materialSource(overrides = {}, body = "Párrafo introductorio del material de prueba.\n") {
  const fields = {
    schemaVersion: "1",
    slug: SLUG,
    title: "Clase de prueba del pipeline",
    unitCode: UNIT,
    order: "1",
    authoring: "profe-macon-ai-workflow",
    ...overrides,
  };
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

function writeFixture(environment, options = {}) {
  const { overrides = {}, body, images = [IMAGE_NAME], bom = false } = options;
  const directory = join(environment.roots.materials, SUBJECT, UNIT, SLUG);
  mkdirSync(join(directory, "img"), { recursive: true });
  const text = materialSource(overrides, body);
  writeFileSync(join(directory, `${SLUG}.md`), bom ? `\uFEFF${text}` : text, "utf8");
  for (const name of images) writeFileSync(join(directory, "img", name), Buffer.from([1, 2, 3, 4, 5]));
  return {
    directory,
    sourcePath: join(directory, `${SLUG}.md`),
    contentPath: join(environment.roots.content, SUBJECT, UNIT, `${SLUG}.md`),
    imageDirectory: join(environment.roots.assets, "materiales", SUBJECT, UNIT, SLUG),
    imagePath: join(environment.roots.assets, "materiales", SUBJECT, UNIT, SLUG, IMAGE_NAME),
  };
}

const withImage = (extra = "") => `Párrafo inicial del material.\n\n![Diagrama de memoria con cinco enteros contiguos](${IMAGE_PATH})\n${extra}`;

test("validate acepta un material válido, informa el hash y no escribe nada", () => {
  const environment = createEnvironment();
  const fixture = writeFixture(environment, { body: withImage(fence("java", "int[] notas = new int[5];")) });
  const before = snapshot(environment.roots.content).concat(snapshot(environment.roots.assets));

  const run = runCli(environment.environment, ["validate", fixture.sourcePath, "--json"]);
  assert.equal(run.code, 0, run.output);
  const report = parseJsonReport(run);
  assert.equal(report.status, "validated");
  assert.equal(report.material.slug, SLUG);
  assert.equal(report.material.unitCode, UNIT);
  assert.equal(report.assets.referenced, 1);
  assert.equal(report.assets.missing.length, 0);
  assert.match(report.hash, /^[0-9a-f]{64}$/);
  assert.equal(report.bytes, statSync(fixture.sourcePath).size);
  assert.deepEqual(snapshot(environment.roots.content).concat(snapshot(environment.roots.assets)), before);

  const text = runCli(environment.environment, ["validate", fixture.sourcePath]);
  assert.equal(text.code, 0, text.output);
  assert.ok(text.output.includes("Hash SHA-256:"), text.output);
  assert.ok(text.output.includes("Validación de material: validated"), text.output);
});

test("validate distingue errores de validación de rechazos por política", () => {
  const environment = createEnvironment();
  const invalid = writeFixture(environment, { overrides: { title: "ab" } });
  const invalidRun = runCli(environment.environment, ["validate", invalid.sourcePath]);
  assert.equal(invalidRun.code, 1, invalidRun.output);
  assert.ok(invalidRun.output.includes("INVALID_TITLE"), invalidRun.output);

  const unsafe = writeFixture(environment, { body: "Párrafo con <script>alert(1)</script>.\n" });
  const unsafeRun = runCli(environment.environment, ["validate", unsafe.sourcePath]);
  assert.equal(unsafeRun.code, 2, unsafeRun.output);
  assert.ok(unsafeRun.output.includes("UNSAFE_CONTENT"), unsafeRun.output);

  const legacy = writeFixture(environment, { overrides: { schemaVersion: null, titulo: "Unidad 1" } });
  const legacyRun = runCli(environment.environment, ["validate", legacy.sourcePath]);
  assert.equal(legacyRun.code, 1, legacyRun.output);
  assert.ok(legacyRun.output.includes("no se migran automáticamente"), legacyRun.output);
});

test("validate tolera BOM y detecta imágenes huérfanas", () => {
  const environment = createEnvironment();
  const fixture = writeFixture(environment, { bom: true });
  const withBom = runCli(environment.environment, ["validate", fixture.sourcePath, "--json"]);
  assert.equal(withBom.code, 0, withBom.output);

  const plain = writeFixture(environment);
  const withoutBom = runCli(environment.environment, ["validate", plain.sourcePath, "--json"]);
  assert.equal(withoutBom.code, 0, withoutBom.output);
  assert.equal(parseJsonReport(withBom).hash, parseJsonReport(withoutBom).hash, "El hash debe ignorar el BOM");

  writeFixture(environment, { body: withImage(), images: [IMAGE_NAME, "99-sin-uso.webp"] });
  const orphanRun = runCli(environment.environment, ["validate", fixture.sourcePath, "--json"]);
  const report = parseJsonReport(orphanRun);
  assert.deepEqual(report.assets.orphans, [`/materiales/${SUBJECT}/${UNIT}/${SLUG}/99-sin-uso.webp`]);
});

test("usa la salida 3 para el uso incorrecto", () => {
  const environment = createEnvironment();
  assert.equal(runCli(environment.environment, ["validate"]).code, 3);
  assert.equal(runCli(environment.environment, ["validate", join(environment.root, "no-existe.md")]).code, 3);
  assert.equal(runCli(environment.environment, ["otro-comando", "archivo.md"]).code, 3);
  const fixture = writeFixture(environment);
  assert.equal(runCli(environment.environment, ["validate", fixture.sourcePath, "--desconocido"]).code, 3);
  assert.equal(runCli(environment.environment, ["--help"]).code, 0);
  assert.equal(runCli(environment.environment, ["install", fixture.contentPath]).code, 3);
});

test("install simula por defecto y sólo escribe con --apply", () => {
  const environment = createEnvironment();
  const fixture = writeFixture(environment, { body: withImage() });
  const before = snapshot(environment.roots.content).concat(snapshot(environment.roots.assets));

  const simulation = runCli(environment.environment, ["install", fixture.sourcePath, "--with-images", "--json"]);
  assert.equal(simulation.code, 0, simulation.output);
  const simulated = parseJsonReport(simulation);
  assert.equal(simulated.status, "simulated");
  assert.equal(simulated.dryRun, true);
  assert.equal(simulated.summary.create, 2);
  assert.deepEqual(snapshot(environment.roots.content).concat(snapshot(environment.roots.assets)), before);

  const applied = runCli(environment.environment, ["install", fixture.sourcePath, "--with-images", "--apply", "--json"]);
  assert.equal(applied.code, 0, applied.output);
  const installed = parseJsonReport(applied);
  assert.equal(installed.status, "installed");
  assert.equal(installed.dryRun, false);
  assert.equal(installed.summary.create, 2);
  assert.ok(existsSync(fixture.contentPath));
  assert.ok(existsSync(fixture.imagePath));
  assert.equal(readFileSync(fixture.contentPath, "utf8"), readFileSync(fixture.sourcePath, "utf8"));
  assert.deepEqual(readFileSync(fixture.imagePath), Buffer.from([1, 2, 3, 4, 5]));
  assert.deepEqual(findTemporaries(environment.root), []);
});

test("install es idempotente y nunca borra lo que ya existe", () => {
  const environment = createEnvironment();
  const fixture = writeFixture(environment, { body: withImage() });
  assert.equal(runCli(environment.environment, ["install", fixture.sourcePath, "--with-images", "--apply"]).code, 0);
  const afterFirst = snapshot(environment.roots.content).concat(snapshot(environment.roots.assets));

  const second = runCli(environment.environment, ["install", fixture.sourcePath, "--with-images", "--apply", "--json"]);
  assert.equal(second.code, 0, second.output);
  const report = parseJsonReport(second);
  assert.equal(report.status, "unchanged");
  assert.equal(report.summary.unchanged, 2);
  assert.equal(report.summary.create, 0);
  assert.deepEqual(snapshot(environment.roots.content).concat(snapshot(environment.roots.assets)), afterFirst);

  writeFileSync(join(fixture.imageDirectory, "archivo-previo.webp"), Buffer.from([9, 9, 9]));
  const third = runCli(environment.environment, ["install", fixture.sourcePath, "--with-images", "--apply", "--json"]);
  assert.equal(third.code, 0, third.output);
  assert.ok(existsSync(join(fixture.imageDirectory, "archivo-previo.webp")), "El pipeline nunca borra archivos existentes");
});

test("install rechaza destinos con otro contenido salvo con --force", () => {
  const environment = createEnvironment();
  const fixture = writeFixture(environment, { body: withImage() });
  assert.equal(runCli(environment.environment, ["install", fixture.sourcePath, "--with-images", "--apply"]).code, 0);
  writeFileSync(fixture.contentPath, `${readFileSync(fixture.contentPath, "utf8")}\nCambio hecho a mano.\n`, "utf8");
  const drifted = readFileSync(fixture.contentPath, "utf8");

  const conflict = runCli(environment.environment, ["install", fixture.sourcePath, "--with-images", "--apply", "--json"]);
  assert.equal(conflict.code, 2, conflict.output);
  const report = parseJsonReport(conflict);
  assert.equal(report.status, "rejected");
  assert.equal(report.errors.filter((issue) => issue.code === "TARGET_CONFLICT").length, 1);
  assert.equal(readFileSync(fixture.contentPath, "utf8"), drifted, "Sin --force no se escribe nada");

  const forced = runCli(environment.environment, ["install", fixture.sourcePath, "--with-images", "--apply", "--force", "--json"]);
  assert.equal(forced.code, 0, forced.output);
  const forcedReport = parseJsonReport(forced);
  assert.equal(forcedReport.summary.update, 1);
  assert.equal(readFileSync(fixture.contentPath, "utf8"), readFileSync(fixture.sourcePath, "utf8"));
});

test("exige --with-images cuando las imágenes todavía no están instaladas", () => {
  const environment = createEnvironment();
  const fixture = writeFixture(environment, { body: withImage() });

  const withoutImages = runCli(environment.environment, ["install", fixture.sourcePath, "--apply", "--json"]);
  assert.equal(withoutImages.code, 2, withoutImages.output);
  const report = parseJsonReport(withoutImages);
  assert.equal(report.errors.filter((issue) => issue.code === "IMAGES_NOT_INSTALLED").length, 1);
  assert.equal(existsSync(fixture.contentPath), false, "No debe instalarse el material sin sus imágenes");

  const withImages = runCli(environment.environment, ["install", fixture.sourcePath, "--with-images", "--apply"]);
  assert.equal(withImages.code, 0, withImages.output);
  assert.ok(existsSync(fixture.imagePath));
});

test("--check detecta la sincronización y el drift sin escribir nada", () => {
  const environment = createEnvironment();
  const fixture = writeFixture(environment, { body: withImage() });

  const pending = runCli(environment.environment, ["install", fixture.sourcePath, "--with-images", "--check", "--json"]);
  assert.equal(pending.code, 2, pending.output);
  assert.equal(parseJsonReport(pending).status, "drifted");

  assert.equal(runCli(environment.environment, ["install", fixture.sourcePath, "--with-images", "--apply"]).code, 0);
  const synced = runCli(environment.environment, ["install", fixture.sourcePath, "--with-images", "--check", "--json"]);
  assert.equal(synced.code, 0, synced.output);
  assert.equal(parseJsonReport(synced).status, "synced");

  writeFileSync(fixture.contentPath, "otra cosa", "utf8");
  const drifted = runCli(environment.environment, ["install", fixture.sourcePath, "--with-images", "--check", "--json"]);
  assert.equal(drifted.code, 2, drifted.output);
  const report = parseJsonReport(drifted);
  assert.ok(report.drift.some((item) => item.kind === "different"));
  assert.equal(readFileSync(fixture.contentPath, "utf8"), "otra cosa", "--check nunca escribe");
});

test("no deja estado parcial ni temporales si falla la preparación", () => {
  const environment = createEnvironment();
  const fixture = writeFixture(environment, { body: withImage() });
  mkdirSync(dirname(fixture.imageDirectory), { recursive: true });
  writeFileSync(fixture.imageDirectory, "archivo que impide crear la carpeta de imágenes", "utf8");
  const before = snapshot(environment.roots.content);

  const run = runCli(environment.environment, ["install", fixture.sourcePath, "--with-images", "--apply", "--json"]);
  assert.equal(run.code, 2, run.output);
  const report = parseJsonReport(run);
  assert.ok(report.failures.length > 0, "Debe informarse el fallo");
  assert.equal(existsSync(fixture.contentPath), false, "No debe quedar una instalación parcial");
  assert.deepEqual(snapshot(environment.roots.content), before);
  assert.deepEqual(findTemporaries(environment.root), []);
});

test("no escribe fuera de las raíces permitidas", () => {
  const environment = createEnvironment();
  const fixture = writeFixture(environment, { body: withImage() });
  const repositoryBefore = snapshot(repositoryContent).concat(snapshot(repositoryAssets));

  const run = runCli(environment.environment, ["install", fixture.sourcePath, "--with-images", "--apply", "--json"]);
  assert.equal(run.code, 0, run.output);
  const report = parseJsonReport(run);
  for (const action of report.actions) {
    assert.ok(action.target.startsWith(environment.root), `El destino debe quedar dentro de la raíz temporal: ${action.target}`);
    assert.equal(existsSync(action.target), true);
  }
  assert.deepEqual(snapshot(repositoryContent).concat(snapshot(repositoryAssets)), repositoryBefore,
    "El pipeline no debe tocar content/ ni assets/ del repositorio");
  assert.equal(existsSync(join(environment.roots.materials, "content")), false);
  assert.equal(existsSync(join(environment.roots.materials, "assets")), false);
});

test("verifica la consistencia de unitTitle con los materiales ya instalados", () => {
  const environment = createEnvironment();
  const first = writeFixture(environment, { overrides: { unitTitle: "Variables y tipos" } });
  assert.equal(runCli(environment.environment, ["install", first.sourcePath, "--with-images", "--apply"]).code, 0);

  const secondDirectory = join(environment.roots.materials, SUBJECT, UNIT, "clase-segunda");
  mkdirSync(join(secondDirectory, "img"), { recursive: true });
  const secondPath = join(secondDirectory, "clase-segunda.md");
  writeFileSync(secondPath, materialSource({ slug: "clase-segunda", order: "2", unitTitle: "Otro título" }), "utf8");
  const mismatch = runCli(environment.environment, ["validate", secondPath, "--json"]);
  assert.equal(mismatch.code, 1, mismatch.output);
  assert.equal(parseJsonReport(mismatch).errors.filter((issue) => issue.code === "UNIT_TITLE_MISMATCH").length, 1);

  writeFileSync(secondPath, materialSource({ slug: "clase-segunda", order: "2", unitTitle: "Variables y tipos" }), "utf8");
  assert.equal(runCli(environment.environment, ["validate", secondPath]).code, 0);
});

test("ignora imágenes con extensión no admitida y lo informa", () => {
  const environment = createEnvironment();
  const fixture = writeFixture(environment, { images: [IMAGE_NAME, "notas.txt"] });
  const run = runCli(environment.environment, ["install", fixture.sourcePath, "--with-images", "--apply", "--json"]);
  assert.equal(run.code, 0, run.output);
  assert.equal(parseJsonReport(run).notes.filter((issue) => issue.code === "IMAGE_IGNORED").length, 1);
  assert.equal(existsSync(join(fixture.imageDirectory, "notas.txt")), false);
});

test("exige que la fuente viva dentro de la raíz privada de autoría", () => {
  const environment = createEnvironment();
  const outside = mkdtempSync(join(tmpdir(), "profemacon-material-outside-"));
  const directory = join(outside, SUBJECT, UNIT, SLUG);
  mkdirSync(directory, { recursive: true });
  const sourcePath = join(directory, `${SLUG}.md`);
  writeFileSync(sourcePath, materialSource(), "utf8");

  const install = runCli(environment.environment, ["install", sourcePath, "--apply"]);
  assert.equal(install.code, 3, install.output);
  assert.ok(install.output.includes("PROFEMACON_MATERIALS_ROOT"), install.output);
  assert.equal(runCli(environment.environment, ["validate", sourcePath]).code, 0, "validate admite cualquier ruta");
});

test("el informe JSON expone el contrato estable del pipeline", () => {
  const environment = createEnvironment();
  const fixture = writeFixture(environment, {
    body: withImage(fence("youtube", "id: iZTONYPJPs8\ntitle: Recorrido del arreglo")),
  });
  const run = runCli(environment.environment, ["validate", fixture.sourcePath, "--json"]);
  assert.equal(run.code, 0, run.output);
  const report = parseJsonReport(run);
  for (const key of ["status", "command", "dryRun", "check", "source", "contentPath", "kind", "material",
    "hash", "bytes", "assets", "actions", "summary", "drift", "errors", "warnings", "notes", "failures"]) {
    assert.ok(key in report, `Falta la clave ${key} en el informe`);
  }
  assert.equal(report.kind, "material-v1");
  assert.equal(report.material.videos, 1);
  assert.equal(report.material.authoring, "profe-macon-ai-workflow");
  assert.equal(report.assets.pending, 1);
  assert.equal(report.command, "validate");
  assert.equal(report.check, false);
});
