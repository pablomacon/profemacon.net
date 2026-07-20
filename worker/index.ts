export interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request): Promise<Response> {
    return new Response(`No se encontró la ruta ${new URL(request.url).pathname}`, {
      status: 404,
    });
  },
} satisfies ExportedHandler<Env>;
