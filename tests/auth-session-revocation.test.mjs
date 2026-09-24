// Revocación global de sesiones (A2.1a-L): migración 0012, primitiva interna y flujo real.
//
// Tres niveles, sin mocks:
//   1. esquema: 0012 aplicada sobre una D1 local que ya tiene datos históricos de 0011;
//   2. integración real: workerd + D1 local. El `main` de la configuración temporal es
//      `tests/support/session-revocation-entry.ts`, que agrega la sonda de la primitiva
//      interna `revokeAllSessions` —todavía sin endpoint público— y delega TODO lo demás
//      en el manejador de producción, así que las rutas protegidas probadas son las
//      desplegables;
//   3. contratos de fuente acotados: un único validador de sesión, una única sentencia de
//      creación de sesión y una revocación sin condición de techo.
//
// La atomicidad se comprueba contra D1 real: un fallo del CHECK dentro del batch no debe
// dejar ni sesiones revocadas ni eventos de auditoría a medias.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import * as fileSystem from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sha256Hex } from "../worker/auth-crypto.ts";

const projectRoot = process.cwd();
const workerDir = join(projectRoot, "worker");
const wranglerBin = join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const repoMigrations = join(projectRoot, "migrations");
const harnessEntry = join(projectRoot, "tests", "support", "session-revocation-entry.ts");
const productionEntry = join(workerDir, "index.ts");
const DATABASE_NAME = "profemacon-beta-local";
const TOTAL_MIGRATIONS = 12;
const MIGRATIONS_BEFORE_VERSIONING = 11;
const MAX_AUTH_VERSION = 2147483647;
const PASSWORD = "Frase ficticia de prueba suficientemente larga";
const ACTIVATION_CODE = "PM-PRUEBA-REVOCACION-2026";
const PROBE_HEADER = "x-prueba-revocacion-global";
const PROBE_VALUE = "prueba-local-revocacion-global";

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

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const { port } = address;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

/** Copia las primeras `count` migraciones del repositorio a un directorio temporal. */
function copyMigrations(destination, count) {
  mkdirSync(destination, { recursive: true });
  const files = readdirSync(repoMigrations).filter((name) => name.endsWith(".sql")).sort();
  assert.equal(files.length, TOTAL_MIGRATIONS, `El repositorio debe tener ${TOTAL_MIGRATIONS} migraciones`);
  for (const file of files.slice(0, count)) {
    writeFileSync(join(destination, file), readFileSync(join(repoMigrations, file), "utf8"));
  }
  return destination;
}

function writeWorkerConfig(persistenceRoot, migrationsDir, name, entry = productionEntry) {
  const configPath = join(persistenceRoot, `wrangler.${name}.json`);
  writeFileSync(configPath, JSON.stringify({
    name: `profemacon-${name}-test`,
    compatibility_date: "2026-07-20",
    main: entry,
    d1_databases: [{
      binding: "DB",
      database_name: DATABASE_NAME,
      database_id: "00000000-0000-0000-0000-000000000000",
      migrations_dir: migrationsDir,
    }],
  }, null, 2));
  return configPath;
}

function runMigrations(persistenceRoot, configPath) {
  return spawnSync(process.execPath, [
    wranglerBin, "d1", "migrations", "apply", DATABASE_NAME,
    "--local", "--persist-to", persistenceRoot, "--config", configPath,
  ], { cwd: projectRoot, encoding: "utf8" });
}

function applyMigrations(persistenceRoot, configPath) {
  const result = runMigrations(persistenceRoot, configPath);
  assert.equal(result.status, 0, `Las migraciones fallaron: ${result.stdout ?? ""}${result.stderr ?? ""}`);
}

function databasePathOf(persistenceRoot) {
  const databasePath = findSqliteFile(persistenceRoot);
  assert.ok(databasePath, "La prueba necesita una base D1 local");
  return databasePath;
}

/** Abre la D1 temporal con un lector independiente del Worker. */
function openDatabase(databasePath) {
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  return database;
}

/**
 * Eliminación del espacio de trabajo tolerante a los bloqueos transitorios de Windows.
 *
 * Al terminar `wrangler d1 migrations apply`, el archivo SQLite del estado local queda con
 * un handle que Windows libera unos segundos después: sin reintentos, la limpieza falla con
 * `EPERM` y haría fallar una prueba ya aprobada. Es un fallo conocido del entorno
 * (documentado en `docs/estado-actual-interno.md`), no del código bajo prueba. Sólo se
 * reintenta ante `EPERM`/`EBUSY`/`ENOTEMPTY`; cualquier otro error se propaga.
 *
 * Si aun así no se puede borrar, se deja un aviso y NO se falla la prueba: el directorio es
 * un espacio temporal ficticio en `%TEMP%` y su contenido no afecta a ninguna aserción.
 */
function rmSync(directory, options = {}) {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  const retryable = ["EPERM", "EBUSY", "ENOTEMPTY"];
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      fileSystem.rmSync(directory, options);
      return;
    } catch (error) {
      const code = error && typeof error === "object" ? error.code : undefined;
      if (!retryable.includes(code)) throw error;
      if (attempt === 12) {
        console.warn(`No fue posible eliminar el espacio temporal de la prueba (${code}); se continúa.`);
        return;
      }
      Atomics.wait(shared, 0, 0, 400);
    }
  }
}

/**
 * `fetch` con tiempo límite. Sin él, un Worker que no llega a compilar deja la petición
 * pendiente para siempre y la suite quedaría colgada en lugar de fallar.
 */
function fetchWithTimeout(url, init = {}, timeoutMs = 30_000) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

/**
 * `fetch` de las pruebas. Reintenta únicamente ante `503`, que es lo que devuelve el
 * servidor de Wrangler mientras el aislamiento se reinicia bajo carga: el Worker de este
 * proyecto no responde `503` en ninguna ruta (`/api/*` usa `401`, `403`, `404`, `409` y
 * `500`), así que reintentar no puede tapar un fallo de la aplicación.
 */
async function fetchWithRetry(url, init = {}, { timeoutMs = 30_000, attempts = 5 } = {}) {
  let response = await fetchWithTimeout(url, init, timeoutMs);
  for (let attempt = 1; attempt < attempts && response.status === 503; attempt += 1) {
    await response.arrayBuffer();
    await new Promise((resolve) => setTimeout(resolve, 500));
    response = await fetchWithTimeout(url, init, timeoutMs);
  }
  return response;
}

async function startWorker(persistenceRoot, configPath) {
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let output = "";
  let exited = false;
  const worker = spawn(process.execPath, [
    wranglerBin, "dev", "--config", configPath, "--local", "--port", String(port), "--persist-to", persistenceRoot,
  ], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, XDG_CONFIG_HOME: persistenceRoot },
  });
  worker.stdout.on("data", (chunk) => { output += String(chunk); });
  worker.stderr.on("data", (chunk) => { output += String(chunk); });
  worker.on("exit", () => { exited = true; });

  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      // El sondeo exige la respuesta del manejador real (`401` sin cookie en `/api/session`).
      // Un `503` de Wrangler significa que el artefacto todavía no está listo y no sirve como
      // señal de inicio: aceptarlo dejaba pasar un Worker a medio levantar.
      const response = await fetchWithTimeout(`${baseUrl}/api/session`, {}, 5_000);
      if (response.status === 401) {
        await response.arrayBuffer();
        return { worker, baseUrl, output: () => output, hasExited: () => exited };
      }
      await response.arrayBuffer();
    } catch {
      // El Worker todavía no escucha: se reintenta.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Wrangler no inició el Worker local: ${output.slice(-2000)}`);
}

async function stopWorker(worker) {
  if (!worker || worker.killed) return;
  const exited = once(worker, "exit");
  worker.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))]);
  // En Windows los identificadores del archivo SQLite se liberan un instante después de
  // la salida del proceso: se deja un margen antes de abrir la base.
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function openDatabaseAfterWorker(databasePath, attempts = 10) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return openDatabase(databasePath);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw lastError;
}

/** Espacio de trabajo: persistencia temporal, migraciones y configuración del Worker. */
function createWorkspace(prefix, { migrations = TOTAL_MIGRATIONS, entry = harnessEntry } = {}) {
  const persistenceRoot = mkdtempSync(join(tmpdir(), prefix));
  const migrationsDir = copyMigrations(join(persistenceRoot, "migrations"), migrations);
  const configPath = writeWorkerConfig(persistenceRoot, migrationsDir, prefix.replace(/[^a-z0-9-]/gi, "") || "revocation", entry);
  return { persistenceRoot, migrationsDir, configPath };
}

async function seedAccount(database, { userId = 1, username = "estudiante-prueba", code = ACTIVATION_CODE } = {}) {
  database.exec(`
    INSERT INTO roles (id, codigo, nombre) VALUES (1, 'estudiante', 'Estudiante');
    INSERT INTO usuarios (id, nombre_usuario, nombre_mostrado) VALUES (${userId}, '${username}', 'Estudiante de prueba');
  `);
  database.prepare(`
    INSERT INTO activaciones_cuenta (id, usuario_id, codigo_hash, expira_en)
    VALUES (?1, ?2, ?3, '2099-12-31 23:59:59')
  `).run(`activacion-${userId}`, userId, await sha256Hex(code));
}

async function postJson(baseUrl, path, body, cookie = null) {
  const headers = { Origin: baseUrl, "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  const response = await fetchWithRetry(`${baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { response, body: await response.json().catch(() => null) };
}

function sessionCookieOf(response) {
  return (response.headers.get("set-cookie") ?? "").split(";", 1)[0] ?? "";
}

async function sessionStatus(baseUrl, cookie) {
  const response = await fetchWithRetry(`${baseUrl}/api/session`, { headers: { Cookie: cookie } });
  await response.arrayBuffer();
  return response.status;
}

async function statusWithCookie(baseUrl, path, cookie, method = "GET") {
  const headers = { Cookie: cookie };
  if (method !== "GET") {
    headers.Origin = baseUrl;
    headers["Content-Type"] = "application/json";
  }
  const response = await fetchWithRetry(`${baseUrl}${path}`, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify({}),
  });
  await response.arrayBuffer();
  return response.status;
}

/** Invoca la sonda de la primitiva interna `revokeAllSessions` del Worker de prueba. */
async function probeRevokeAll(baseUrl, payload) {
  const response = await fetchWithRetry(`${baseUrl}/api/test/revocacion-global`, {
    method: "POST",
    headers: { [PROBE_HEADER]: PROBE_VALUE, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { response, body: await response.json().catch(() => null) };
}

function auditRows(database) {
  return database.prepare(`
    SELECT actor_usuario_id, accion, entidad_tipo, entidad_id, datos_json, creado_en
    FROM eventos_auditoria WHERE accion = 'sessions_revoked' ORDER BY id
  `).all();
}

function sessionsOf(database, userId = 1) {
  return database.prepare(`
    SELECT id, token_hash, auth_version, creada_en, expira_en, ultimo_uso_en, revocada_en
    FROM sesiones_usuario WHERE usuario_id = ?1 ORDER BY creada_en, token_hash
  `).all(userId);
}

/**
 * Estados de sesión independientes del orden. `creada_en` tiene resolución de segundo, así
 * que varias sesiones creadas en el mismo segundo se ordenan por hash de token: comparar
 * la lista cruda sería frágil.
 */
function sessionStates(database, userId = 1) {
  return sessionsOf(database, userId)
    .map((row) => `${row.auth_version}:${row.revocada_en === null ? "vigente" : "revocada"}`)
    .sort();
}

/** Esquema 0011 con historia ficticia, listo para recibir 0012. */
function createWorkspaceAtSchema0011(prefix) {
  const persistenceRoot = mkdtempSync(join(tmpdir(), prefix));
  const baselineDir = copyMigrations(join(persistenceRoot, "migrations-base"), MIGRATIONS_BEFORE_VERSIONING);
  applyMigrations(persistenceRoot, writeWorkerConfig(persistenceRoot, baselineDir, "baseline"));
  return { persistenceRoot, databasePath: databasePathOf(persistenceRoot) };
}

const HISTORICAL_SESSIONS = [
  { id: "hist-vigente", tokenHash: "H".repeat(64), expira: "2099-01-01 00:00:00", ultimoUso: "2026-09-01 10:00:00", revocada: null },
  { id: "hist-revocada", tokenHash: "I".repeat(64), expira: "2099-01-01 00:00:00", ultimoUso: "2026-09-02 11:30:00", revocada: "2026-09-02 12:00:00" },
];

function insertHistoricalData(database) {
  database.exec(`
    INSERT INTO roles (id, codigo, nombre) VALUES (1, 'estudiante', 'Estudiante');
    INSERT INTO usuarios (id, nombre_usuario, nombre_mostrado, estado, correo) VALUES
      (1, 'historia-activa', 'Historia activa', 'activo', 'activa@ficticio.test'),
      (2, 'historia-suspendida', 'Historia suspendida', 'suspendido', NULL);
  `);
  const insert = database.prepare(`
    INSERT INTO sesiones_usuario (id, usuario_id, token_hash, creada_en, expira_en, ultimo_uso_en, revocada_en)
    VALUES (?1, 1, ?2, '2026-09-01 09:00:00', ?3, ?4, ?5)
  `);
  for (const session of HISTORICAL_SESSIONS) {
    insert.run(session.id, session.tokenHash, session.expira, session.ultimoUso, session.revocada);
  }
}

test("0012 aplica sobre el esquema 0011 y versiona lo histórico sin reescribirlo", () => {
  const { persistenceRoot, databasePath } = createWorkspaceAtSchema0011("profemacon-auth-version-");
  try {
    const before = openDatabase(databasePath);
    assert.equal(before.prepare("SELECT COUNT(*) AS total FROM d1_migrations").get().total, MIGRATIONS_BEFORE_VERSIONING);
    for (const table of ["usuarios", "sesiones_usuario"]) {
      const columns = before.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
      assert.ok(!columns.includes("auth_version"), `${table} no debe tener auth_version antes de 0012`);
    }
    insertHistoricalData(before);
    before.close();

    applyMigrations(persistenceRoot, writeWorkerConfig(persistenceRoot, repoMigrations, "actual"));

    const after = openDatabase(databasePath);
    // A. Usuarios preexistentes en la versión inicial 1, con la columna NOT NULL DEFAULT 1.
    const userColumn = after.prepare("PRAGMA table_info(usuarios)").all().find((row) => row.name === "auth_version");
    assert.ok(userColumn, "0012 debe agregar usuarios.auth_version");
    assert.equal(userColumn.notnull, 1);
    assert.equal(String(userColumn.dflt_value), "1");
    assert.match(after.prepare("SELECT sql FROM sqlite_master WHERE name = 'usuarios'").get().sql, /CHECK \(auth_version BETWEEN 1 AND 2147483647\)/);
    assert.deepEqual(
      after.prepare("SELECT id, auth_version FROM usuarios ORDER BY id").all().map((row) => [row.id, row.auth_version]),
      [[1, 1], [2, 1]],
    );

    // B. Sesiones preexistentes en la versión 1, también con DEFAULT 1.
    const sessionColumn = after.prepare("PRAGMA table_info(sesiones_usuario)").all().find((row) => row.name === "auth_version");
    assert.ok(sessionColumn, "0012 debe agregar sesiones_usuario.auth_version");
    assert.equal(sessionColumn.notnull, 1);
    assert.equal(String(sessionColumn.dflt_value), "1");
    assert.deepEqual(
      sessionsOf(after)
        .map((row) => [row.id, row.auth_version])
        .sort((left, right) => left[0].localeCompare(right[0])),
      [["hist-revocada", 1], ["hist-vigente", 1]],
    );

    // C. Datos históricos intactos: hashes, vencimientos, último uso, revocación y estado.
    const kept = new Map(sessionsOf(after).map((row) => [row.id, row]));
    for (const session of HISTORICAL_SESSIONS) {
      const row = kept.get(session.id);
      assert.equal(row.token_hash, session.tokenHash);
      assert.equal(row.expira_en, session.expira);
      assert.equal(row.ultimo_uso_en, session.ultimoUso);
      assert.equal(row.revocada_en, session.revocada);
    }
    assert.deepEqual(
      after.prepare("SELECT id, nombre_mostrado, estado, correo FROM usuarios ORDER BY id").all().map((row) => ({ ...row })),
      [
        { id: 1, nombre_mostrado: "Historia activa", estado: "activo", correo: "activa@ficticio.test" },
        { id: 2, nombre_mostrado: "Historia suspendida", estado: "suspendido", correo: null },
      ],
    );
    assert.equal(after.prepare("SELECT COUNT(*) AS total FROM sesiones_usuario").get().total, HISTORICAL_SESSIONS.length);

    // Inventario de 0012: dos disparadores nuevos, sin tablas auxiliares ni índices extra.
    assert.deepEqual(
      after.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_sesion_auth_version%' ORDER BY name").all().map((row) => row.name),
      ["trg_sesion_auth_version_coherente_insert", "trg_sesion_auth_version_inmutable_update"],
    );
    assert.equal(after.prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE name LIKE 'sesiones_usuario_nueva%'").get().total, 0);
    assert.equal(after.prepare("SELECT COUNT(*) AS total FROM d1_migrations").get().total, TOTAL_MIGRATIONS);
    assert.equal(after.prepare("PRAGMA foreign_key_check").all().length, 0);
    after.close();
  } finally {
    rmSync(persistenceRoot, { recursive: true, force: true });
  }
});

test("0012 impone la coherencia de versión: inserción, inmutabilidad y CHECK fail-closed", () => {
  const { persistenceRoot, databasePath } = createWorkspaceAtSchema0011("profemacon-auth-version-check-");
  try {
    applyMigrations(persistenceRoot, writeWorkerConfig(persistenceRoot, repoMigrations, "actual"));

    const database = openDatabase(databasePath);
    database.exec(`
      INSERT INTO roles (id, codigo, nombre) VALUES (1, 'estudiante', 'Estudiante');
      INSERT INTO usuarios (id, nombre_usuario, nombre_mostrado) VALUES
        (1, 'version-uno', 'Versión uno'),
        (2, 'version-cinco', 'Versión cinco');
      UPDATE usuarios SET auth_version = 5 WHERE id = 2;
    `);
    assert.deepEqual(
      database.prepare("SELECT id, auth_version FROM usuarios ORDER BY id").all().map((row) => [row.id, row.auth_version]),
      [[1, 1], [2, 5]],
    );

    const insertSession = (prefix, userId, authVersion) => database.prepare(`
      INSERT INTO sesiones_usuario (id, usuario_id, token_hash, auth_version, expira_en, ultimo_uso_en)
      VALUES (?1, ?2, ?3, ?4, '2099-01-01 00:00:00', CURRENT_TIMESTAMP)
    `).run(prefix, userId, `${prefix}${"S".repeat(64)}`.slice(0, 64), authVersion);

    // D. El disparador de inserción exige la versión vigente del usuario.
    assert.throws(() => insertSession("d-menor", 1, 2), /ABORT|coherencia|versión/i, "Una sesión con versión futura no debe nacer");
    assert.throws(() => insertSession("d-cero", 1, 0), /ABORT|coherencia|versión/i, "Una sesión con versión 0 no debe nacer");
    assert.throws(() => insertSession("d-mayor", 2, 1), /ABORT|coherencia|versión/i, "Una sesión con versión obsoleta no debe nacer");
    // Una cuenta inexistente queda rechazada por la coherencia de versión (ninguna fila
    // puede tener su versión) antes de llegar a la clave foránea: falla cerrada igual.
    assert.throws(() => insertSession("d-inexistente", 99, 1), /ABORT|coherencia|versión|FOREIGN KEY|constraint/i, "Una sesión de una cuenta inexistente no debe nacer");
    // El DEFAULT tampoco puede colar una versión obsoleta cuando la cuenta ya avanzó.
    assert.throws(
      () => database.prepare(`
        INSERT INTO sesiones_usuario (id, usuario_id, token_hash, expira_en, ultimo_uso_en)
        VALUES ('d-default', 2, ?1, '2099-01-01 00:00:00', CURRENT_TIMESTAMP)
      `).run(`${"D".repeat(64)}`),
      /ABORT|coherencia|versión/i,
      "El DEFAULT 1 no debe saltear la coherencia de versión",
    );
    assert.doesNotThrow(() => insertSession("d-valida", 1, 1));
    assert.equal(database.prepare("SELECT COUNT(*) AS total FROM sesiones_usuario").get().total, 1, "Las inserciones rechazadas no dejan filas");

    // E. La versión de una sesión existente no se puede modificar.
    assert.throws(() => database.prepare("UPDATE sesiones_usuario SET auth_version = 5 WHERE id = 'd-valida'").run(), /ABORT|inmutable/i);
    assert.throws(() => database.prepare("UPDATE sesiones_usuario SET auth_version = auth_version + 1 WHERE id = 'd-valida'").run(), /ABORT|inmutable/i);
    assert.equal(database.prepare("SELECT auth_version FROM sesiones_usuario WHERE id = 'd-valida'").get().auth_version, 1);
    // Escribir el mismo valor no es un cambio y sigue permitido.
    assert.doesNotThrow(() => database.prepare("UPDATE sesiones_usuario SET auth_version = 1 WHERE id = 'd-valida'").run());
    // El resto de la fila sigue siendo actualizable: la revocación individual no cambia la versión.
    assert.doesNotThrow(() => database.prepare("UPDATE sesiones_usuario SET revocada_en = CURRENT_TIMESTAMP WHERE id = 'd-valida'").run());
    assert.ok(database.prepare("SELECT revocada_en FROM sesiones_usuario WHERE id = 'd-valida'").get().revocada_en);

    // F. CHECK de `usuarios.auth_version`: rango 1 .. 2147483647, sin saturación silenciosa.
    for (const invalid of [0, -1, 2147483648, null]) {
      assert.throws(
        () => database.prepare("UPDATE usuarios SET auth_version = ?1 WHERE id = 1").run(invalid),
        /CHECK|constraint|NOT NULL/i,
        `La base debía rechazar auth_version = ${invalid}`,
      );
    }
    assert.equal(database.prepare("SELECT auth_version FROM usuarios WHERE id = 1").get().auth_version, 1, "Un rechazo no cambia la versión");

    database.prepare("UPDATE usuarios SET auth_version = ?1 WHERE id = 1").run(MAX_AUTH_VERSION);
    assert.throws(
      () => database.prepare("UPDATE usuarios SET auth_version = auth_version + 1 WHERE id = 1").run(),
      /CHECK|constraint/i,
      "En el techo, el incremento debe fallar en lugar de saturar la versión",
    );
    assert.equal(database.prepare("SELECT auth_version FROM usuarios WHERE id = 1").get().auth_version, MAX_AUTH_VERSION);

    // La restricción también cubre altas nuevas, no sólo actualizaciones.
    assert.throws(
      () => database.prepare("INSERT INTO usuarios (id, nombre_usuario, nombre_mostrado, auth_version) VALUES (3, 'alta-cero', 'Alta cero', 0)").run(),
      /CHECK|constraint/i,
    );
    assert.equal(database.prepare("SELECT COUNT(*) AS total FROM usuarios").get().total, 2);
    database.close();
  } finally {
    rmSync(persistenceRoot, { recursive: true, force: true });
  }
});

/** Espacio de trabajo real: esquema completo, cuenta ficticia y Worker de prueba. */
async function startReadyWorker(prefix) {
  const { persistenceRoot, configPath } = createWorkspace(prefix);
  applyMigrations(persistenceRoot, configPath);
  const databasePath = databasePathOf(persistenceRoot);
  const setup = openDatabase(databasePath);
  await seedAccount(setup);
  setup.close();
  const started = await startWorker(persistenceRoot, configPath);
  return { persistenceRoot, configPath, databasePath, started };
}

async function activate(baseUrl) {
  const result = await postJson(baseUrl, "/api/auth/activate", {
    username: "estudiante-prueba", activationCode: ACTIVATION_CODE, password: PASSWORD,
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return { cookie: sessionCookieOf(result.response), response: result.response };
}

async function login(baseUrl) {
  const result = await postJson(baseUrl, "/api/auth/login", { username: "estudiante-prueba", password: PASSWORD });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return { cookie: sessionCookieOf(result.response), response: result.response };
}

function tokenOf(cookie) {
  return cookie.slice(cookie.indexOf("=") + 1);
}

test("la sesión copia la versión vigente y la revocación global corta el acceso", async (t) => {
  const { persistenceRoot, databasePath, started } = await startReadyWorker("profemacon-revocation-flow-");
  let worker = started.worker;
  t.after(async () => {
    await stopWorker(worker);
    rmSync(persistenceRoot, { recursive: true, force: true });
  });
  const { baseUrl } = started;

  // 1. Sesión nueva (activación) sobre una cuenta en la versión inicial.
  const first = await activate(baseUrl);
  assert.equal(await sessionStatus(baseUrl, first.cookie), 200);
  // 2. Otra sesión, por login, para tener dos afectadas por la misma revocación.
  const second = await login(baseUrl);
  assert.equal(await sessionStatus(baseUrl, second.cookie), 200);

  // 5, 6, 7 y 8. Una sola llamada revoca las dos sesiones e incrementa la versión una vez.
  const revoked = await probeRevokeAll(baseUrl, { userId: 1, reason: "security", actorUserId: null });
  assert.equal(revoked.response.status, 200, JSON.stringify(revoked.body));
  assert.deepEqual(revoked.body, { ok: true, authVersion: 2, revokedSessions: 2 });

  // 3, 4 y 14. Ambas sesiones quedan inválidas: revocadas explícitamente y con versión vieja.
  assert.equal(await sessionStatus(baseUrl, first.cookie), 401);
  assert.equal(await sessionStatus(baseUrl, second.cookie), 401);

  // 10 y 11. Una sesión posterior usa la versión nueva y funciona.
  const third = await login(baseUrl);
  assert.equal(await sessionStatus(baseUrl, third.cookie), 200);

  await stopWorker(worker);
  worker = undefined;

  const database = await openDatabaseAfterWorker(databasePath);
  assert.equal(database.prepare("SELECT auth_version FROM usuarios WHERE id = 1").get().auth_version, 2);
  const sessions = sessionsOf(database);
  assert.equal(sessions.length, 3);
  assert.deepEqual(sessionStates(database), ["1:revocada", "1:revocada", "2:vigente"]);
  // El token en claro nunca se persiste: sólo su SHA-256.
  const storedHashes = new Set(sessions.map((row) => row.token_hash));
  for (const entry of [first, second, third]) {
    const token = tokenOf(entry.cookie);
    assert.equal(database.prepare("SELECT COUNT(*) AS total FROM sesiones_usuario WHERE token_hash = ?1").get(token).total, 0);
    assert.ok(storedHashes.has(await sha256Hex(token)), "Cada sesión persistida debe corresponder al hash de su token");
  }

  // 19 y 20. Auditoría con metadata mínima y sin secretos.
  const rows = auditRows(database);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].accion, "sessions_revoked");
  assert.equal(rows[0].entidad_tipo, "usuario");
  assert.equal(rows[0].entidad_id, "1");
  assert.equal(rows[0].actor_usuario_id, null);
  assert.deepEqual(JSON.parse(rows[0].datos_json), { motivo: "security" });
  const serialized = JSON.stringify(rows[0]);
  for (const entry of [first, second, third]) assert.ok(!serialized.includes(tokenOf(entry.cookie)), "La auditoría no debe contener tokens");
  for (const row of sessions) assert.ok(!serialized.includes(row.token_hash), "La auditoría no debe contener hashes de token");
  assert.ok(!serialized.includes(PASSWORD), "La auditoría no debe contener contraseñas");
  database.close();

  // Los registros del runtime tampoco exponen credenciales.
  const log = started.output();
  assert.ok(!log.includes(PASSWORD));
  assert.ok(!log.includes(tokenOf(third.cookie)));
});

test("el logout individual no cambia la versión y la revocación global es exacta e idempotente", async (t) => {
  const { persistenceRoot, databasePath, started } = await startReadyWorker("profemacon-revocation-logout-");
  let worker = started.worker;
  t.after(async () => {
    await stopWorker(worker);
    rmSync(persistenceRoot, { recursive: true, force: true });
  });
  const { baseUrl } = started;

  const first = await activate(baseUrl);
  const second = await login(baseUrl);
  const third = await login(baseUrl);
  assert.equal(await sessionStatus(baseUrl, third.cookie), 200);

  // 12 y 13. Logout individual: revoca sólo esa sesión y no toca la versión.
  const logout = await postJson(baseUrl, "/api/auth/logout", {}, second.cookie);
  assert.equal(logout.response.status, 200, JSON.stringify(logout.body));
  assert.equal(await sessionStatus(baseUrl, second.cookie), 401);
  assert.equal(await sessionStatus(baseUrl, first.cookie), 200);
  assert.equal(await sessionStatus(baseUrl, third.cookie), 200);

  // 5, 6, 7 y 8. La revocación global alcanza exactamente las dos vigentes.
  const revokeFirst = await probeRevokeAll(baseUrl, { userId: 1, reason: "admin", actorUserId: 1 });
  assert.equal(revokeFirst.response.status, 200, JSON.stringify(revokeFirst.body));
  assert.deepEqual(revokeFirst.body, { ok: true, authVersion: 2, revokedSessions: 2 });
  assert.equal(await sessionStatus(baseUrl, first.cookie), 401);
  assert.equal(await sessionStatus(baseUrl, third.cookie), 401);

  // 9. Segundo ciclo consecutivo: exactamente +1 y ya no queda nada vigente.
  const revokeSecond = await probeRevokeAll(baseUrl, { userId: 1, reason: "admin", actorUserId: 1 });
  assert.equal(revokeSecond.response.status, 200, JSON.stringify(revokeSecond.body));
  assert.deepEqual(revokeSecond.body, { ok: true, authVersion: 3, revokedSessions: 0 });

  const fourth = await login(baseUrl);
  assert.equal(await sessionStatus(baseUrl, fourth.cookie), 200);

  await stopWorker(worker);
  worker = undefined;

  const database = await openDatabaseAfterWorker(databasePath);
  assert.equal(database.prepare("SELECT auth_version FROM usuarios WHERE id = 1").get().auth_version, 3);
  const sessions = sessionsOf(database);
  assert.equal(sessions.length, 4);
  assert.deepEqual(sessionStates(database), ["1:revocada", "1:revocada", "1:revocada", "3:vigente"]);
  // 19. Sólo las dos revocaciones globales quedan auditadas: el logout no es `sessions_revoked`.
  const rows = auditRows(database);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => [row.actor_usuario_id, row.entidad_tipo, row.entidad_id, JSON.parse(row.datos_json).motivo]),
    [[1, "usuario", "1", "admin"], [1, "usuario", "1", "admin"]],
  );
  assert.equal(database.prepare("SELECT COUNT(*) AS total FROM eventos_auditoria WHERE accion LIKE '%logout%'").get().total, 0);
  database.close();
});

test("mismatch de versión, expiración, inactividad y estado siguen rechazando", async (t) => {
  const ready = await startReadyWorker("profemacon-revocation-rejects-");
  const { persistenceRoot, configPath, databasePath } = ready;
  let worker = ready.started.worker;
  t.after(async () => {
    await stopWorker(worker);
    rmSync(persistenceRoot, { recursive: true, force: true });
  });

  // La sesión de control vive en una cuenta que permanece activa y en su versión original.
  const control = await activate(ready.started.baseUrl);
  assert.equal(await sessionStatus(ready.started.baseUrl, control.cookie), 200);
  await stopWorker(worker);
  worker = undefined;

  const database = await openDatabaseAfterWorker(databasePath);
  database.exec(`
    INSERT INTO usuarios (id, nombre_usuario, nombre_mostrado, estado) VALUES
      (2, 'estudiante-suspendido', 'Estudiante suspendido', 'suspendido'),
      (3, 'estudiante-archivado', 'Estudiante archivado', 'archivado'),
      (4, 'estudiante-version-futura', 'Estudiante versión futura', 'activo'),
      (5, 'estudiante-version-vieja', 'Estudiante versión vieja', 'activo');
    UPDATE usuarios SET auth_version = 2 WHERE id = 4;
  `);

  const fixtures = [
    { id: "fixture-vencida", userId: 1, version: 1, creada: "-10 hours", expira: "-2 hours", ultimo: "-10 minutes" },
    { id: "fixture-inactiva", userId: 1, version: 1, creada: "-90 minutes", expira: "+6 hours", ultimo: "-45 minutes" },
    { id: "fixture-revocada", userId: 1, version: 1, creada: "-5 minutes", expira: "+6 hours", ultimo: "-1 minutes" },
    { id: "fixture-suspendido", userId: 2, version: 1, creada: "-1 minutes", expira: "+6 hours", ultimo: "-1 minutes" },
    { id: "fixture-archivado", userId: 3, version: 1, creada: "-1 minutes", expira: "+6 hours", ultimo: "-1 minutes" },
    { id: "fixture-version-futura", userId: 4, version: 2, creada: "-1 minutes", expira: "+6 hours", ultimo: "-1 minutes" },
    { id: "fixture-version-vieja", userId: 5, version: 1, creada: "-1 minutes", expira: "+6 hours", ultimo: "-1 minutes" },
  ];
  const insert = database.prepare(`
    INSERT INTO sesiones_usuario (id, usuario_id, token_hash, auth_version, creada_en, expira_en, ultimo_uso_en)
    VALUES (?1, ?2, ?3, ?4, datetime('now', ?5), datetime('now', ?6), datetime('now', ?7))
  `);
  const cookies = new Map();
  for (const fixture of fixtures) {
    const token = `${fixture.id}-${"z".repeat(40)}`;
    insert.run(fixture.id, fixture.userId, await sha256Hex(token), fixture.version, fixture.creada, fixture.expira, fixture.ultimo);
    cookies.set(fixture.id, `pm_session=${token}`);
  }
  // 14. Revocada explícitamente y, aun así, con versión que coincide.
  database.prepare("UPDATE sesiones_usuario SET revocada_en = CURRENT_TIMESTAMP WHERE id = 'fixture-revocada'").run();
  // 3 y 4. Mismatch en ambos sentidos: la sesión no se toca, la versión del usuario sí.
  database.prepare("UPDATE usuarios SET auth_version = 3 WHERE id = 5").run();
  database.prepare("UPDATE usuarios SET auth_version = 1 WHERE id = 4").run();
  const usageBefore = new Map(database.prepare(`
    SELECT id, ultimo_uso_en FROM sesiones_usuario WHERE id IN ('fixture-inactiva', 'fixture-revocada')
  `).all().map((row) => [row.id, row.ultimo_uso_en]));
  database.close();

  const secondRun = await startWorker(persistenceRoot, configPath);
  worker = secondRun.worker;
  const { baseUrl } = secondRun;

  // 3 y 4. Cualquier diferencia de versión, en cualquier sentido, es 401.
  assert.equal(await sessionStatus(baseUrl, cookies.get("fixture-version-vieja")), 401);
  assert.equal(await sessionStatus(baseUrl, cookies.get("fixture-version-futura")), 401);
  // 15. La expiración absoluta sigue vigente.
  assert.equal(await sessionStatus(baseUrl, cookies.get("fixture-vencida")), 401);
  // 16. La inactividad sigue vigente.
  assert.equal(await sessionStatus(baseUrl, cookies.get("fixture-inactiva")), 401);
  // 14. Una sesión revocada sigue inválida aunque su versión coincida.
  assert.equal(await sessionStatus(baseUrl, cookies.get("fixture-revocada")), 401);
  // 17. Un usuario suspendido o archivado no entra ni con una sesión bien versionada.
  assert.equal(await sessionStatus(baseUrl, cookies.get("fixture-suspendido")), 401);
  assert.equal(await sessionStatus(baseUrl, cookies.get("fixture-archivado")), 401);
  // Control: los rechazos anteriores no son vacíos.
  assert.equal(await sessionStatus(baseUrl, control.cookie), 200);

  await stopWorker(worker);
  worker = undefined;

  const after = await openDatabaseAfterWorker(databasePath);
  for (const [id, ultimoUso] of usageBefore) {
    assert.equal(after.prepare("SELECT ultimo_uso_en FROM sesiones_usuario WHERE id = ?1").get(id).ultimo_uso_en, ultimoUso, `La sesión ${id} no debe refrescar su último uso`);
  }
  assert.equal(after.prepare("SELECT COUNT(*) AS total FROM sesiones_usuario").get().total, fixtures.length + 1);
  assert.equal(after.prepare("SELECT COUNT(*) AS total FROM eventos_auditoria WHERE accion = 'sessions_revoked'").get().total, 0);
  after.close();
});

test("un fallo del incremento aborta la revocación completa y una cuenta inexistente no deja evento", async (t) => {
  const ready = await startReadyWorker("profemacon-revocation-failclosed-");
  const { persistenceRoot, configPath, databasePath } = ready;
  let worker = ready.started.worker;
  t.after(async () => {
    await stopWorker(worker);
    rmSync(persistenceRoot, { recursive: true, force: true });
  });

  const first = await activate(ready.started.baseUrl);
  const second = await login(ready.started.baseUrl);
  await stopWorker(worker);
  worker = undefined;

  const database = await openDatabaseAfterWorker(databasePath);
  database.prepare("UPDATE usuarios SET auth_version = ?1 WHERE id = 1").run(MAX_AUTH_VERSION);
  assert.deepEqual(sessionsOf(database).map((row) => row.revocada_en), [null, null]);
  database.close();

  const secondRun = await startWorker(persistenceRoot, configPath);
  worker = secondRun.worker;
  const { baseUrl } = secondRun;

  // D. En el techo del CHECK el incremento falla y el batch completo se aborta.
  const failed = await probeRevokeAll(baseUrl, { userId: 1, reason: "password_change" });
  assert.equal(failed.response.status, 500, JSON.stringify(failed.body));
  assert.deepEqual(failed.body, { code: "REVOCATION_ABORTED", error: "No fue posible revocar las sesiones de la cuenta." });

  // Cuenta inexistente: error controlado y sin evento fantasma.
  const missing = await probeRevokeAll(baseUrl, { userId: 9999, reason: "admin" });
  assert.equal(missing.response.status, 404, JSON.stringify(missing.body));
  assert.equal(missing.body.code, "USER_NOT_FOUND");

  // Solicitudes inválidas: se rechazan antes de tocar la base.
  for (const payload of [{ userId: 1, reason: "motivo_invalido" }, { userId: 1 }, { userId: 0, reason: "admin" }, { userId: -3, reason: "admin" }]) {
    const invalid = await probeRevokeAll(baseUrl, payload);
    assert.equal(invalid.response.status, 400, JSON.stringify(invalid.body));
    assert.equal(invalid.body.code, "INVALID_REQUEST");
  }

  // La sonda de prueba no existe sin su encabezado.
  const withoutHeader = await fetchWithTimeout(`${baseUrl}/api/test/revocacion-global`, { method: "POST" }, 10_000);
  assert.equal(withoutHeader.status, 404);
  await withoutHeader.arrayBuffer();

  // Con la cuenta en el techo, ninguna sesión entra: el estado falla cerrado.
  assert.equal(await sessionStatus(baseUrl, first.cookie), 401);
  assert.equal(await sessionStatus(baseUrl, second.cookie), 401);

  await stopWorker(worker);
  worker = undefined;

  const after = await openDatabaseAfterWorker(databasePath);
  assert.equal(
    after.prepare("SELECT auth_version FROM usuarios WHERE id = 1").get().auth_version,
    MAX_AUTH_VERSION,
    "El incremento rechazado no debe cambiar la versión",
  );
  assert.deepEqual(sessionsOf(after).map((row) => row.revocada_en), [null, null], "El rollback debe deshacer la revocación explícita de sesiones");
  assert.equal(auditRows(after).length, 0, "El rollback debe deshacer la auditoría");
  assert.equal(
    after.prepare("SELECT COUNT(*) AS total FROM eventos_auditoria WHERE accion <> 'cuenta_activada'").get().total,
    0,
    "Ninguna operación inválida debe dejar auditoría (la activación inicial es el único evento)",
  );
  after.close();
});

test("intercalado: sesión nueva frente a revocación global y revocaciones simultáneas", async (t) => {
  const ready = await startReadyWorker("profemacon-revocation-interleave-");
  const { persistenceRoot, databasePath } = ready;
  let worker = ready.started.worker;
  t.after(async () => {
    await stopWorker(worker);
    rmSync(persistenceRoot, { recursive: true, force: true });
  });
  const { baseUrl } = ready.started;

  const initial = await activate(baseUrl);
  assert.equal(await sessionStatus(baseUrl, initial.cookie), 200);

  // A. Crear una sesión mientras corre una revocación global: cualquiera de los dos
  // órdenes es aceptable, pero nunca puede quedar una sesión vigente con versión vieja.
  const [duringRevocation, createdDuring] = await Promise.all([
    probeRevokeAll(baseUrl, { userId: 1, reason: "security" }),
    login(baseUrl),
  ]);
  assert.equal(duringRevocation.response.status, 200, JSON.stringify(duringRevocation.body));
  const versionAfterFirst = duringRevocation.body.authVersion;
  assert.ok(Number.isInteger(versionAfterFirst) && versionAfterFirst > 1, "Debe informarse la versión resultante");
  // El corte de la revocación es inmediato.
  assert.equal(await sessionStatus(baseUrl, initial.cookie), 401);
  // La sesión creada en paralelo nace con la versión vigente en el instante de su INSERT;
  // si la revocación la alcanzó, queda revocada. Ningún estado intermedio es aceptable.
  const createdStatus = await sessionStatus(baseUrl, createdDuring.cookie);
  assert.ok(createdStatus === 200 || createdStatus === 401, `Estado inesperado de la sesión intercalada: ${createdStatus}`);

  // B. Dos revocaciones simultáneas no pierden incrementos.
  const [firstRevoke, secondRevoke] = await Promise.all([
    probeRevokeAll(baseUrl, { userId: 1, reason: "admin", actorUserId: 1 }),
    probeRevokeAll(baseUrl, { userId: 1, reason: "admin", actorUserId: 1 }),
  ]);
  assert.equal(firstRevoke.response.status, 200, JSON.stringify(firstRevoke.body));
  assert.equal(secondRevoke.response.status, 200, JSON.stringify(secondRevoke.body));
  const versions = [firstRevoke.body.authVersion, secondRevoke.body.authVersion].sort((a, b) => a - b);
  assert.deepEqual(versions, [versionAfterFirst + 1, versionAfterFirst + 2], "Dos revocaciones simultáneas deben sumar +2 exacto");

  // C. Estado final seguro: toda sesión anterior quedó inválida y una sesión nueva funciona.
  assert.equal(await sessionStatus(baseUrl, initial.cookie), 401);
  assert.equal(await sessionStatus(baseUrl, createdDuring.cookie), 401);
  const newest = await login(baseUrl);
  assert.equal(await sessionStatus(baseUrl, newest.cookie), 200);

  await stopWorker(worker);
  worker = undefined;

  const after = await openDatabaseAfterWorker(databasePath);
  const finalVersion = after.prepare("SELECT auth_version FROM usuarios WHERE id = 1").get().auth_version;
  assert.equal(finalVersion, versions[1], "La versión final debe coincidir con el mayor incremento informado");
  // Invariante estructural: ninguna sesión vigente puede tener una versión distinta de la actual.
  assert.equal(after.prepare(`
    SELECT COUNT(*) AS total FROM sesiones_usuario
    WHERE revocada_en IS NULL AND auth_version <> (SELECT auth_version FROM usuarios WHERE id = 1)
  `).get().total, 0);
  assert.equal(after.prepare("SELECT COUNT(*) AS total FROM sesiones_usuario WHERE revocada_en IS NULL").get().total, 1);

  const createdRow = after.prepare("SELECT auth_version, revocada_en FROM sesiones_usuario WHERE token_hash = ?1").get(await sha256Hex(tokenOf(createdDuring.cookie)));
  assert.ok(createdRow, "La sesión creada durante el intercalado debe existir");
  assert.ok(createdRow.revocada_en !== null, "Las revocaciones posteriores deben dejarla revocada");
  assert.ok(createdRow.auth_version <= finalVersion, "Nunca puede tener una versión posterior a la vigente");

  const newestRow = after.prepare("SELECT auth_version, revocada_en FROM sesiones_usuario WHERE token_hash = ?1").get(await sha256Hex(tokenOf(newest.cookie)));
  assert.equal(newestRow.auth_version, finalVersion, "La sesión nueva debe copiar la versión vigente");
  assert.equal(newestRow.revocada_en, null);

  // 19. Tres revocaciones globales quedan auditadas y ninguna registra secretos.
  const rows = auditRows(after);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.deepEqual(Object.keys(JSON.parse(row.datos_json)), ["motivo"]);
    assert.ok(!JSON.stringify(row).includes(tokenOf(newest.cookie)));
  }
  after.close();
});

test("todas las rutas protegidas exigen la versión vigente", async (t) => {
  const ready = await startReadyWorker("profemacon-revocation-routes-");
  const { persistenceRoot } = ready;
  let worker = ready.started.worker;
  t.after(async () => {
    await stopWorker(worker);
    rmSync(persistenceRoot, { recursive: true, force: true });
  });
  const { baseUrl } = ready.started;

  const control = await activate(baseUrl);
  assert.equal(await sessionStatus(baseUrl, control.cookie), 200);

  // 18. Todas las rutas protegidas pasan por el validador común: ninguna responde 401
  // con una sesión vigente ni acepta una sesión sin cookie.
  const protectedRoutes = [
    ["GET", "/api/session"],
    ["GET", "/api/me/courses"],
    ["GET", "/api/account-activations/candidates"],
    ["GET", "/api/teacher/groups/1"],
    ["GET", "/api/teacher/activities/actividad-inexistente/preview"],
    ["GET", "/api/me/activities/actividad-inexistente"],
    ["GET", "/api/me/activities/actividad-inexistente/review"],
    ["POST", "/api/student-imports/preview"],
    ["POST", "/api/account-activations/reissue"],
    ["PUT", "/api/teacher/groups/1/activities/1/availability"],
  ];
  for (const [method, path] of protectedRoutes) {
    const status = await statusWithCookie(baseUrl, path, control.cookie, method);
    assert.notEqual(status, 401, `${method} ${path} debe aceptar una sesión vigente y respondió ${status}`);
  }

  const revoked = await probeRevokeAll(baseUrl, { userId: 1, reason: "security" });
  assert.equal(revoked.response.status, 200, JSON.stringify(revoked.body));

  for (const [method, path] of protectedRoutes) {
    const status = await statusWithCookie(baseUrl, path, control.cookie, method);
    assert.equal(status, 401, `${method} ${path} debe exigir la versión vigente y respondió ${status}`);
  }

  for (const [method, path] of protectedRoutes) {
    const status = await statusWithCookie(baseUrl, path, "", method);
    assert.equal(status, 401, `${method} ${path} debe exigir sesión y respondió ${status}`);
  }

  await stopWorker(worker);
  worker = undefined;
});

function workerSources() {
  return new Map(
    readdirSync(workerDir).filter((name) => name.endsWith(".ts")).map((name) => [name, readFileSync(join(workerDir, name), "utf8")]),
  );
}

test("contratos: un único validador de sesión y una única creación versionada", () => {
  const sources = workerSources();
  const auth = sources.get("auth.ts");
  const localAuth = sources.get("local-auth.ts");
  const revocation = sources.get("session-revocation.ts");
  assert.ok(auth && localAuth && revocation, "Los tres módulos deben existir");

  // Un único validador en todo el Worker.
  assert.deepEqual(
    [...sources].filter(([, text]) => text.includes("export async function authenticateRequest")).map(([name]) => name),
    ["auth.ts"],
  );
  for (const guard of [
    "s.token_hash = ?1",
    "s.revocada_en IS NULL",
    "s.expira_en > CURRENT_TIMESTAMP",
    "COALESCE(s.ultimo_uso_en, s.creada_en) > datetime('now', '-30 minutes')",
    "s.auth_version = u.auth_version",
    "u.estado = 'activo'",
  ]) {
    assert.ok(auth.includes(guard), `auth.ts debe conservar el control ${guard}`);
  }
  // La marca de último uso no revive una sesión que dejó de ser válida.
  assert.match(auth, /UPDATE sesiones_usuario\s+SET ultimo_uso_en = CURRENT_TIMESTAMP\s+WHERE id = \?1 AND revocada_en IS NULL/);

  // Una única creación de sesión, con la versión copiada en la misma sentencia.
  assert.deepEqual([...sources].filter(([, text]) => text.includes("INSERT INTO sesiones_usuario")).map(([name]) => name), ["local-auth.ts"]);
  assert.match(
    localAuth,
    /INSERT INTO sesiones_usuario \(id, usuario_id, token_hash, auth_version, expira_en, ultimo_uso_en\)\s+SELECT \?1, u\.id, \?2, u\.auth_version/,
  );
  assert.match(localAuth, /FROM usuarios u\s+WHERE u\.id = \?3\s+AND u\.estado = 'activo'/);
  assert.doesNotMatch(localAuth, /export async function createLocalSession|export function createLocalSession/, "El token sólo vuelve al llamador que construye la cookie");
  assert.match(localAuth, /export function sessionCookie\(token: string, request: Request\)/);

  // Sesiones sólo en los tres módulos autorizados: nadie valida por su cuenta.
  assert.deepEqual(
    [...sources].filter(([, text]) => text.includes("sesiones_usuario")).map(([name]) => name).sort(),
    ["auth.ts", "local-auth.ts", "session-revocation.ts"],
  );

  // Revocación: batch atómico, incremento sin condición de techo y auditoría con EXISTS.
  assert.match(revocation, /db\.batch\(\[/);
  assert.match(revocation, /"UPDATE usuarios SET auth_version = auth_version \+ 1 WHERE id = \?1"/);
  assert.doesNotMatch(revocation, /auth_version < ?\s*\d/);
  assert.match(revocation, /SET revocada_en = CURRENT_TIMESTAMP/);
  assert.match(revocation, /'sessions_revoked', 'usuario'/);
  assert.match(revocation, /WHERE EXISTS \(SELECT 1 FROM usuarios WHERE id = \?2\)/);
  assert.doesNotMatch(revocation, /DELETE FROM/, "La revocación no borra filas de sesiones");
  // Los motivos `password_change` y `password_reset` son nombres de motivo, no secretos: lo
  // que no puede aparecer es el material sensible ni la cookie.
  assert.doesNotMatch(revocation, /token_hash|sal_base64|hash_base64|Set-Cookie|Cookie/i, "La revocación no toca ni registra secretos");
});

test("contratos: la migración 0012 declara el rango fail-closed y los dos disparadores", () => {
  const migration = readFileSync(join(repoMigrations, "0012_auth_version_sesiones.sql"), "utf8");
  assert.match(migration, /ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1 CHECK \(auth_version BETWEEN 1 AND 2147483647\)/);
  assert.match(migration, /ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1;/);
  assert.match(migration, /CREATE TRIGGER trg_sesion_auth_version_coherente_insert/);
  assert.match(migration, /CREATE TRIGGER trg_sesion_auth_version_inmutable_update/);
  assert.match(migration, /BEFORE UPDATE OF auth_version ON sesiones_usuario/);
  // Sin backfill fila a fila y sin reconstrucción de tablas.
  assert.doesNotMatch(migration, /UPDATE usuarios/);
  assert.doesNotMatch(migration, /CREATE TABLE|DROP TABLE/);
  // Sin condición de techo: el CHECK decide y el batch falla cerrado.
  assert.doesNotMatch(migration, /auth_version < 2147483647/);
});
