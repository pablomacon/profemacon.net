// Mapeo puro del bloque declarativo `youtube` (6D-A) al componente `VideoEmbed`.
//
// No duplica ninguna regla: el identificador, el título y la descripción los
// valida `parseYoutubeBlock` del contrato. Este módulo sólo traduce el bloque
// aprobado a la forma que espera el componente existente.
//
// Vive en un módulo `.ts` puro (sin JSX) para poder cubrirlo con `node --test`.
import { parseYoutubeBlock } from "./material-contract.ts";
import type { LessonVideo } from "../shared/video-embed";

/** `null` si el bloque no cumple el contrato: el renderer muestra un aviso, nunca un iframe. */
export function toLessonVideo(source: string): LessonVideo | null {
  const result = parseYoutubeBlock(source, "body");
  const block = result.block;
  if (!result.ok || block === null) return null;
  return {
    id: `youtube-${block.id}`,
    title: block.title,
    description: block.description ?? "",
    youtubeId: block.id,
  };
}
