// Frontera única entre el contrato puro de autoría de materiales (Hito 6D-A) y el
// frontend (Hito 6D-B).
//
// El contrato vive en `worker/material-authoring.ts`: es un módulo puro, sin D1,
// sin `env`, sin acceso a archivos y sin efectos secundarios, por lo que puede
// importarse desde el cliente sin arrastrar nada del Worker.
//
// Este archivo reexporta ÚNICAMENTE lo que el consumo automático necesita. No se
// duplica ninguna regla, ningún patrón y ninguna validación: si el contrato
// cambia, este módulo y quien lo use cambian con él.
//
// La extensión `.ts` es explícita para que el mismo módulo sea importable tanto
// por Vite como por `node --test` (los pipelines de autoría ya se prueban así).
export {
  anchorIdOf,
  materialAssetPrefix,
  parseContentPath,
  parseMaterialDocument,
  parseYoutubeBlock,
  SLUG_PATTERN,
  SUBJECT_CODE_PATTERN,
  UNIT_CODE_PATTERN,
} from "../../../worker/material-authoring.ts";

export type {
  MaterialIssue,
  MaterialPathInfo,
  ParsedMaterialDocument,
  ParsedYoutubeBlock,
} from "../../../worker/material-authoring.ts";
