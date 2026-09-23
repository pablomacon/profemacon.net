// Ruteo PURO de las rutas de curso del consumo automático de materiales (6D-B).
//
// Sin React, sin DOM, sin `import.meta`, sin acceso a archivos: sólo análisis de
// cadenas. Reutiliza los patrones del contrato 6D-A para no duplicar ninguna
// regla: si el contrato acepta un `subjectCode`, una unidad o un slug, este
// router los acepta; si no, los rechaza.
//
// Rutas reconocidas:
//   /curso/<subjectCode>
//   /curso/<subjectCode>/<unitCode>
//   /curso/<subjectCode>/<unitCode>/<slug>
//
// Nada más. En particular, las rutas legacy profundas de Unidad 1
// (`/curso/programacion-i/unidad-1/actividad/variables-java-01`) devuelven `null`
// porque tienen cuatro segmentos: el router genérico nunca las intercepta.
import { SLUG_PATTERN, SUBJECT_CODE_PATTERN, UNIT_CODE_PATTERN } from "./material-contract.ts";

export const COURSE_PREFIX = "/curso/";

/** Ruta segura de repliegue: se usa cuando un helper recibe un valor inválido. */
export const COURSE_FALLBACK_PATH = "/mis-cursos";

export type CourseRoute =
  | { kind: "course"; subjectCode: string }
  | { kind: "unit"; subjectCode: string; unitCode: string }
  | { kind: "material"; subjectCode: string; unitCode: string; slug: string };

const MAX_SLUG_LENGTH = 64;
const MIN_SLUG_LENGTH = 3;

/** Segmentos admitidos sin decodificar nada: `%`, `..`, mayúsculas y `:` caen solos. */
function segmentsOf(pathname: string): string[] | null {
  if (typeof pathname !== "string" || !pathname.startsWith(COURSE_PREFIX)) return null;
  const rest = pathname.slice(COURSE_PREFIX.length);
  if (rest.length === 0) return null;
  const segments = rest.split("/");
  if (segments.length > 3) return null;
  for (const segment of segments) if (segment.length === 0) return null;
  return segments;
}

/**
 * Interpreta una ruta de curso. Devuelve `null` si no tiene la forma exacta de
 * una ruta de curso del consumo automático. No consulta el registry: una ruta
 * bien formada puede no existir, y eso lo resuelve la página.
 */
export function parseCourseRoute(pathname: string): CourseRoute | null {
  const segments = segmentsOf(pathname);
  if (segments === null) return null;

  const [subjectCode, unitCode, slug] = segments;
  if (!SUBJECT_CODE_PATTERN.test(subjectCode)) return null;
  if (segments.length === 1) return { kind: "course", subjectCode };

  if (!UNIT_CODE_PATTERN.test(unitCode)) return null;
  if (segments.length === 2) return { kind: "unit", subjectCode, unitCode };

  if (slug.length < MIN_SLUG_LENGTH || slug.length > MAX_SLUG_LENGTH) return null;
  if (!SLUG_PATTERN.test(slug)) return null;
  return { kind: "material", subjectCode, unitCode, slug };
}

/** Ruta del índice de curso: `/curso/<subjectCode>`. */
export function coursePath(subjectCode: string): string {
  if (typeof subjectCode !== "string" || !SUBJECT_CODE_PATTERN.test(subjectCode)) return COURSE_FALLBACK_PATH;
  return `${COURSE_PREFIX}${subjectCode}`;
}

/** Ruta de una unidad v1: `/curso/<subjectCode>/<unitCode>`. */
export function unitPath(subjectCode: string, unitCode: string): string {
  if (typeof subjectCode !== "string" || !SUBJECT_CODE_PATTERN.test(subjectCode)) return COURSE_FALLBACK_PATH;
  if (typeof unitCode !== "string" || !UNIT_CODE_PATTERN.test(unitCode)) return COURSE_FALLBACK_PATH;
  return `${COURSE_PREFIX}${subjectCode}/${unitCode}`;
}

/** Ruta de un material v1: `/curso/<subjectCode>/<unitCode>/<slug>`. */
export function materialPath(subjectCode: string, unitCode: string, slug: string): string {
  const base = unitPath(subjectCode, unitCode);
  if (base === COURSE_FALLBACK_PATH) return COURSE_FALLBACK_PATH;
  if (typeof slug !== "string" || slug.length < MIN_SLUG_LENGTH || slug.length > MAX_SLUG_LENGTH) return COURSE_FALLBACK_PATH;
  if (!SLUG_PATTERN.test(slug)) return COURSE_FALLBACK_PATH;
  return `${base}/${slug}`;
}
