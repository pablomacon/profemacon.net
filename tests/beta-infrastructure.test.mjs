// Preparación local de la infraestructura beta remota ficticia (A1 / B1): pruebas puras.
//
// Son locales y de sólo lectura: no ejecutan Wrangler, no consultan Cloudflare,
// no usan OAuth y no tocan D1. Cubren la guarda de destino, el verificador del
// config aplanado que deja el plugin de Vite y el rechazo del smoke test sin URL.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BETA_DATABASE_NAME,
  BETA_WORKER_NAME,
  PLACEHOLDER_DATABASE_ID,
  TOP_LEVEL_EXPECTATIONS,
  describeDatabaseId,
  parseJsonc,
  readBetaTarget,
  validateBetaTarget,
  verifyFlattenedBetaConfig,
} from "../scripts/beta-target.mjs";

const projectRoot = process.cwd();
const guardScript = join(projectRoot, "scripts", "verify-beta-d1-target.mjs");
const smokeScript = join(projectRoot, "scripts", "verify-beta-smoke.mjs");
const sharedModule = join(projectRoot, "scripts", "beta-target.mjs");
const realConfigPath = join(projectRoot, "wrangler.jsonc");

const REAL_UUID = "11111111-2222-3333-4444-555555555555";
const ASSETS = { binding: "ASSETS", not_found_handling: "single-page-application" };

function localDatabase(databaseName = TOP_LEVEL_EXPECTATIONS.databaseName, databaseId = TOP_LEVEL_EXPECTATIONS.databaseId) {
  return { binding: "DB", database_name: databaseName, database_id: databaseId, migrations_dir: "migrations" };
}

function betaDocument(overrides = {}) {
  const beta = {
    name: BETA_WORKER_NAME,
    workers_dev: true,
    assets: { ...ASSETS },
    d1_databases: [localDatabase(BETA_DATABASE_NAME)],
    ...overrides,
  };
  return {
    name: TOP_LEVEL_EXPECTATIONS.name,
    compatibility_date: TOP_LEVEL_EXPECTATIONS.compatibilityDate,
    main: TOP_LEVEL_EXPECTATIONS.main,
    assets: { ...ASSETS },
    d1_databases: [localDatabase()],
    env: { beta },
  };
}

/** Escribe una configuración ficticia en un directorio temporal y devuelve su ruta. */
function writeFixture(document) {
  const directory = mkdtempSync(join(tmpdir(), "profemacon-beta-infra-"));
  const configPath = join(directory, "wrangler.jsonc");
  writeFileSync(configPath, `${JSON.stringify(document, null, 2)}\n`);
  return { directory, configPath };
}

function cleanup(directory) {
  rmSync(directory, { recursive: true, force: true });
}

/** Ejecuta la guarda con un token inválido: si intentara autenticarse, fallaría. */
function runGuard(configPath, ...args) {
  const result = spawnSync(process.execPath, [guardScript, ...args, "--config", configPath], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CLOUDFLARE_API_TOKEN: "token-ficticio-invalido-para-pruebas",
      CLOUDFLARE_ACCOUNT_ID: "",
      WRANGLER_SEND_METRICS: "false",
    },
  });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

test("la guarda acepta la configuración beta del repositorio en modo --dry", () => {
  const target = readBetaTarget(realConfigPath);
  const state = describeDatabaseId(target.beta.d1.database_id);
  const result = runGuard(realConfigPath, "--dry");
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Worker objetivo:\s+profemacon-net-2-beta/);
  assert.match(result.output, /D1 database_name:\s+profemacon-beta-remote/);
  assert.match(result.output, new RegExp(`D1 database_id:\\s+${state.label}`));
  assert.match(result.output, /D1 local \(control\): profemacon-beta-local/);
  assert.match(result.output, /NO SE EJECUTÓ NINGUNA OPERACIÓN REMOTA/);
});

test("la guarda exige un database_id real antes de operar en remoto", () => {
  // La configuración evoluciona: en B1 el marcador de ceros es válido y en B2.1
  // ya hay UUID real. La guarda debe aceptar las dos etapas sin ambigüedad.
  const target = readBetaTarget(realConfigPath);
  const state = describeDatabaseId(target.beta.d1.database_id);
  const result = runGuard(realConfigPath, "--require-real");
  if (state.kind === "placeholder") {
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /todavía es el marcador de ceros/);
  } else {
    assert.equal(state.kind, "real", result.output);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /destino beta coherente y con database_id real/);
  }
  assert.match(result.output, /no ejecuta operaciones remotas/);
});

test("la guarda rechaza un Worker beta con otro nombre", () => {
  const fixture = writeFixture(betaDocument({ name: "profemacon-net-2" }));
  try {
    const result = runGuard(fixture.configPath, "--dry");
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /debe llamarse "profemacon-net-2-beta"/);
  } finally {
    cleanup(fixture.directory);
  }
});

test("la guarda rechaza reutilizar el nombre de la D1 local en la beta", () => {
  const fixture = writeFixture(betaDocument({ d1_databases: [localDatabase(TOP_LEVEL_EXPECTATIONS.databaseName)] }));
  try {
    const result = runGuard(fixture.configPath, "--dry");
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /La D1 de la beta debe llamarse "profemacon-beta-remote"/);
    assert.match(result.output, /reutiliza el nombre local/);
  } finally {
    cleanup(fixture.directory);
  }
});

test("la guarda rechaza la beta sin binding DB", () => {
  const fixture = writeFixture(betaDocument({ d1_databases: [] }));
  try {
    const result = runGuard(fixture.configPath, "--dry");
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /no declara la base D1/);
  } finally {
    cleanup(fixture.directory);
  }
});

test("la guarda rechaza la beta sin assets declarados", () => {
  const document = betaDocument();
  delete document.env.beta.assets;
  const fixture = writeFixture(document);
  try {
    const result = runGuard(fixture.configPath, "--dry");
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /no declara assets/);
  } finally {
    cleanup(fixture.directory);
  }
});

test("la guarda rechaza workers_dev desactivado en la beta", () => {
  const fixture = writeFixture(betaDocument({ workers_dev: false }));
  try {
    const result = runGuard(fixture.configPath, "--dry");
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /workers_dev debe ser true/);
  } finally {
    cleanup(fixture.directory);
  }
});

test("la guarda reconoce un UUID real y lo acepta en modo estricto", () => {
  const fixture = writeFixture(betaDocument({ d1_databases: [localDatabase(BETA_DATABASE_NAME, REAL_UUID)] }));
  try {
    const result = runGuard(fixture.configPath, "--require-real");
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /D1 database_id:\s+REAL/);
    assert.match(result.output, /destino beta coherente y con database_id real/);
  } finally {
    cleanup(fixture.directory);
  }
});

test("la guarda rechaza el mismo database_id real en local y en beta", () => {
  const document = betaDocument({ d1_databases: [localDatabase(BETA_DATABASE_NAME, REAL_UUID)] });
  document.d1_databases = [localDatabase(TOP_LEVEL_EXPECTATIONS.databaseName, REAL_UUID)];
  const fixture = writeFixture(document);
  try {
    const result = runGuard(fixture.configPath, "--require-real");
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /idéntico al del entorno local/);
  } finally {
    cleanup(fixture.directory);
  }
});

test("la guarda rechaza un database_id inválido o ausente", () => {
  const invalid = writeFixture(betaDocument({ d1_databases: [localDatabase(BETA_DATABASE_NAME, "no-es-un-uuid")] }));
  try {
    const result = runGuard(invalid.configPath, "--dry");
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /no es un UUID ni el marcador esperado/);
  } finally {
    cleanup(invalid.directory);
  }
  const empty = writeFixture(betaDocument({ d1_databases: [{ binding: "DB", database_name: BETA_DATABASE_NAME, migrations_dir: "migrations" }] }));
  try {
    const result = runGuard(empty.configPath, "--dry");
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /no declara database_id/);
  } finally {
    cleanup(empty.directory);
  }
});

test("la guarda usa el código 2 ante un argumento desconocido", () => {
  const result = runGuard(realConfigPath, "--operacion-remota");
  assert.equal(result.status, 2, result.output);
  assert.match(result.output, /Argumento no reconocido/);
});

test("la guarda es local: no autentica ni invoca comandos remotos", () => {
  // Con un token inválido la guarda debe seguir funcionando: no consulta Cloudflare.
  const guarded = runGuard(realConfigPath, "--dry");
  assert.equal(guarded.status, 0, guarded.output);
  assert.doesNotMatch(guarded.output, /cloudflare\.com|api\.cloudflare/i);
  for (const source of [sharedModule, guardScript]) {
    const text = readFileSync(source, "utf8");
    assert.doesNotMatch(text, /--remote/, `${source} no debe mencionar la bandera --remote`);
    assert.doesNotMatch(text, /fetch\s*\(/, `${source} no debe hacer peticiones de red`);
    assert.doesNotMatch(text, /node_modules[\\/]wrangler/, `${source} no debe invocar Wrangler`);
    assert.doesNotMatch(text, /spawn|execFile/, `${source} no debe ejecutar procesos`);
  }
});

test("el verificador del config aplanado acepta el aplanado beta con marcador de ceros", () => {
  const directory = mkdtempSync(join(tmpdir(), "profemacon-beta-flat-"));
  try {
    mkdirSync(join(directory, "client"), { recursive: true });
    writeFileSync(join(directory, "client", "index.html"), "<!doctype html><title>Profe Macón 2.0</title>");
    const flattened = {
      name: BETA_WORKER_NAME,
      assets: { ...ASSETS, directory: "../client" },
      d1_databases: [localDatabase(BETA_DATABASE_NAME)],
    };
    const result = verifyFlattenedBetaConfig(flattened, { configDir: join(directory, "worker") });
    assert.equal(result.ok, true, result.errors.join("; "));
    assert.equal(result.databaseId.kind, "placeholder");
    assert.ok(result.details.some((detail) => detail.includes("profemacon-beta-remote")));
  } finally {
    cleanup(directory);
  }
});

test("el verificador rechaza un aplanado que quedó en el entorno local", () => {
  const result = verifyFlattenedBetaConfig({
    name: TOP_LEVEL_EXPECTATIONS.name,
    assets: { ...ASSETS, directory: "../client" },
    d1_databases: [localDatabase()],
  }, { configDir: null });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes(BETA_WORKER_NAME)));
  assert.ok(result.errors.some((error) => error.includes("profemacon-beta-remote")));
});

test("el verificador rechaza un directorio de assets inexistente o sin index.html", () => {
  const directory = mkdtempSync(join(tmpdir(), "profemacon-beta-flat-"));
  try {
    const flattened = {
      name: BETA_WORKER_NAME,
      assets: { ...ASSETS, directory: "../client" },
      d1_databases: [localDatabase(BETA_DATABASE_NAME)],
    };
    const missingDirectory = verifyFlattenedBetaConfig(flattened, { configDir: directory });
    assert.equal(missingDirectory.ok, false);
    assert.ok(missingDirectory.errors.some((error) => error.includes("no existe")));
    mkdirSync(join(directory, "client"), { recursive: true });
    const missingIndex = verifyFlattenedBetaConfig(flattened, { configDir: directory });
    assert.equal(missingIndex.ok, false);
    assert.ok(missingIndex.errors.some((error) => error.includes("index.html")));
  } finally {
    cleanup(directory);
  }
});

test("el smoke test rechaza la falta de URL y el http sin permiso explícito", () => {
  const withoutUrl = spawnSync(process.execPath, [smokeScript], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, BETA_BASE_URL: "" },
  });
  assert.equal(withoutUrl.status, 2, withoutUrl.stdout ?? "");
  assert.match(`${withoutUrl.stdout ?? ""}${withoutUrl.stderr ?? ""}`, /Falta la URL base/);

  const insecureUrl = spawnSync(process.execPath, [smokeScript, "http://127.0.0.1:5173"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, BETA_BASE_URL: "" },
  });
  assert.equal(insecureUrl.status, 2, insecureUrl.stdout ?? "");
  assert.match(`${insecureUrl.stdout ?? ""}${insecureUrl.stderr ?? ""}`, /Se espera una URL https/);
});

test("el smoke test no contiene URLs ni secretos fijos", () => {
  const text = readFileSync(smokeScript, "utf8");
  assert.doesNotMatch(text, /workers\.dev/);
  assert.doesNotMatch(text, /profemacon/i);
  assert.doesNotMatch(text, /CLOUDFLARE_API_TOKEN|DOCUMENT_HMAC_KEY|CLOUDFLARE_ACCOUNT_ID/);
  assert.match(text, /PM-DEMO-ESTUDIANTE-2026/);
});

test("las utilidades locales distinguen comentarios, comas finales y database_id", () => {
  const document = parseJsonc(`{
    // comentario de línea
    "name": "demo", /* comentario de bloque */
    "d1_databases": [{ "database_id": "${PLACEHOLDER_DATABASE_ID}" },],
  }`);
  assert.equal(document.name, "demo");
  assert.equal(describeDatabaseId(PLACEHOLDER_DATABASE_ID).kind, "placeholder");
  assert.equal(describeDatabaseId(REAL_UUID).kind, "real");
  assert.equal(describeDatabaseId("  ").kind, "empty");
  assert.equal(describeDatabaseId("abc").kind, "invalid");
});

test("readBetaTarget y validateBetaTarget describen la configuración real del repositorio", () => {
  const target = readBetaTarget(realConfigPath);
  const state = describeDatabaseId(target.beta.d1.database_id);
  assert.deepEqual(target.environmentNames, ["beta"]);
  assert.equal(target.beta.name, BETA_WORKER_NAME);
  assert.equal(target.beta.d1.database_name, BETA_DATABASE_NAME);
  assert.equal(validateBetaTarget(target, { allowPlaceholder: true }).ok, true);
  // En modo estricto la config real sólo es válida cuando la provisión ya ocurrió.
  assert.equal(validateBetaTarget(target, { allowPlaceholder: false }).ok, state.kind === "real");
});


