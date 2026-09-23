// Binding de Vite: el ÚNICO lugar donde se descubre el contenido de `content/`.
//
// `import.meta.glob` con un patrón literal y perezoso (sin `eager: true`):
// Vite fija el mapa `ruta → loader` en build time, un chunk por archivo, y nada
// de Markdown entra al bundle inicial. Los parámetros de ruta, la URL o cualquier
// entrada del usuario NUNCA se usan para construir un import: sólo se consultan
// como claves de este mapa ya fijado.
import { createMaterialRegistry } from "./material-registry-core.ts";

const sources = import.meta.glob<string>("/content/*/*/*.md", { query: "?raw", import: "default" });

/** Catálogo de materiales v1 publicado en este build. */
export const materialRegistry = createMaterialRegistry(sources);
