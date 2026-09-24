/**
 * Entrada de Worker SOLO para pruebas locales (A2.1a-L).
 *
 * No forma parte del artefacto desplegable: `wrangler.jsonc`, `vite.config.ts`, el build
 * beta y `tsconfig.worker.json` no la incluyen. Las pruebas la usan como `main` de una
 * configuración temporal para poder ejercitar la primitiva interna `revokeAllSessions`,
 * que en A2.1a todavía no tiene endpoint público ni administrativo.
 *
 * Su razón de ser es la contraria a la de un mock: todo lo que no es la sonda pasa por el
 * manejador de producción importado tal cual, así que las rutas protegidas que se prueban
 * son exactamente las desplegables. La sonda exige un encabezado de prueba y responde 404
 * sin él, así que tampoco existe por accidente.
 */
import production from "../../worker/index";
import { revokeAllSessions, SessionRevocationError, type SessionRevocationReason } from "../../worker/session-revocation";

const PROBE_HEADER = "x-prueba-revocacion-global";
const PROBE_VALUE = "prueba-local-revocacion-global";

const jsonHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/api/test/revocacion-global") return production.fetch(request, env);

    if (request.method !== "POST" || request.headers.get(PROBE_HEADER) !== PROBE_VALUE) {
      return json({ code: "NOT_FOUND", error: "Recurso no encontrado" }, 404);
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("cuerpo inválido");
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ code: "INVALID_REQUEST", error: "Solicitud inválida" }, 400);
    }

    try {
      const result = await revokeAllSessions(env.DB, Number(body.userId), {
        reason: body.reason as SessionRevocationReason,
        actorUserId: body.actorUserId === undefined || body.actorUserId === null ? null : Number(body.actorUserId),
      });
      return json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof SessionRevocationError) return json({ code: error.code, error: error.message }, error.status);
      return json({ code: "INTERNAL_ERROR", error: "No fue posible revocar las sesiones" }, 500);
    }
  },
};
