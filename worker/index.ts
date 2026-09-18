import { authenticateRequest, listUserRoles } from "./auth";
import { listCoursesForUser } from "./course-catalog";
import { activateLocalAccount, clearSessionCookie, loginLocalAccount, readJsonBody, requestHasValidOrigin, revokeLocalSession, sessionCookie } from "./local-auth";
import { applyStudentImport, previewStudentImport, readStudentImportBody, StudentImportError } from "./student-import";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  DOCUMENT_HMAC_KEY: string;
}

const apiHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function json(data: unknown, status = 200, extraHeaders?: HeadersInit) {
  return new Response(JSON.stringify(data), { status, headers: { ...apiHeaders, ...extraHeaders } });
}

async function handleApi(request: Request, env: Env, url: URL) {
  if (request.method === "POST" && url.pathname.startsWith("/api/auth/")) {
    if (!requestHasValidOrigin(request)) return json({ error: "Origen de solicitud inválido" }, 403);

    if (url.pathname === "/api/auth/logout") {
      await revokeLocalSession(request, env.DB);
      return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(request) });
    }

    const body = await readJsonBody(request);
    if (!body) return json({ error: "Solicitud inválida" }, 400);

    const session = url.pathname === "/api/auth/activate"
      ? await activateLocalAccount(env.DB, body)
      : url.pathname === "/api/auth/login"
        ? await loginLocalAccount(env.DB, body)
        : null;
    if (!session) return json({ error: "No fue posible validar las credenciales" }, 401);
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(session.token, request) });
  }

  if (request.method === "POST" && (url.pathname === "/api/student-imports/preview" || url.pathname === "/api/student-imports/apply")) {
    if (!requestHasValidOrigin(request)) return json({ error: "Origen de solicitud inválido" }, 403);
    const user = await authenticateRequest(request, env.DB);
    if (!user) return json({ error: "Sesión requerida" }, 401);
    try {
      const payload = await readStudentImportBody(request);
      const result = url.pathname.endsWith("/preview")
        ? await previewStudentImport(env.DB, user.id, env.DOCUMENT_HMAC_KEY ?? "", payload)
        : await applyStudentImport(env.DB, user.id, env.DOCUMENT_HMAC_KEY ?? "", payload);
      return json(result, url.pathname.endsWith("/apply") ? 201 : 200);
    } catch (error) {
      if (error instanceof StudentImportError) return json({ error: error.message }, error.status);
      console.error("Fallo interno al procesar una importación de estudiantes");
      return json({ error: "No fue posible procesar la importación" }, 500);
    }
  }

  if (request.method !== "GET") return json({ error: "Método no permitido" }, 405);

  const user = await authenticateRequest(request, env.DB);
  if (!user) return json({ error: "Sesión requerida" }, 401);

  if (url.pathname === "/api/session") {
    const roles = await listUserRoles(env.DB, user.id);
    return json({ user: { ...user, roles } });
  }

  if (url.pathname === "/api/me/courses") {
    const courses = await listCoursesForUser(env.DB, user.id);
    return json({ courses });
  }

  return json({ error: "Recurso no encontrado" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, url);

    // Las rutas de interfaz se resuelven en React. ASSETS continúa sirviendo
    // los archivos estáticos y permite el mismo fallback en local y producción.
    return env.ASSETS.fetch(new Request(new URL("/index.html", url), request));
  },
} satisfies ExportedHandler<Env>;
