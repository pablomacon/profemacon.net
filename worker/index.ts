export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Las rutas de interfaz se resuelven en React. ASSETS continúa sirviendo
    // los archivos estáticos y permite el mismo fallback en local y producción.
    return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
  },
} satisfies ExportedHandler<Env>;
