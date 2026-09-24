// Fallback de la aplicación de página única con el runtime real de workerd.
//
// Comprueba que las rutas de interfaz devuelven el shell con 200 y sin redirección,
// que los assets reales se sirven con su tipo, y que /api/* conserva la semántica de
// API en lugar de convertirse en un 200 de la SPA.
//
// El directorio de assets es un fixture temporal y determinista: el shell real de la
// aplicación se verifica en el recorrido de humo contra la beta desplegada.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const projectRoot = process.cwd();
const wranglerBin = join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const DATABASE_NAME = "profemacon-beta-local";
const SHELL_MARKER = "spa-shell-fixture";

/** Directorio de assets mínimo: shell, un script y un vector. */
function buildAssets(directory) {
  mkdirSync(join(directory, "assets"), { recursive: true });
  writeFileSync(join(directory, "index.html"),
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Fixture</title></head><body><div id="${SHELL_MARKER}">shell</div></body></html>\n`);
  writeFileSync(join(directory, "assets", "app.js"), "console.log('fixture');\n");
  writeFileSync(join(directory, "logo.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>\n");
  return directory;
}

/** Configuración equivalente a la del repositorio: binding ASSETS con fallback SPA. */
function writeWorkerConfig(root, assetsDirectory) {
  const configPath = join(root, "wrangler.routing.json");
  writeFileSync(configPath, JSON.stringify({
    name: "profemacon-routing-test",
    compatibility_date: "2026-07-20",
    main: join(projectRoot, "worker", "index.ts"),
    assets: { binding: "ASSETS", directory: assetsDirectory, not_found_handling: "single-page-application" },
    d1_databases: [{
      binding: "DB",
      database_name: DATABASE_NAME,
      database_id: "00000000-0000-0000-0000-000000000000",
      migrations_dir: join(projectRoot, "migrations"),
    }],
  }, null, 2));
  return configPath;
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startWorker(root, configPath) {
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let output = "";
  const worker = spawn(process.execPath, [
    wranglerBin, "dev", "--config", configPath, "--local", "--port", String(port), "--persist-to", root,
  ], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, XDG_CONFIG_HOME: root },
  });
  worker.stdout.on("data", (chunk) => { output += String(chunk); });
  worker.stderr.on("data", (chunk) => { output += String(chunk); });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.status > 0) return { worker, baseUrl, output: () => output };
    } catch {
      // El Worker todavía no escucha.
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
  await new Promise((resolve) => setTimeout(resolve, 300));
}

test("las rutas de interfaz sirven el shell con 200 y sin redirección", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "profemacon-routing-"));
  let worker;
  t.after(async () => {
    await stopWorker(worker);
    rmSync(root, { recursive: true, force: true });
  });

  const assetsDirectory = buildAssets(join(root, "client"));
  const configPath = writeWorkerConfig(root, assetsDirectory);

  const migrated = spawnSync(process.execPath, [
    wranglerBin, "d1", "migrations", "apply", DATABASE_NAME,
    "--local", "--persist-to", root, "--config", configPath,
  ], { cwd: projectRoot, encoding: "utf8" });
  assert.equal(migrated.status, 0, `Las migraciones fallaron: ${migrated.stdout ?? ""}${migrated.stderr ?? ""}`);

  const started = await startWorker(root, configPath);
  worker = started.worker;

  const request = async (path, accept = "text/html") => {
    const response = await fetch(`${started.baseUrl}${path}`, { headers: { Accept: accept }, redirect: "manual" });
    return {
      status: response.status,
      location: response.headers.get("location"),
      contentType: response.headers.get("content-type") ?? "",
      body: await response.text(),
    };
  };

  // Rutas de interfaz: el shell con 200, sin redirección, tanto para una navegación
  // HTML como para un pedido que no lo es (el caso que observaba el 307).
  for (const path of ["/", "/curso/programacion-i", "/ruta-inexistente"]) {
    for (const accept of ["text/html", "application/json"]) {
      const response = await request(path, accept);
      const detail = `${path} con Accept: ${accept} → ${response.status} ${response.contentType} location=${response.location ?? "-"}`;
      assert.equal(response.status, 200, detail);
      assert.equal(response.location, null, `${detail}: no debe redirigir`);
      assert.match(response.contentType, /^text\/html/, detail);
      assert.ok(response.body.includes(SHELL_MARKER), `${detail}: debe servir el shell`);
    }
  }

  // Assets reales: se sirven con su tipo, sin redirección y sin el shell.
  const script = await request("/assets/app.js", "*/*");
  assert.equal(script.status, 200);
  assert.match(script.contentType, /javascript/);
  assert.equal(script.location, null);
  assert.ok(!script.body.includes(SHELL_MARKER), "Un asset real no debe devolver el shell");

  const logo = await request("/logo.svg", "*/*");
  assert.equal(logo.status, 200);
  assert.match(logo.contentType, /image\/svg/);
  assert.equal(logo.location, null);

  // Las rutas /api/* conservan la semántica de API: JSON y nunca el shell con 200.
  const session = await request("/api/session", "application/json");
  assert.equal(session.status, 401);
  assert.match(session.contentType, /application\/json/);
  assert.ok(!session.body.includes(SHELL_MARKER), "Una ruta /api/* no debe devolver la SPA");

  const unknownApi = await request("/api/ruta-inexistente", "application/json");
  assert.equal(unknownApi.status, 401);
  assert.match(unknownApi.contentType, /application\/json/);
  assert.ok(!unknownApi.body.includes(SHELL_MARKER), "Una ruta /api/* desconocida sigue siendo API");

  const postWithoutOrigin = await fetch(`${started.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "usuario.ficticio", password: "ficticia" }),
    redirect: "manual",
  });
  assert.equal(postWithoutOrigin.status, 403);
  assert.match(postWithoutOrigin.headers.get("content-type") ?? "", /application\/json/);
  assert.ok(!(await postWithoutOrigin.text()).includes(SHELL_MARKER), "Un POST de /api/* no debe devolver la SPA");

  await stopWorker(worker);
  worker = undefined;
});
