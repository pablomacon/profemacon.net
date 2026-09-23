// Flujo real de autenticación local contra workerd y contratos de esquema de 0011.
//
// A diferencia de tests/auth-crypto*.test.ts (Node puro, sin tope de iteraciones),
// este archivo levanta `wrangler dev --local` sobre una D1 temporal: es la única
// cobertura local que ejerce el runtime real de Cloudflare, que rechaza PBKDF2 por
// encima de 100.000 iteraciones. No mockea /api/auth/*.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sha256Hex } from "../worker/auth-crypto.ts";

const projectRoot = process.cwd();
const wranglerBin = join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const repoMigrations = join(projectRoot, "migrations");
const DATABASE_NAME = "profemacon-beta-local";
const ACTIVATION_CODE = "PM-PRUEBA-ACTIVACION-2026";
const PASSWORD = "Frase ficticia de prueba suficientemente larga";
const OTHER_PASSWORD = "Otra frase ficticia completamente distinta";
const TOTAL_MIGRATIONS = 11;
const BASELINE_MIGRATIONS = 10;

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
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

/**
 * Copia un subconjunto de las migraciones del repositorio a un directorio temporal.
 * `relaxRange` produce un fixture que relaja el CHECK de 0011 para poder persistir
 * una credencial anómala y comprobar el fallo cerrado de la aplicación.
 */
function copyMigrations(destination, count, { relaxRange = false } = {}) {
  mkdirSync(destination, { recursive: true });
  const files = readdirSync(repoMigrations).filter((name) => name.endsWith(".sql")).sort();
  assert.ok(files.length >= count, `Se esperaban al menos ${count} migraciones y hay ${files.length}`);
  for (const file of files.slice(0, count)) {
    let text = readFileSync(join(repoMigrations, file), "utf8");
    if (relaxRange && file.startsWith("0011")) {
      const relaxed = text.split("BETWEEN 50000 AND 100000").join("BETWEEN 1 AND 100000");
      assert.notEqual(relaxed, text, "El fixture necesita relajar el rango de 0011");
      text = relaxed;
    }
    writeFileSync(join(destination, file), text);
  }
  return destination;
}

function writeWorkerConfig(persistenceRoot, migrationsDir, name) {
  const configPath = join(persistenceRoot, `wrangler.${name}.json`);
  writeFileSync(configPath, JSON.stringify({
    name: `profemacon-${name}-test`,
    compatibility_date: "2026-07-20",
    main: join(projectRoot, "worker", "index.ts"),
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

  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/session`);
      if (response.status > 0) {
        return { worker, baseUrl, output: () => output, hasExited: () => exited };
      }
    } catch {
      // El Worker todavía no escucha: se reintenta.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Wrangler no inició el Worker local: ${output.slice(-2000)}`);
}

async function stopWorker(worker) {
  if (!worker || worker.killed) return;
  const exited = once(worker, "exit");
  worker.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))]);
  // En Windows los identificadores del archivo SQLite se liberan un instante después
  // de la salida del proceso: se deja un margen antes de abrir la base.
  await new Promise((resolve) => setTimeout(resolve, 300));
}

/**
 * Abre la D1 temporal tolerando que el sistema aún no haya liberado el archivo.
 * Se usa después de detener el Worker; no aplica a los escenarios sin Worker.
 */
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

/**
 * Espera a que la salida del Worker contenga un patrón. Los registros llegan por el
 * pipe después de la respuesta HTTP, así que una aserción inmediata sería prematura
 * (o, en el caso de las comprobaciones negativas, vacua).
 */
async function waitForOutput(readOutput, pattern, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pattern.test(readOutput())) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return pattern.test(readOutput());
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
  const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { response, body: await response.json().catch(() => null) };
}

function sessionCookieOf(response) {
  return (response.headers.get("set-cookie") ?? "").split(";", 1)[0] ?? "";
}

function createWorkspace(prefix, { migrations = TOTAL_MIGRATIONS, relaxRange = false } = {}) {
  const persistenceRoot = mkdtempSync(join(tmpdir(), prefix));
  const migrationsDir = copyMigrations(join(persistenceRoot, "migrations"), migrations, { relaxRange });
  const configPath = writeWorkerConfig(persistenceRoot, migrationsDir, prefix.replace(/[^a-z0-9-]/gi, "") || "auth");
  return { persistenceRoot, migrationsDir, configPath };
}

test("el flujo real de activación, login, sesión y logout funciona en workerd", async (t) => {
  const { persistenceRoot, configPath } = createWorkspace("profemacon-auth-flow-");
  let databasePath;
  let worker;
  t.after(async () => {
    await stopWorker(worker);
    rmSync(persistenceRoot, { recursive: true, force: true });
  });

  applyMigrations(persistenceRoot, configPath);
  databasePath = databasePathOf(persistenceRoot);

  const setup = openDatabase(databasePath);
  await seedAccount(setup);
  setup.close();

  const started = await startWorker(persistenceRoot, configPath);
  worker = started.worker;
  const { baseUrl, output } = started;

  // A) Activación: cookie de sesión con los atributos esperados.
  const activation = await postJson(baseUrl, "/api/auth/activate", {
    username: "estudiante-prueba", activationCode: ACTIVATION_CODE, password: PASSWORD,
  });
  assert.equal(activation.response.status, 200, JSON.stringify(activation.body));
  const activationCookie = activation.response.headers.get("set-cookie") ?? "";
  assert.match(activationCookie, /^pm_session=/);
  assert.match(activationCookie, /HttpOnly/i);
  assert.match(activationCookie, /SameSite=Strict/i);
  assert.match(activationCookie, /Path=\//i);
  assert.doesNotMatch(activationCookie, /Secure/i, "Sobre http la cookie no lleva Secure");
  const activationSession = sessionCookieOf(activation.response);
  assert.notEqual(activationSession, "");

  // B) El código de activación no se reutiliza.
  const reused = await postJson(baseUrl, "/api/auth/activate", {
    username: "estudiante-prueba", activationCode: ACTIVATION_CODE, password: PASSWORD,
  });
  assert.equal(reused.response.status, 401, JSON.stringify(reused.body));

  // D) Contraseña incorrecta: 401 con cuerpo genérico, nunca 500.
  const wrongPassword = await postJson(baseUrl, "/api/auth/login", { username: "estudiante-prueba", password: OTHER_PASSWORD });
  assert.equal(wrongPassword.response.status, 401, JSON.stringify(wrongPassword.body));
  assert.equal(wrongPassword.response.headers.get("set-cookie"), null);

  // C) Login correcto.
  const login = await postJson(baseUrl, "/api/auth/login", { username: "estudiante-prueba", password: PASSWORD });
  assert.equal(login.response.status, 200, JSON.stringify(login.body));

  // E) Usuario inexistente: 401, nunca 500.
  const unknown = await postJson(baseUrl, "/api/auth/login", { username: "usuario.inexistente", password: PASSWORD });
  assert.equal(unknown.response.status, 401, JSON.stringify(unknown.body));

  // El login correcto había reiniciado el contador; un fallo posterior vuelve a incrementarlo.
  const wrongAgain = await postJson(baseUrl, "/api/auth/login", { username: "estudiante-prueba", password: OTHER_PASSWORD });
  assert.equal(wrongAgain.response.status, 401, JSON.stringify(wrongAgain.body));

  // F) Sesión activa de la activación.
  const session = await fetch(`${baseUrl}/api/session`, { headers: { Cookie: activationSession } });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).user.username, "estudiante-prueba");

  // G) Logout y H) sesión revocada.
  const logout = await postJson(baseUrl, "/api/auth/logout", {}, sessionCookieOf(login.response));
  assert.equal(logout.response.status, 200, JSON.stringify(logout.body));
  assert.match(logout.response.headers.get("set-cookie") ?? "", /Max-Age=0/i);
  const afterLogout = await fetch(`${baseUrl}/api/session`, { headers: { Cookie: sessionCookieOf(login.response) } });
  assert.equal(afterLogout.status, 401);
  await afterLogout.arrayBuffer();

  // I) El runtime real no registró ninguna falla de PBKDF2. Se espera primero una
  // marca positiva de actividad para que las comprobaciones negativas no sean vacuas.
  assert.ok(await waitForOutput(output, /\/api\/auth\/logout/), `El Worker no registró las peticiones: ${output().slice(-1500)}`);
  const log = output();
  assert.doesNotMatch(log, /Pbkdf2 failed/);
  assert.doesNotMatch(log, /iteration counts above/);
  assert.doesNotMatch(log, /DOMNotSupportedError/);
  assert.ok(!log.includes(PASSWORD), "La contraseña no debe aparecer en los registros");
  assert.ok(!log.includes(OTHER_PASSWORD), "La contraseña incorrecta tampoco");

  await stopWorker(worker);
  worker = undefined;

  const database = await openDatabaseAfterWorker(databasePath);
  const credential = database.prepare(`
    SELECT algoritmo, formato, iteraciones, sal_base64, hash_base64, intentos_fallidos,
           bloqueada_hasta, establecida_en, actualizada_en
    FROM credenciales_locales WHERE usuario_id = 1
  `).get();
  assert.ok(credential, "La activación debía crear la credencial");
  assert.equal(credential.algoritmo, "pbkdf2-sha256");
  assert.equal(credential.formato, "v1");
  assert.equal(credential.iteraciones, 100_000);
  assert.equal(Buffer.from(credential.sal_base64, "base64").length, 16);
  assert.equal(Buffer.from(credential.hash_base64, "base64").length, 32);
  assert.equal(credential.intentos_fallidos, 1, "Un fallo posterior al reinicio del login correcto");
  assert.equal(credential.bloqueada_hasta, null);
  // Sin rehash: `actualizada_en` conserva el valor de la creación.
  assert.equal(credential.actualizada_en, credential.establecida_en);

  const activationRow = database.prepare("SELECT consumida_en FROM activaciones_cuenta WHERE usuario_id = 1").get();
  assert.ok(activationRow.consumida_en, "La activación debía consumirse");

  const sessions = database.prepare("SELECT revocada_en FROM sesiones_usuario WHERE usuario_id = 1").all();
  assert.equal(sessions.length, 2, "Una sesión por activación y otra por login");
  assert.equal(sessions.filter((row) => row.revocada_en === null).length, 1, "El logout revoca sólo la sesión cerrada");

  const counts = database.prepare(`
    SELECT (SELECT COUNT(*) FROM usuarios) AS usuarios,
           (SELECT COUNT(*) FROM credenciales_locales) AS credenciales
  `).get();
  assert.equal(counts.usuarios, 1);
  assert.equal(counts.credenciales, 1, "El login con usuario inexistente no escribe credenciales");
  database.close();
});

/** Inventario de objetos del esquema, sin tablas internas de D1/miniflare. */
function schemaNames(database) {
  return database.prepare(`
    SELECT type || ':' || name AS entry FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
      AND name NOT IN ('d1_migrations', '_cf_METADATA', '_cf_KV', 'miniflare_d1_migrations')
    ORDER BY entry
  `).all().map((row) => row.entry);
}

test("una credencial fuera de la política falla cerrada sin bloquear ni crear sesión", async (t) => {
  // Fixture temporal: 0011 con el rango relajado sólo en el archivo copiado, para
  // poder persistir una credencial anómala de 1 iteración y comprobar el fallo
  // cerrado de la aplicación. El repositorio nunca relaja su propio CHECK.
  const { persistenceRoot, configPath } = createWorkspace("profemacon-auth-policy-", { relaxRange: true });
  let worker;
  t.after(async () => {
    await stopWorker(worker);
    rmSync(persistenceRoot, { recursive: true, force: true });
  });

  applyMigrations(persistenceRoot, configPath);
  const databasePath = databasePathOf(persistenceRoot);

  const setup = openDatabase(databasePath);
  await seedAccount(setup);
  setup.prepare(`
    INSERT INTO credenciales_locales (usuario_id, algoritmo, formato, iteraciones, sal_base64, hash_base64)
    VALUES (1, 'pbkdf2-sha256', 'v1', 1, ?1, ?2)
  `).run("A".repeat(24), "B".repeat(44));
  setup.close();

  const started = await startWorker(persistenceRoot, configPath);
  worker = started.worker;

  const attempt = await postJson(started.baseUrl, "/api/auth/login", { username: "estudiante-prueba", password: PASSWORD });
  assert.equal(attempt.response.status, 500, JSON.stringify(attempt.body));
  assert.deepEqual(attempt.body, { code: "INTERNAL_ERROR", error: "No fue posible completar la operación" });
  assert.equal(attempt.response.headers.get("set-cookie"), null, "Un error interno no emite cookie");

  // La salida del Worker llega por el pipe después de la respuesta: se espera el
  // registro del fallo cerrado antes de comprobar que es seguro.
  assert.ok(await waitForOutput(started.output, /Credencial local fuera del rango de costo soportado/),
    `Sin registro del fallo cerrado: ${started.output().slice(-1500)}`);
  assert.doesNotMatch(started.output(), /Pbkdf2 failed|iteration counts above|DOMNotSupportedError/);
  assert.ok(!started.output().includes(PASSWORD), "La contraseña no debe aparecer en los registros");
  assert.ok(!started.output().includes("AAAAAAAAAAAAAAAAAAAAAAAA"), "La sal almacenada no debe aparecer en los registros");

  await stopWorker(worker);
  worker = undefined;

  const database = await openDatabaseAfterWorker(databasePath);
  const credential = database.prepare(`
    SELECT iteraciones, intentos_fallidos, bloqueada_hasta FROM credenciales_locales WHERE usuario_id = 1
  `).get();
  assert.equal(credential.iteraciones, 1, "La credencial anómala no se modifica ni se reescribe");
  assert.equal(credential.intentos_fallidos, 0, "Un costo fuera de política no cuenta como intento fallido");
  assert.equal(credential.bloqueada_hasta, null, "Un costo fuera de política no bloquea la cuenta");
  assert.equal(database.prepare("SELECT COUNT(*) AS total FROM sesiones_usuario").get().total, 0, "No se crea sesión");
  database.close();
});

test("0011 falla ruidosamente con una credencial antigua de 600000 y permite recuperarse", () => {
  const persistenceRoot = mkdtempSync(join(tmpdir(), "profemacon-auth-migration-"));
  try {
    const baselineDir = copyMigrations(join(persistenceRoot, "migrations-base"), BASELINE_MIGRATIONS);
    applyMigrations(persistenceRoot, writeWorkerConfig(persistenceRoot, baselineDir, "baseline"));
    const databasePath = databasePathOf(persistenceRoot);
    const currentConfig = writeWorkerConfig(persistenceRoot, repoMigrations, "actual");

    const database = openDatabase(databasePath);
    database.exec(`
      INSERT INTO roles (id, codigo, nombre) VALUES (1, 'estudiante', 'Estudiante');
      INSERT INTO usuarios (id, nombre_usuario, nombre_mostrado) VALUES (1, 'estudiante-antiguo', 'Estudiante antiguo');
    `);
    database.prepare(`
      INSERT INTO credenciales_locales (usuario_id, algoritmo, iteraciones, sal_base64, hash_base64)
      VALUES (1, 'pbkdf2-sha256', 600000, ?1, ?2)
    `).run("A".repeat(24), "B".repeat(44));
    assert.match(database.prepare("SELECT sql FROM sqlite_master WHERE name = 'credenciales_locales'").get().sql, /iteraciones >= 600000/);
    assert.equal(database.prepare("SELECT COUNT(*) AS total FROM d1_migrations").get().total, BASELINE_MIGRATIONS);
    database.close();

    const failed = runMigrations(persistenceRoot, currentConfig);
    assert.notEqual(failed.status, 0, "0011 debía fallar con una fila fuera del rango");
    assert.match(`${failed.stdout ?? ""}${failed.stderr ?? ""}`, /CHECK|constraint|50000/i, "El fallo debe ser explícito");

    const after = openDatabase(databasePath);
    assert.match(
      after.prepare("SELECT sql FROM sqlite_master WHERE name = 'credenciales_locales'").get().sql,
      /iteraciones >= 600000/,
      "La tabla vigente no se reemplaza si la copia falla",
    );
    const kept = after.prepare("SELECT iteraciones FROM credenciales_locales WHERE usuario_id = 1").get();
    assert.equal(kept.iteraciones, 600000, "La fila incompatible no se borra en silencio");
    assert.equal(after.prepare("SELECT COUNT(*) AS total FROM d1_migrations").get().total, BASELINE_MIGRATIONS, "0011 no queda registrada");
    assert.equal(
      after.prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE name = 'credenciales_locales_nueva'").get().total,
      0,
      "No queda una tabla nueva a medio construir",
    );
    const guardTables = after.prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE name = 'verificacion_costo_0011'").get().total;
    const guardRows = guardTables === 0 ? 0 : after.prepare("SELECT COUNT(*) AS total FROM verificacion_costo_0011").get().total;
    assert.equal(guardRows, 0, "La guarda de precondición no conserva filas");
    after.close();

    // Estado recuperable: al quitar la fila incompatible, 0011 aplica.
    const repair = openDatabase(databasePath);
    repair.exec("DELETE FROM credenciales_locales");
    repair.close();

    applyMigrations(persistenceRoot, currentConfig);
    const recovered = openDatabase(databasePath);
    assert.equal(recovered.prepare("SELECT COUNT(*) AS total FROM d1_migrations").get().total, TOTAL_MIGRATIONS);
    assert.match(
      recovered.prepare("SELECT sql FROM sqlite_master WHERE name = 'credenciales_locales'").get().sql,
      /iteraciones BETWEEN 50000 AND 100000/,
    );
    assert.equal(recovered.prepare("PRAGMA foreign_key_check").all().length, 0);
    recovered.close();
  } finally {
    rmSync(persistenceRoot, { recursive: true, force: true });
  }
});

test("0011 aplica sobre una D1 limpia, restringe el rango y no altera el inventario", () => {
  const persistenceRoot = mkdtempSync(join(tmpdir(), "profemacon-auth-schema-"));
  try {
    const baselineDir = copyMigrations(join(persistenceRoot, "migrations-base"), BASELINE_MIGRATIONS);
    applyMigrations(persistenceRoot, writeWorkerConfig(persistenceRoot, baselineDir, "baseline"));
    const databasePath = databasePathOf(persistenceRoot);

    const before = openDatabase(databasePath);
    const inventory = schemaNames(before);
    assert.ok(inventory.length > 0);
    assert.match(before.prepare("SELECT sql FROM sqlite_master WHERE name = 'credenciales_locales'").get().sql, /iteraciones >= 600000/);
    before.close();

    applyMigrations(persistenceRoot, writeWorkerConfig(persistenceRoot, repoMigrations, "actual"));

    const after = openDatabase(databasePath);
    assert.deepEqual(schemaNames(after), inventory, "0011 no cambia el inventario de tablas, índices y disparadores");
    const sql = after.prepare("SELECT sql FROM sqlite_master WHERE name = 'credenciales_locales'").get().sql;
    assert.match(sql, /iteraciones BETWEEN 50000 AND 100000/);
    assert.match(sql, /algoritmo TEXT NOT NULL DEFAULT 'pbkdf2-sha256' CHECK \(algoritmo IN \('pbkdf2-sha256'\)\)/);
    assert.match(sql, /formato TEXT NOT NULL DEFAULT 'v1' CHECK \(formato IN \('v1'\)\)/);
    assert.deepEqual(
      after.prepare("PRAGMA table_info(credenciales_locales)").all().map((row) => row.name),
      ["usuario_id", "algoritmo", "formato", "iteraciones", "sal_base64", "hash_base64",
        "intentos_fallidos", "bloqueada_hasta", "establecida_en", "actualizada_en"],
    );
    assert.equal(after.prepare("SELECT COUNT(*) AS total FROM d1_migrations").get().total, TOTAL_MIGRATIONS);
    assert.equal(after.prepare("PRAGMA foreign_key_check").all().length, 0);

    after.exec(`
      INSERT INTO roles (id, codigo, nombre) VALUES (1, 'estudiante', 'Estudiante');
      INSERT INTO usuarios (id, nombre_usuario, nombre_mostrado) VALUES
        (1, 'rango-rechazado', 'Rango rechazado'),
        (2, 'rango-minimo', 'Rango mínimo'),
        (3, 'rango-medio', 'Rango medio'),
        (4, 'rango-techo', 'Rango techo'),
        (5, 'rango-default', 'Rango por defecto');
    `);

    const insert = (userId, iterations) => after.prepare(`
      INSERT INTO credenciales_locales (usuario_id, algoritmo, formato, iteraciones, sal_base64, hash_base64)
      VALUES (?1, 'pbkdf2-sha256', 'v1', ?2, ?3, ?4)
    `).run(userId, iterations, "A".repeat(24), "B".repeat(44));

    for (const iterations of [49999, 100001, 600000, 0, -1]) {
      assert.throws(() => insert(1, iterations), /CHECK|constraint/i, `La base debía rechazar ${iterations}`);
    }
    assert.doesNotThrow(() => insert(2, 50000));
    assert.doesNotThrow(() => insert(3, 75000));
    assert.doesNotThrow(() => insert(4, 100000));

    after.prepare(`
      INSERT INTO credenciales_locales (usuario_id, algoritmo, iteraciones, sal_base64, hash_base64)
      VALUES (5, 'pbkdf2-sha256', 100000, ?1, ?2)
    `).run("A".repeat(24), "B".repeat(44));
    assert.equal(after.prepare("SELECT formato FROM credenciales_locales WHERE usuario_id = 5").get().formato, "v1");
    assert.deepEqual(
      after.prepare("SELECT iteraciones FROM credenciales_locales ORDER BY usuario_id").all().map((row) => row.iteraciones),
      [50000, 75000, 100000, 100000],
    );
    after.close();
  } finally {
    rmSync(persistenceRoot, { recursive: true, force: true });
  }
});
