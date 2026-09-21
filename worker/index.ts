import { authenticateRequest, listUserRoles } from "./auth";
import { ActivationAdminError, listActivationCandidates, parseReissuePayload, reissueAccountActivation } from "./account-activation-admin";
import { listCoursesForUser } from "./course-catalog";
import { activateLocalAccount, clearSessionCookie, loginLocalAccount, readJsonBody, requestHasValidOrigin, revokeLocalSession, sessionCookie } from "./local-auth";
import { applyStudentImport, previewStudentImport, readStudentImportBody, StudentImportError } from "./student-import";
import { createOrRecoverStudentActivityAttempt, getStudentActivity, getStudentActivityDraft, getStudentActivityReview, saveStudentActivityAnswer, StudentActivityError, submitStudentActivityAttempt } from "./student-activity";
import { getTeacherActivityPreview, gradeTeacherActivityPreview, TeacherPreviewError } from "./teacher-activity-preview";
import { listTeacherGroups, requireTeacherGroupScope, TeacherGroupScopeError } from "./teacher-group-scope";
import { listTeacherGroupActivities, saveTeacherAvailability, TeacherActivityManagementError } from "./teacher-group-activities";

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

  if (request.method === "POST" && url.pathname === "/api/account-activations/reissue") {
    if (!requestHasValidOrigin(request)) return json({ error: "Origen de solicitud inválido" }, 403);
    const user = await authenticateRequest(request, env.DB);
    if (!user) return json({ error: "Sesión requerida" }, 401);
    const body = await readJsonBody(request);
    if (!body) return json({ error: "Solicitud inválida" }, 400);
    try {
      return json(await reissueAccountActivation(env.DB, user.id, parseReissuePayload(body)), 201);
    } catch (error) {
      if (error instanceof ActivationAdminError) return json({ error: error.message }, error.status);
      console.error("Fallo interno al reemitir una activación");
      return json({ error: "No fue posible reemitir la activación" }, 500);
    }
  }

  const teacherPreviewGradeMatch = /^\/api\/teacher\/activities\/([^/]+)\/preview\/grade$/.exec(url.pathname);
  const availabilityMatch = /^\/api\/teacher\/groups\/(\d+)\/activities\/(\d+)\/availability$/.exec(url.pathname);
  if (request.method === "PUT" && availabilityMatch) {
    if (!requestHasValidOrigin(request)) return json({ code: "INVALID_ORIGIN", error: "Origen de solicitud inválido" }, 403);
    const user = await authenticateRequest(request, env.DB);
    if (!user) return json({ code: "SESSION_REQUIRED", error: "Sesión requerida" }, 401);
    const body = await readJsonBody(request);
    try { return json(await saveTeacherAvailability(env.DB, user.id, Number(availabilityMatch[1]), Number(availabilityMatch[2]), body)); }
    catch (error) { if (error instanceof TeacherActivityManagementError || error instanceof TeacherGroupScopeError) return json({ code: error.code, error: error.message }, error.status); console.error("Fallo interno al guardar una habilitación docente"); return json({ code: "INTERNAL_ERROR", error: "No fue posible guardar la habilitación" }, 500); }
  }
  if (request.method === "POST" && teacherPreviewGradeMatch) {
    if (!requestHasValidOrigin(request)) return json({ error: "Origen de solicitud inválido" }, 403);
    const user = await authenticateRequest(request, env.DB);
    if (!user) return json({ code: "SESSION_REQUIRED", error: "Sesión requerida" }, 401);
    const body = await readJsonBody(request);
    if (!body || typeof body.groupCode !== "string") return json({ code: "INVALID_REQUEST", error: "La solicitud debe incluir grupo y respuestas válidas." }, 400);
    try {
      return json(await gradeTeacherActivityPreview(env.DB, user.id, decodeURIComponent(teacherPreviewGradeMatch[1]), body.groupCode, body.answers));
    } catch (error) {
      if (error instanceof TeacherPreviewError) return json({ code: error.code, error: error.message }, error.status);
      console.error("Fallo interno al corregir una prueba docente");
      return json({ code: "INTERNAL_ERROR", error: "No fue posible corregir la prueba docente" }, 500);
    }
  }

  const attemptMatch = /^\/api\/me\/activities\/([^/]+)\/attempts$/.exec(url.pathname);
  if (request.method === "POST" && attemptMatch) {
    if (!requestHasValidOrigin(request)) return json({ error: "Origen de solicitud inválido" }, 403);
    const user = await authenticateRequest(request, env.DB);
    if (!user) return json({ code: "SESSION_REQUIRED", error: "Sesión requerida" }, 401);
    const body = await readJsonBody(request);
    if (!body || (body.groupCode !== undefined && typeof body.groupCode !== "string")) {
      return json({ code: "INVALID_REQUEST", error: "La solicitud debe incluir JSON válido." }, 400);
    }
    let slug: string;
    try {
      slug = decodeURIComponent(attemptMatch[1]);
    } catch {
      return json({ code: "ACTIVITY_NOT_FOUND", error: "La actividad no fue encontrada" }, 404);
    }
    try {
      const result = await createOrRecoverStudentActivityAttempt(
        env.DB,
        user.id,
        slug,
        typeof body.groupCode === "string" ? body.groupCode : null,
        body.submissionId,
      );
      return json(result, 201);
    } catch (error) {
      if (error instanceof StudentActivityError) return json({ code: error.code, error: error.message }, error.status);
      console.error("Fallo interno al crear o recuperar un intento estudiantil");
      return json({ code: "INTERNAL_ERROR", error: "No fue posible preparar el intento" }, 500);
    }
  }

  const submitMatch = /^\/api\/me\/activities\/([^/]+)\/attempts\/([^/]+)\/submit$/.exec(url.pathname);
  if (request.method === "POST" && submitMatch) {
    if (!requestHasValidOrigin(request)) return json({ error: "Origen de solicitud inválido" }, 403);
    const user = await authenticateRequest(request, env.DB);
    if (!user) return json({ code: "SESSION_REQUIRED", error: "Sesión requerida" }, 401);
    let slug: string;
    try {
      slug = decodeURIComponent(submitMatch[1]);
    } catch {
      return json({ code: "ACTIVITY_NOT_FOUND", error: "La actividad no fue encontrada" }, 404);
    }
    try {
      return json(await submitStudentActivityAttempt(
        env.DB,
        user.id,
        slug,
        url.searchParams.get("groupCode"),
        submitMatch[2],
      ));
    } catch (error) {
      if (error instanceof StudentActivityError) return json({ code: error.code, error: error.message }, error.status);
      console.error("Fallo interno al finalizar un intento estudiantil");
      return json({ code: "INTERNAL_ERROR", error: "No fue posible finalizar el intento" }, 500);
    }
  }

  const answerMatch = /^\/api\/me\/activities\/([^/]+)\/attempts\/([^/]+)\/responses\/([^/]+)$/.exec(url.pathname);
  if (request.method === "PUT" && answerMatch) {
    if (!requestHasValidOrigin(request)) return json({ error: "Origen de solicitud inválido" }, 403);
    const user = await authenticateRequest(request, env.DB);
    if (!user) return json({ code: "SESSION_REQUIRED", error: "Sesión requerida" }, 401);
    const body = await readJsonBody(request);
    if (!body || !Object.hasOwn(body, "answer") || (body.groupCode !== undefined && typeof body.groupCode !== "string")) {
      return json({ code: "INVALID_REQUEST", error: "La solicitud debe incluir una respuesta JSON válida." }, 400);
    }
    let slug: string;
    try {
      slug = decodeURIComponent(answerMatch[1]);
    } catch {
      return json({ code: "ACTIVITY_NOT_FOUND", error: "La actividad no fue encontrada" }, 404);
    }
    try {
      return json(await saveStudentActivityAnswer(
        env.DB,
        user.id,
        slug,
        typeof body.groupCode === "string" ? body.groupCode : null,
        answerMatch[2],
        answerMatch[3],
        body.answer,
      ));
    } catch (error) {
      if (error instanceof StudentActivityError) return json({ code: error.code, error: error.message }, error.status);
      console.error("Fallo interno al guardar una respuesta estudiantil");
      return json({ code: "INTERNAL_ERROR", error: "No fue posible guardar la respuesta" }, 500);
    }
  }

  if (request.method !== "GET") return json({ error: "Método no permitido" }, 405);

  if (url.pathname === "/api/teacher/groups") {
    const user = await authenticateRequest(request, env.DB);
    if (!user) return json({ code: "SESSION_REQUIRED", error: "Sesión requerida" }, 401);
    try { return json(await listTeacherGroups(env.DB, user.id)); }
    catch (error) { if (error instanceof TeacherGroupScopeError) return json({ code: error.code, error: error.message }, error.status); return json({ code: "INTERNAL_ERROR", error: "No fue posible consultar los grupos" }, 500); }
  }
  const teacherGroupMatch = /^\/api\/teacher\/groups\/([^/]+)$/.exec(url.pathname);
  const teacherActivitiesMatch = /^\/api\/teacher\/groups\/(\d+)\/activities$/.exec(url.pathname);
  if(teacherActivitiesMatch){const user=await authenticateRequest(request,env.DB);if(!user)return json({code:"SESSION_REQUIRED",error:"Sesión requerida"},401);try{return json(await listTeacherGroupActivities(env.DB,user.id,Number(teacherActivitiesMatch[1])));}catch(error){if(error instanceof TeacherGroupScopeError)return json({code:error.code,error:error.message},error.status);return json({code:"INTERNAL_ERROR",error:"No fue posible consultar actividades"},500);}}
  if (teacherGroupMatch) {
    const user = await authenticateRequest(request, env.DB);
    if (!user) return json({ code: "SESSION_REQUIRED", error: "Sesión requerida" }, 401);
    const groupId = Number(teacherGroupMatch[1]);
    if (!Number.isSafeInteger(groupId) || groupId <= 0) return json({ code: "GROUP_NOT_FOUND", error: "El grupo no fue encontrado." }, 404);
    try { return json({ group: await requireTeacherGroupScope(env.DB, user.id, groupId) }); }
    catch (error) { if (error instanceof TeacherGroupScopeError) return json({ code: error.code, error: error.message }, error.status); return json({ code: "INTERNAL_ERROR", error: "No fue posible consultar el grupo" }, 500); }
  }

  const teacherPreviewMatch = /^\/api\/teacher\/activities\/([^/]+)\/preview$/.exec(url.pathname);
  if (teacherPreviewMatch) {
    const user = await authenticateRequest(request, env.DB);
    if (!user) return json({ code: "SESSION_REQUIRED", error: "Sesión requerida" }, 401);
    try {
      return json(await getTeacherActivityPreview(env.DB, user.id, decodeURIComponent(teacherPreviewMatch[1]), url.searchParams.get("groupCode")));
    } catch (error) {
      if (error instanceof TeacherPreviewError) return json({ code: error.code, error: error.message, ...(error.groups ? { groups: error.groups } : {}) }, error.status);
      console.error("Fallo interno al consultar una prueba docente");
      return json({ code: "INTERNAL_ERROR", error: "No fue posible preparar la prueba docente" }, 500);
    }
  }

  const draftMatch = /^\/api\/me\/activities\/([^/]+)\/attempts\/([^/]+)$/.exec(url.pathname);
  if (draftMatch) {
    const user = await authenticateRequest(request, env.DB);
    if (!user) return json({ code: "SESSION_REQUIRED", error: "Sesión requerida" }, 401);
    let slug: string;
    try {
      slug = decodeURIComponent(draftMatch[1]);
    } catch {
      return json({ code: "ACTIVITY_NOT_FOUND", error: "La actividad no fue encontrada" }, 404);
    }
    try {
      return json(await getStudentActivityDraft(env.DB, user.id, slug, url.searchParams.get("groupCode"), draftMatch[2]));
    } catch (error) {
      if (error instanceof StudentActivityError) return json({ code: error.code, error: error.message }, error.status);
      console.error("Fallo interno al recuperar un borrador estudiantil");
      return json({ code: "INTERNAL_ERROR", error: "No fue posible recuperar el borrador" }, 500);
    }
  }

  const reviewMatch = /^\/api\/me\/activities\/([^/]+)\/review$/.exec(url.pathname);
  if (reviewMatch) {
    const user = await authenticateRequest(request, env.DB);
    if (!user) return json({ code: "SESSION_REQUIRED", error: "Sesión requerida" }, 401);
    let slug: string;
    try {
      slug = decodeURIComponent(reviewMatch[1]);
    } catch {
      return json({ code: "ACTIVITY_NOT_FOUND", error: "La actividad no fue encontrada" }, 404);
    }
    try {
      return json(await getStudentActivityReview(env.DB, user.id, slug, url.searchParams.get("groupCode")));
    } catch (error) {
      if (error instanceof StudentActivityError) return json({ code: error.code, error: error.message }, error.status);
      console.error("Fallo interno al consultar una revisión final estudiantil");
      return json({ code: "INTERNAL_ERROR", error: "No fue posible consultar la revisión" }, 500);
    }
  }

  const activityMatch = /^\/api\/me\/activities\/([^/]+)$/.exec(url.pathname);
  if (activityMatch) {
    const user = await authenticateRequest(request, env.DB);
    if (!user) return json({ code: "SESSION_REQUIRED", error: "Sesión requerida" }, 401);
    let slug: string;
    try {
      slug = decodeURIComponent(activityMatch[1]);
    } catch {
      return json({ code: "ACTIVITY_NOT_FOUND", error: "La actividad no fue encontrada" }, 404);
    }
    try {
      return json(await getStudentActivity(env.DB, user.id, slug, url.searchParams.get("groupCode")));
    } catch (error) {
      if (error instanceof StudentActivityError) {
        const body: Record<string, unknown> = { code: error.code, error: error.message };
        if (error.groups) body.groups = error.groups;
        return json(body, error.status);
      }
      console.error("Fallo interno al consultar una actividad estudiantil");
      return json({ code: "INTERNAL_ERROR", error: "No fue posible consultar la actividad" }, 500);
    }
  }

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

  if (url.pathname === "/api/account-activations/candidates") {
    return json(await listActivationCandidates(env.DB, user.id));
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
