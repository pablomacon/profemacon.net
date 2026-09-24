#!/usr/bin/env node
// Recorrido ficticio contra un entorno beta ya desplegado (preparado en B1, se ejecuta en B2).
//
//   node scripts/verify-beta-smoke.mjs https://<host-beta>
//   BETA_BASE_URL=https://<host-beta> node scripts/verify-beta-smoke.mjs
//   node scripts/verify-beta-smoke.mjs <url> --allow-http    (sólo para ensayos locales)
//
// Usa exclusivamente la cuenta demo ficticia, su código ficticio y una
// contraseña generada en memoria. No contiene URLs fijas, credenciales reales
// ni secretos, y no consulta Cloudflare: sólo hace HTTP contra la base indicada.
import { randomBytes } from "node:crypto";

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

const DEMO_USERNAME = "estudiante.demo";
const DEMO_ACTIVATION_CODE = "PM-DEMO-ESTUDIANTE-2026";
const DEMO_PASSWORD = process.env.BETA_DEMO_PASSWORD ?? randomBytes(18).toString("base64url");
// Contraseña ficticia usada sólo para el sondeo de usuario inexistente: no
// corresponde a ninguna cuenta, no se persiste y no es un secreto del sistema.
const UNKNOWN_USER_PASSWORD = "Frase ficticia para un usuario que no existe 2026";

const USAGE = `Uso:
  node scripts/verify-beta-smoke.mjs <base-url> [--allow-http]
  BETA_BASE_URL=<base-url> node scripts/verify-beta-smoke.mjs [--allow-http]

Recorre activación, login, cookies, sesión, cursos, rechazo de actividad
deshabilitada, logout, 401 posterior y validación de Origin. Sólo usa datos
ficticios. Códigos de salida: 0 correcto, 1 verificación fallida, 2 uso incorrecto.`;

const positional = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const flags = process.argv.slice(2).filter((argument) => argument.startsWith("--"));
if (flags.includes("--help") || flags.includes("-h")) {
  console.log(USAGE);
  process.exit(EXIT_OK);
}
for (const flag of flags) {
  if (flag !== "--allow-http") {
    console.error(`Argumento no reconocido: ${flag}\n\n${USAGE}`);
    process.exit(EXIT_USAGE);
  }
}
const allowHttp = flags.includes("--allow-http");
const baseUrlInput = positional[0] ?? process.env.BETA_BASE_URL ?? null;
if (baseUrlInput === null || baseUrlInput.trim() === "") {
  console.error(`Falta la URL base del entorno beta.\n\n${USAGE}`);
  process.exit(EXIT_USAGE);
}
if (positional.length > 1) {
  console.error(`Sobra un argumento posicional: ${positional[1]}\n\n${USAGE}`);
  process.exit(EXIT_USAGE);
}

let baseUrl;
try {
  baseUrl = new URL(baseUrlInput.trim());
} catch {
  console.error(`La URL indicada no es válida: ${baseUrlInput}`);
  process.exit(EXIT_USAGE);
}
if (baseUrl.protocol !== "https:" && !allowHttp) {
  console.error("Se espera una URL https para verificar el atributo Secure de la cookie. Usá --allow-http sólo en ensayos locales.");
  process.exit(EXIT_USAGE);
}

const origin = baseUrl.origin;
const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
}

async function call(path, { method = "GET", body, cookie, requestOrigin = origin, omitOrigin = false } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (!omitOrigin) headers.Origin = requestOrigin;
  if (cookie) headers.Cookie = cookie;
  return fetch(`${origin}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
}

function readCookie(response) {
  const header = response.headers.get("set-cookie") ?? "";
  return { header, pair: header.split(";", 1)[0] ?? "" };
}

function assertCookieAttributes(response, { requireSecure }) {
  const { header, pair } = readCookie(response);
  record("Set-Cookie presente", header.length > 0, pair);
  const attributes = [
    ["Path=/", /;\s*Path=\//i.test(header)],
    ["HttpOnly", /;\s*HttpOnly/i.test(header)],
    ["SameSite=Strict", /;\s*SameSite=Strict/i.test(header)],
    ["Secure", /;\s*Secure/i.test(header)],
  ];
  for (const [label, present] of attributes) {
    if (label === "Secure" && !requireSecure) {
      record("cookie Secure", true, "no aplicable sobre http");
      continue;
    }
    record(`cookie ${label}`, present, present ? "presente" : "ausente");
  }
  return pair;
}

console.log("Verificación de humo ficticia de la beta");
console.log(`Destino: ${origin}`);
console.log(`Cuenta demo: ${DEMO_USERNAME} (contraseña generada en memoria, no se imprime)`);
console.log("Este recorrido escribe una sesión y consume la activación ficticia del entorno indicado.\n");

try {
  const home = await call("/");
  const homeBody = await home.text();
  record("GET / responde 200 html", home.status === 200 && /text\/html/i.test(home.headers.get("content-type") ?? ""),
    `HTTP ${home.status}`);
  record("GET / sirve la aplicación", homeBody.includes("Profe Macón 2.0"), "título presente en el HTML");

  const course = await call("/curso/programacion-i");
  const courseBody = await course.text();
  const courseLocation = course.headers.get("location");
  record("GET /curso/programacion-i responde 200 html",
    course.status === 200 && /text\/html/i.test(course.headers.get("content-type") ?? ""), `HTTP ${course.status}`);
  record("GET /curso/programacion-i no redirige", courseLocation === null, courseLocation ?? "sin Location");
  record("GET /curso/programacion-i sirve la aplicación", courseBody.includes("Profe Macón 2.0"),
    "título presente en el HTML");

  let authentication = await call("/api/auth/activate", {
    method: "POST",
    body: { username: DEMO_USERNAME, activationCode: DEMO_ACTIVATION_CODE, password: DEMO_PASSWORD },
  });
  let activationDetail = `HTTP ${authentication.status}`;
  if (!authentication.ok) {
    authentication = await call("/api/auth/login", { method: "POST", body: { username: DEMO_USERNAME, password: DEMO_PASSWORD } });
    activationDetail = `activación rechazada (HTTP ${authentication.status === 401 ? 401 : "?"}); login HTTP ${authentication.status}`;
    if (!authentication.ok) {
      throw new Error(
        "No fue posible activar ni iniciar sesión con la cuenta demo ficticia. Si la beta ya fue recorrida, " +
        "pasá BETA_DEMO_PASSWORD con la contraseña usada, reemití la activación desde el panel docente o reconstruí la beta.",
      );
    }
  }
  record("activación o login de la cuenta demo", true, activationDetail);

  const cookie = assertCookieAttributes(authentication, { requireSecure: baseUrl.protocol === "https:" });
  if (!cookie) throw new Error("La respuesta de autenticación no devolvió una cookie de sesión.");

  const session = await call("/api/session", { cookie });
  const sessionBody = await session.json().catch(() => ({}));
  record("GET /api/session responde 200", session.status === 200, `HTTP ${session.status}`);
  record("la sesión corresponde a la cuenta demo", sessionBody?.user?.username === DEMO_USERNAME,
    sessionBody?.user?.username ?? "sin usuario");

  const courses = await call("/api/me/courses", { cookie });
  const coursesBody = await courses.json().catch(() => ({}));
  record("GET /api/me/courses responde 200", courses.status === 200, `HTTP ${courses.status}`);
  record("la respuesta de cursos es una lista", Array.isArray(coursesBody?.courses),
    `${Array.isArray(coursesBody?.courses) ? coursesBody.courses.length : 0} curso(s)`);

  const activity = await call("/api/me/activities/variables-java-01?groupCode=DEMO-A", { cookie });
  const activityBody = await activity.json().catch(() => ({}));
  record("la actividad ficticia se rechaza en lugar de exponerse", activity.status !== 200,
    `HTTP ${activity.status}${activityBody?.code ? ` · ${activityBody.code}` : ""}`);

  const logout = await call("/api/auth/logout", { method: "POST", cookie });
  record("POST /api/auth/logout responde 200", logout.status === 200, `HTTP ${logout.status}`);
  const clearedCookie = readCookie(logout).header;
  record("logout limpia la cookie", /Max-Age=0/i.test(clearedCookie), clearedCookie || "sin cabecera");

  const afterLogout = await call("/api/session", { cookie });
  record("GET /api/session posterior responde 401", afterLogout.status === 401, `HTTP ${afterLogout.status}`);
  await afterLogout.arrayBuffer();

  // Camino sin escritura: un usuario ficticio inexistente debe responder 401 y
  // nunca 500. Cubre la regresión de PBKDF2 observada en el primer intento de B2.5.
  const unknownUser = await call("/api/auth/login", {
    method: "POST",
    body: { username: "usuario.inexistente.ficticio", password: UNKNOWN_USER_PASSWORD },
  });
  const unknownBody = await unknownUser.json().catch(() => ({}));
  record("login con usuario inexistente responde 401 y no 500", unknownUser.status === 401,
    `HTTP ${unknownUser.status}${unknownBody?.code ? ` · ${unknownBody.code}` : ""}`);
  record("el rechazo del usuario inexistente no filtra detalles",
    unknownBody?.code !== "INTERNAL_ERROR", unknownBody?.code ?? "sin código");

  const foreignOrigin = await call("/api/auth/login", {
    method: "POST",
    body: { username: DEMO_USERNAME, password: DEMO_PASSWORD },
    requestOrigin: "https://ejemplo-ajeno.test",
  });
  record("Origin ajeno responde 403", foreignOrigin.status === 403, `HTTP ${foreignOrigin.status}`);
  await foreignOrigin.arrayBuffer();

  const missingOrigin = await call("/api/auth/login", {
    method: "POST",
    body: { username: DEMO_USERNAME, password: DEMO_PASSWORD },
    omitOrigin: true,
  });
  record("petición sin Origin responde 403", missingOrigin.status === 403, `HTTP ${missingOrigin.status}`);
  await missingOrigin.arrayBuffer();
} catch (error) {
  record("recorrido completo", false, error instanceof Error ? error.message : String(error));
}

console.log("\nResultados:");
for (const entry of results) {
  console.log(`  ${entry.ok ? "OK   " : "FALLA"} ${entry.name}${entry.detail ? `: ${entry.detail}` : ""}`);
}
const failed = results.filter((entry) => !entry.ok).length;
console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas.`);
process.exit(failed === 0 ? EXIT_OK : EXIT_FAILED);

