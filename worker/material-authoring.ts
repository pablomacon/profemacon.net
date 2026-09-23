// Lenguaje de autoría de materiales teóricos (Markdown + frontmatter plano, v1).
//
// Módulo PURO: no accede a D1, no usa `env`, no lee ni escribe archivos y no se
// importa desde `worker/index.ts`, por lo que no forma parte del bundle del
// Worker. Todo lo que necesita del exterior se inyecta como contexto explícito:
//
//   · `contentPath` ubicación destino (`content/<asignatura>/<unidad>/<slug>.md`);
//   · `assets`      índice de assets same-origin disponibles (`/materiales/...`);
//   · `bytes`       tamaño real del archivo en disco.
//
// Responsabilidades exclusivas:
//
//   1. validar y normalizar el frontmatter plano y estricto (sin YAML completo);
//   2. validar la política del cuerpo Markdown (bloques permitidos y seguridad);
//   3. validar imágenes, bloques `mermaid` y bloques `youtube` declarativos;
//   4. calcular el SHA-256 del fuente con una única convención documentada;
//   5. emitir observaciones con `severity`, `code`, `path` y `message`.
//
// El material teórico no tiene secretos: el archivo validado es el artefacto
// público. Este módulo nunca imprime ni devuelve material privado.
//
// Convención de hash (§15 del plan 6D): SHA-256 de los bytes UTF-8 del archivo
// leído con el BOM UTF-8 inicial retirado y sin ninguna otra transformación.
// `sha256Hex(stripBom(texto))` reproduce exactamente esa convención.

export const MATERIAL_SCHEMA_VERSION = 1;
export const MAX_MATERIAL_BYTES = 256 * 1024;
export const MAX_TITLE_LENGTH = 140;
export const MAX_SUMMARY_LENGTH = 300;
export const MAX_UNIT_TITLE_LENGTH = 140;
export const MAX_AUTHORING_LENGTH = 100;
export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 32;
export const MIN_ESTIMATED_MINUTES = 5;
export const MAX_ESTIMATED_MINUTES = 600;
export const MIN_ORDER = 1;
export const MAX_ORDER = 99;
export const MAX_MATERIAL_WORDS = 4000;
export const MAX_MATERIAL_LINES = 250;
export const MAX_CODE_BLOCK_LINES = 80;
export const MAX_IMAGES = 12;
export const MAX_VIDEOS = 6;
export const MAX_IMAGE_BYTES = 400 * 1024;
export const MAX_ALT_LENGTH = 300;
export const MIN_ALT_LENGTH = 15;
export const MAX_MERMAID_LINES = 200;
export const MAX_MERMAID_BYTES = 8 * 1024;
export const MAX_YOUTUBE_DESCRIPTION_LENGTH = 300;
export const MIN_YOUTUBE_TITLE_LENGTH = 3;
export const MATERIAL_ASSET_PREFIX = "/materiales/";
export const DEFAULT_AUTHORING = "profe-macon-ai-workflow";

// Lenguajes admitidos en bloques de código. `mermaid` y `youtube` no son código:
// son bloques declarativos con su propio validador.
export const CODE_LANGUAGES = [
  "java", "javascript", "typescript", "sql", "python", "html", "css", "bash", "json", "text",
] as const;

export const DECLARATIVE_FENCE_LANGUAGES = ["mermaid", "youtube"] as const;

export const IMAGE_EXTENSIONS = ["webp", "png", "jpg", "jpeg", "svg", "avif"] as const;

export const ALLOWED_LINK_PROTOCOLS = ["http:", "https:"] as const;

export const MERMAID_KEYWORDS = [
  "flowchart", "graph", "sequenceDiagram", "classDiagram", "stateDiagram", "erDiagram",
  "journey", "gantt", "pie", "mindmap", "quadrantChart", "timeline", "xychart",
] as const;

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const UNIT_CODE_PATTERN = /^unidad-[0-9]{1,2}$/;
export const SUBJECT_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Misma convención que el pipeline de actividades (Hito 6A).
export const TAG_PATTERN = /^[\p{Ll}\p{N}]+(?:-[\p{Ll}\p{N}]+)*$/u;
export const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

// Códigos que representan una decisión de política o de seguridad. El CLI los
// usa para distinguir «error de validación» (salida 1) de «rechazo por política»
// (salida 2), igual que los pipelines 6A y 6C.
export const POLICY_ISSUE_CODES = [
  "UNSAFE_CONTENT",
  "UNSAFE_LINK",
  "IMAGE_INVALID",
] as const;

export type MaterialSeverity = "error" | "warning" | "note";

export type MaterialIssue = {
  severity: MaterialSeverity;
  code: string;
  path: string;
  message: string;
};

export type MaterialHeader = {
  schemaVersion: number;
  slug: string;
  title: string;
  unitCode: string;
  order: number;
  summary: string | null;
  unitTitle: string | null;
  estimatedMinutes: number | null;
  tags: string[];
  authoring: string;
};

export type MaterialHeading = {
  level: number;
  text: string;
  anchor: string;
  line: number;
};

export type MaterialImage = {
  src: string;
  alt: string;
  line: number;
};

export type MaterialLink = {
  href: string;
  line: number;
};

export type MaterialBlockKind =
  | "paragraph" | "heading" | "list" | "blockquote" | "table" | "code" | "thematic-break";

export type MaterialBlock = {
  kind: MaterialBlockKind;
  line: number;
  endLine: number;
  level: number | null;
  language: string | null;
  text: string;
};

export type ParsedYoutubeBlock = {
  id: string;
  title: string;
  description: string | null;
  line: number;
};

export type MaterialStats = {
  lines: number;
  words: number;
  headings: number;
  paragraphs: number;
  lists: number;
  blockquotes: number;
  tables: number;
  codeBlocks: number;
  images: number;
  videos: number;
  links: number;
};

export type MaterialAssetEntry = {
  /** Ruta same-origin del asset, por ejemplo `/materiales/programacion-i/unidad-1/clase-01/x.webp`. */
  path: string;
  /** Tamaño en bytes cuando se conoce. */
  bytes: number | null;
};

export type MaterialParseContext = {
  /** Ruta destino bajo `content/`. Se usa para cruzar path ↔ frontmatter. */
  contentPath?: string | null;
  /** Índice de assets same-origin disponibles. `null` desactiva la comprobación de existencia. */
  assets?: readonly MaterialAssetEntry[] | null;
  /** Tamaño real del archivo en disco, cuando se conoce. */
  bytes?: number | null;
};

export type MaterialPathInfo = {
  subjectCode: string;
  unitCode: string;
  slug: string;
};

export type ParsedMaterialDocument = {
  schemaVersion: number;
  header: MaterialHeader;
  subjectCode: string | null;
  contentPath: string | null;
  body: string;
  blocks: MaterialBlock[];
  headings: MaterialHeading[];
  images: MaterialImage[];
  links: MaterialLink[];
  videos: ParsedYoutubeBlock[];
  stats: MaterialStats;
  orphanImages: string[];
  hasAssetIndex: boolean;
};

export type MaterialDocumentKind = "material-v1" | "legacy-material" | "unknown";

export type MaterialParseResult = {
  ok: boolean;
  kind: MaterialDocumentKind;
  issues: MaterialIssue[];
  errors: MaterialIssue[];
  warnings: MaterialIssue[];
  notes: MaterialIssue[];
  parsed: ParsedMaterialDocument | null;
};

// ---- Utilidades puras --------------------------------------------------------

/** Retira el BOM UTF-8 inicial. Es la única normalización previa al hash. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function splitLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Slug de ancla equivalente al `textId` del frontend actual (Unidad 0 y Unidad 1).
 * Se replica aquí sin tocar los componentes existentes.
 */
export function anchorIdOf(text: unknown): string {
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * SHA-256 en hexadecimal sobre los bytes UTF-8 del texto recibido.
 * `sha256Hex(stripBom(fuente))` es la convención oficial del pipeline.
 */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) throw new Error("El entorno no expone SHA-256 mediante Web Crypto.");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Normaliza separadores para poder analizar rutas de Windows y de POSIX. */
export function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

/**
 * Interpreta `content/<asignatura>/<unidad>/<slug>.md` (absoluta o relativa).
 * Devuelve `null` si la ruta no corresponde a esa convención.
 */
export function parseContentPath(contentPath: string): MaterialPathInfo | null {
  const segments = normalizeSlashes(contentPath).split("/").filter((segment) => segment.length > 0);
  const contentIndex = segments.lastIndexOf("content");
  if (contentIndex < 0) return null;
  const rest = segments.slice(contentIndex + 1);
  if (rest.length !== 3) return null;
  const [subjectCode, unitCode, file] = rest;
  if (!file.toLowerCase().endsWith(".md")) return null;
  const slug = file.slice(0, -3);
  if (!SUBJECT_CODE_PATTERN.test(subjectCode)) return null;
  if (!UNIT_CODE_PATTERN.test(unitCode)) return null;
  if (!SLUG_PATTERN.test(slug)) return null;
  return { subjectCode, unitCode, slug };
}

/** Prefijo de imágenes propio del material: `/materiales/<asignatura>/<unidad>/<slug>/`. */
export function materialAssetPrefix(info: MaterialPathInfo): string {
  return `${MATERIAL_ASSET_PREFIX}${info.subjectCode}/${info.unitCode}/${info.slug}/`;
}

/** Índice de assets consultable, construido una sola vez por documento. */
export function buildAssetIndex(
  assets: readonly MaterialAssetEntry[] | null | undefined,
): Map<string, number | null> {
  const index = new Map<string, number | null>();
  for (const asset of assets ?? []) {
    if (typeof asset?.path !== "string" || asset.path.length === 0) continue;
    index.set(asset.path, typeof asset.bytes === "number" && Number.isFinite(asset.bytes) ? asset.bytes : null);
  }
  return index;
}

/** Assets del índice que viven en el prefijo indicado. */
export function assetsUnderPrefix(index: Map<string, number | null>, prefix: string): string[] {
  const found: string[] = [];
  for (const path of index.keys()) if (path.startsWith(prefix) && path !== prefix) found.push(path);
  return found.sort();
}

// ---- Colector de observaciones ----------------------------------------------
type Collector = {
  issues: MaterialIssue[];
  fail(code: string, path: string, message: string): void;
  warn(code: string, path: string, message: string): void;
  note(code: string, path: string, message: string): void;
};

function createCollector(): Collector {
  const issues: MaterialIssue[] = [];
  const add = (severity: MaterialSeverity) => (code: string, path: string, message: string) => {
    issues.push({ severity, code, path, message });
  };
  return { issues, fail: add("error"), warn: add("warning"), note: add("note") };
}

// ---- Frontmatter plano y estricto -------------------------------------------
const REQUIRED_KEYS = ["schemaVersion", "slug", "title", "unitCode", "order"] as const;
const OPTIONAL_KEYS = ["summary", "unitTitle", "estimatedMinutes", "tags", "authoring"] as const;
const FRONTMATTER_KEYS: readonly string[] = [...REQUIRED_KEYS, ...OPTIONAL_KEYS];

const FRONTMATTER_ENTRY_PATTERN = /^([A-Za-z][A-Za-z0-9_]*)[ \t]*:[ \t]*(.*)$/;
const INDENTED_PATTERN = /^[ \t]+\S/;
const INTEGER_PATTERN = /^\d+$/;

type FrontmatterValues = Map<string, string>;

type FrontmatterResult = {
  values: FrontmatterValues;
  /** Índice (base 0) de la primera línea del cuerpo dentro del arreglo de líneas. */
  bodyStartLine: number;
};

export function detectMaterialDocumentKind(source: string): MaterialDocumentKind {
  const lines = splitLines(stripBom(source));
  const open = lines.findIndex((line) => line.trim().length > 0);
  if (open < 0 || lines[open].trim() !== "---") return "unknown";
  let close = -1;
  for (let index = open + 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") { close = index; break; }
  }
  if (close < 0) return "unknown";
  const interior = lines.slice(open + 1, close);
  return interior.some((line) => /^schemaVersion[ \t]*:/.test(line)) ? "material-v1" : "legacy-material";
}

/** `true` sólo para documentos que declaran el contrato v1 (los legacy quedan afuera). */
export function isMaterialV1Document(source: string): boolean {
  return detectMaterialDocumentKind(source) === "material-v1";
}

function parseFrontmatter(lines: string[], collector: Collector): FrontmatterResult {
  const values: FrontmatterValues = new Map();
  const open = lines.findIndex((line) => line.trim().length > 0);

  if (open < 0) {
    collector.fail("MATERIAL_SCHEMA", "frontmatter", "El material está vacío.");
    return { values, bodyStartLine: lines.length };
  }
  if (lines[open].trim() !== "---") {
    collector.fail("MATERIAL_SCHEMA", "frontmatter", "El material debe comenzar con un frontmatter delimitado por «---».");
    return { values, bodyStartLine: 0 };
  }

  let close = -1;
  for (let index = open + 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") { close = index; break; }
  }
  if (close < 0) {
    collector.fail("MATERIAL_SCHEMA", "frontmatter", "El frontmatter no tiene la línea de cierre «---».");
    return { values, bodyStartLine: lines.length };
  }

  lines.slice(open + 1, close).forEach((line, offset) => {
    const path = `frontmatter[${open + offset + 2}]`;
    if (line.trim().length === 0) return;
    if (INDENTED_PATTERN.test(line)) {
      collector.fail("MATERIAL_SCHEMA", path, "El frontmatter es plano: no se admiten líneas indentadas ni claves anidadas.");
      return;
    }
    if (line.trim() === "-" || line.trim().startsWith("- ")) {
      collector.fail("MATERIAL_SCHEMA", path, "El frontmatter es plano: no se admiten listas YAML.");
      return;
    }
    const entry = FRONTMATTER_ENTRY_PATTERN.exec(line);
    if (!entry) {
      collector.fail("MATERIAL_SCHEMA", path, "Cada línea del frontmatter debe tener la forma «clave: valor».");
      return;
    }
    const key = entry[1];
    const rawValue = entry[2].trim();
    if (/^[[{>*&|!]/.test(rawValue) || /^["']/.test(rawValue)) {
      collector.fail("MATERIAL_SCHEMA", `${path}.${key}`,
        "El frontmatter es plano: no se admiten listas, objetos, anclas, comillas ni escalares multilínea.");
      return;
    }
    if (values.has(key)) {
      collector.fail("DUPLICATE_KEY", `${path}.${key}`, `La clave «${key}» está repetida en el frontmatter.`);
      return;
    }
    if (!FRONTMATTER_KEYS.includes(key)) {
      collector.fail("UNKNOWN_KEY", `${path}.${key}`,
        `La clave «${key}» no forma parte del contrato v1. Admitidas: ${FRONTMATTER_KEYS.join(", ")}.`);
      return;
    }
    values.set(key, rawValue);
  });

  // Un segundo bloque de frontmatter delimitado por «---» es un error de autoría,
  // no una línea temática del cuerpo.
  for (let index = close + 1; index < lines.length; index += 1) {
    if (lines[index].trim() !== "---") continue;
    let end = index + 1;
    while (end < lines.length && lines[end].trim() !== "---") end += 1;
    const block = lines.slice(index + 1, end);
    if (block.some((line) => /^schemaVersion[ \t]*:/.test(line))) {
      collector.fail("DUPLICATE_FRONTMATTER", "frontmatter",
        "El material tiene un segundo bloque de frontmatter: sólo se admite uno al comienzo del archivo.");
      break;
    }
    index = end;
  }

  return { values, bodyStartLine: close + 1 };
}

function readRequiredValue(values: FrontmatterValues, key: string, collector: Collector): string | null {
  const raw = values.get(key);
  if (raw === undefined) {
    collector.fail("MISSING_FIELD", `frontmatter.${key}`, "Falta un campo obligatorio.");
    return null;
  }
  if (raw.length === 0) {
    collector.fail("INVALID_VALUE", `frontmatter.${key}`, `La clave «${key}» quedó sin valor.`);
    return null;
  }
  return raw;
}

function readOptionalValue(values: FrontmatterValues, key: string, collector: Collector): string | null {
  const raw = values.get(key);
  if (raw === undefined) return null;
  if (raw.length === 0) {
    collector.fail("INVALID_VALUE", `frontmatter.${key}`, `La clave «${key}» quedó sin valor.`);
    return null;
  }
  return raw;
}

function parseIntegerValue(
  raw: string | null,
  key: string,
  options: { min: number; max: number; code: string },
  collector: Collector,
): number | null {
  if (raw === null) return null;
  if (!INTEGER_PATTERN.test(raw)) {
    collector.fail(options.code, `frontmatter.${key}`, `La clave «${key}» debe ser un número entero sin comillas.`);
    return null;
  }
  const value = Number.parseInt(raw, 10);
  if (value < options.min || value > options.max) {
    collector.fail(options.code, `frontmatter.${key}`, `La clave «${key}» debe estar entre ${options.min} y ${options.max}.`);
    return null;
  }
  return value;
}

function parseTagsValue(raw: string | null, collector: Collector): string[] {
  if (raw === null) return [];
  const entries = raw.split(",").map((entry) => entry.trim().toLowerCase());
  if (entries.length > MAX_TAGS) {
    collector.fail("INVALID_TAGS", "frontmatter.tags", `Se admiten hasta ${MAX_TAGS} etiquetas separadas por comas.`);
    return [];
  }
  const tags: string[] = [];
  entries.forEach((entry, index) => {
    if (entry.length === 0) {
      collector.fail("INVALID_TAGS", `frontmatter.tags[${index}]`, "Hay una etiqueta vacía: revisá las comas.");
      return;
    }
    if (entry.length > MAX_TAG_LENGTH || !TAG_PATTERN.test(entry)) {
      collector.fail("INVALID_FORMAT", `frontmatter.tags[${index}]`,
        "Cada etiqueta usa minúsculas sin espacios: letras, números y guiones.");
      return;
    }
    tags.push(entry);
  });
  return tags;
}

function parseHeader(values: FrontmatterValues, collector: Collector): MaterialHeader | null {
  const schemaVersionRaw = readRequiredValue(values, "schemaVersion", collector);
  const slug = readRequiredValue(values, "slug", collector);
  const title = readRequiredValue(values, "title", collector);
  const unitCode = readRequiredValue(values, "unitCode", collector);
  const orderRaw = readRequiredValue(values, "order", collector);

  const schemaVersion = parseIntegerValue(schemaVersionRaw, "schemaVersion",
    { min: MATERIAL_SCHEMA_VERSION, max: MATERIAL_SCHEMA_VERSION, code: "MATERIAL_SCHEMA" }, collector);

  const parsedSlug = slug !== null && SLUG_PATTERN.test(slug) && slug.length >= 3 && slug.length <= 64 ? slug : null;
  if (slug !== null && parsedSlug === null) {
    collector.fail("INVALID_SLUG", "frontmatter.slug",
      "El slug usa minúsculas, números y guiones, y tiene entre 3 y 64 caracteres.");
  }

  const parsedTitle = title !== null && title.length >= 3 && title.length <= MAX_TITLE_LENGTH ? title : null;
  if (title !== null && parsedTitle === null) {
    collector.fail("INVALID_TITLE", "frontmatter.title", `El título tiene entre 3 y ${MAX_TITLE_LENGTH} caracteres.`);
  }

  const parsedUnitCode = unitCode !== null && UNIT_CODE_PATTERN.test(unitCode) ? unitCode : null;
  if (unitCode !== null && parsedUnitCode === null) {
    collector.fail("INVALID_UNIT_CODE", "frontmatter.unitCode", "El código de unidad tiene la forma «unidad-<número>».");
  }

  const order = parseIntegerValue(orderRaw, "order", { min: MIN_ORDER, max: MAX_ORDER, code: "INVALID_ORDER" }, collector);

  const summary = readOptionalValue(values, "summary", collector);
  if (summary !== null && summary.length > MAX_SUMMARY_LENGTH) {
    collector.fail("INVALID_LENGTH", "frontmatter.summary", `El resumen admite hasta ${MAX_SUMMARY_LENGTH} caracteres.`);
  }
  const unitTitle = readOptionalValue(values, "unitTitle", collector);
  if (unitTitle !== null && unitTitle.length > MAX_UNIT_TITLE_LENGTH) {
    collector.fail("INVALID_LENGTH", "frontmatter.unitTitle", `El título de unidad admite hasta ${MAX_UNIT_TITLE_LENGTH} caracteres.`);
  }
  const estimatedMinutes = parseIntegerValue(readOptionalValue(values, "estimatedMinutes", collector), "estimatedMinutes",
    { min: MIN_ESTIMATED_MINUTES, max: MAX_ESTIMATED_MINUTES, code: "INVALID_ESTIMATED_MINUTES" }, collector);

  const tagsRaw = readOptionalValue(values, "tags", collector);
  const tags = parseTagsValue(tagsRaw, collector);

  const authoringRaw = readOptionalValue(values, "authoring", collector);
  if (authoringRaw !== null && authoringRaw.length > MAX_AUTHORING_LENGTH) {
    collector.fail("INVALID_LENGTH", "frontmatter.authoring", `La clave «authoring» admite hasta ${MAX_AUTHORING_LENGTH} caracteres.`);
  }
  const authoring = authoringRaw ?? DEFAULT_AUTHORING;
  if (authoringRaw === null) {
    collector.note("AUTHORING_DEFAULT", "frontmatter.authoring", `Se asume «${DEFAULT_AUTHORING}».`);
  }

  if (schemaVersion === null || parsedSlug === null || parsedTitle === null || parsedUnitCode === null || order === null) {
    return null;
  }
  return {
    schemaVersion,
    slug: parsedSlug,
    title: parsedTitle,
    unitCode: parsedUnitCode,
    order,
    summary: summary !== null && summary.length <= MAX_SUMMARY_LENGTH ? summary : null,
    unitTitle: unitTitle !== null && unitTitle.length <= MAX_UNIT_TITLE_LENGTH ? unitTitle : null,
    estimatedMinutes,
    tags,
    authoring,
  };
}

// ---- Exploración del cuerpo --------------------------------------------------
// Los paths de las observaciones usan `body[<n>]`, donde <n> es la línea contada
// desde el comienzo del cuerpo (1 = primera línea después del frontmatter).

const FENCE_OPEN_PATTERN = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)(.*)$/;
const FENCE_CLOSE_PATTERN = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const HEADING_PATTERN = /^ {0,3}(#{1,6})[ \t]*(.*?)[ \t]*#*[ \t]*$/;
const THEMATIC_BREAK_PATTERN = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const SETEXT_UNDERLINE_PATTERN = /^ {0,3}=+[ \t]*$/;
const BLOCKQUOTE_PATTERN = /^ {0,3}>/;
const TABLE_ROW_PATTERN = /^ {0,3}\|/;
const TABLE_DELIMITER_PATTERN = /^ {0,3}\|?[ \t:|-]*-[ \t:|-]*\|[ \t:|-]*$/;
const LIST_ITEM_PATTERN = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+/;

const INLINE_CODE_PATTERN = /`+/;
const IMAGE_PATTERN = /!\[([^\]]*)\]\(\s*([^)\s]*)(?:\s+"[^"]*")?\s*\)/g;
const IMAGE_SPAN_PATTERN = /!\[[^\]]*\]\(\s*[^)\s]*(?:\s+"[^"]*")?\s*\)/g;
const LINK_PATTERN = /\[([^\]]*)\]\(\s*([^)\s]*)(?:\s+"[^"]*")?\s*\)/g;
const LINK_TARGET_SPAN_PATTERN = /\]\(\s*[^)\s]*(?:\s+"[^"]*")?\s*\)/g;
const AUTOLINK_PATTERN = /<([A-Za-z][A-Za-z0-9+.-]*:[^<>\s]*)>/g;
const REFERENCE_LINK_PATTERN = /\]\[[^\]]*\]/;
const REFERENCE_DEFINITION_PATTERN = /^ {0,3}\[[^\]]+\]:[ \t]*\S/;
const HTML_TAG_PATTERN = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/;
const HTML_COMMENT_PATTERN = /<!--/;
const EVENT_ATTRIBUTE_PATTERN = /\son[a-z]+\s*=/i;
const DANGEROUS_SCHEME_PATTERN = /(?:^|[^\w])(?:javascript|data|vbscript|file)\s*:/i;
const MDX_EXPRESSION_PATTERN = /^\s*(?:import|export)[ \t]+\S/;

/** Reemplaza por espacios los tramos que coinciden con el patrón, conservando índices. */
function maskSpans(line: string, pattern: RegExp): string {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  let output = "";
  let cursor = 0;
  for (const match of line.matchAll(regex)) {
    const index = match.index ?? 0;
    output += line.slice(cursor, index) + " ".repeat(match[0].length);
    cursor = index + match[0].length;
  }
  return output + line.slice(cursor);
}

/** Enmascara los tramos de código en línea para no confundirlos con HTML real. */
function maskInlineCode(line: string): string {
  let output = "";
  let index = 0;
  while (index < line.length) {
    if (line[index] !== "`") {
      output += line[index];
      index += 1;
      continue;
    }
    const fence = INLINE_CODE_PATTERN.exec(line.slice(index))?.[0] ?? "`";
    const close = line.indexOf(fence, index + fence.length);
    const end = close < 0 ? line.length : close + fence.length;
    output += " ".repeat(end - index);
    index = end;
  }
  return output;
}

function schemeOf(target: string): string | null {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(target);
  return match ? `${match[1].toLowerCase()}:` : null;
}

function checkLinkTarget(target: string, line: number, collector: Collector, path: string): string | null {
  if (target.length === 0) {
    collector.fail("UNSAFE_LINK", path, `Un enlace de la línea ${line} no tiene destino.`);
    return null;
  }
  const scheme = schemeOf(target);
  if (scheme !== null) {
    if (!(ALLOWED_LINK_PROTOCOLS as readonly string[]).includes(scheme)) {
      collector.fail("UNSAFE_LINK", path, `Esquema no permitido en un enlace (${scheme}): sólo se admiten http y https.`);
      return null;
    }
    return target;
  }
  if (target.startsWith("//")) {
    collector.fail("UNSAFE_LINK", path, "Un enlace usa una ruta protocolo-relativa («//»), que no está permitida.");
    return null;
  }
  if (target.includes("\\")) {
    collector.fail("UNSAFE_LINK", path, "Un enlace contiene barras invertidas.");
    return null;
  }
  // Enlaces internos relativos: permitidos sin esquema.
  return target;
}

function checkImageSource(
  src: string,
  info: MaterialPathInfo | null,
  assets: Map<string, number | null>,
  hasAssetIndex: boolean,
  line: number,
  collector: Collector,
): boolean {
  const path = `body[${line}]`;
  if (src.length === 0) {
    collector.fail("IMAGE_INVALID", path, "La imagen no declara una ruta.");
    return false;
  }
  if (!src.startsWith(MATERIAL_ASSET_PREFIX)) {
    collector.fail("IMAGE_INVALID", path,
      `Las imágenes deben ser del mismo origen y vivir bajo «${MATERIAL_ASSET_PREFIX}»: recibido «${src}».`);
    return false;
  }
  const rest = src.slice(MATERIAL_ASSET_PREFIX.length);
  if (rest.startsWith("/") || rest.includes("..") || rest.includes("\\") || rest.includes("://")) {
    collector.fail("IMAGE_INVALID", path, "La ruta de la imagen contiene una navegación no permitida.");
    return false;
  }
  const segments = rest.split("/");
  const file = segments.at(-1) ?? "";
  const extension = file.includes(".") ? file.slice(file.lastIndexOf(".") + 1).toLowerCase() : "";
  if (segments.length < 4 || file.length === 0 || !(IMAGE_EXTENSIONS as readonly string[]).includes(extension)) {
    collector.fail("IMAGE_INVALID", path,
      `La imagen debe seguir «/materiales/<asignatura>/<unidad>/<material>/<archivo>.<ext>» con extensión ${IMAGE_EXTENSIONS.join(", ")}.`);
    return false;
  }
  if (info !== null) {
    const prefix = materialAssetPrefix(info);
    if (!src.startsWith(prefix) || src.slice(prefix.length).length === 0) {
      collector.fail("IMAGE_INVALID", path, `La imagen debe vivir en la carpeta del material: «${prefix}».`);
      return false;
    }
  }
  if (!hasAssetIndex) return true;
  if (!assets.has(src)) {
    collector.fail("IMAGE_NOT_FOUND", path, `No existe el archivo de imagen «${src}» en assets.`);
    return false;
  }
  const bytes = assets.get(src) ?? null;
  if (bytes !== null && bytes > MAX_IMAGE_BYTES) {
    collector.warn("IMAGE_HEAVY", path,
      `La imagen pesa ${Math.round(bytes / 1024)} KiB: conviene reducirla por debajo de ${Math.round(MAX_IMAGE_BYTES / 1024)} KiB.`);
  }
  return true;
}

function checkAlt(alt: string, line: number, collector: Collector): boolean {
  const path = `body[${line}]`;
  if (alt.trim().length === 0) {
    collector.fail("IMAGE_ALT_MISSING", path, "La imagen no tiene texto alternativo.");
    return false;
  }
  if (alt.length > MAX_ALT_LENGTH) {
    collector.warn("IMAGE_ALT_WEAK", path, `El texto alternativo supera ${MAX_ALT_LENGTH} caracteres.`);
  }
  if (alt.trim().length < MIN_ALT_LENGTH) {
    collector.warn("IMAGE_ALT_WEAK", path, "El texto alternativo es demasiado breve para ser útil.");
  }
  return true;
}

// ---- Bloques declarativos: youtube -------------------------------------------
const YOUTUBE_KEYS = ["id", "title", "description"] as const;
const DECLARATIVE_ENTRY_PATTERN = /^([A-Za-z][A-Za-z0-9]*)[ \t]*:[ \t]*(.*)$/;

function parseYoutubeBlockInto(
  content: string,
  line: number,
  collector: Collector,
): ParsedYoutubeBlock | null {
  const path = `body[${line}]`;
  const values = new Map<string, string>();
  for (const raw of splitLines(content)) {
    if (raw.trim().length === 0) continue;
    const entry = DECLARATIVE_ENTRY_PATTERN.exec(raw.trim());
    if (!entry) {
      collector.fail("YOUTUBE_INVALID", path, "Cada línea del bloque «youtube» debe tener la forma «clave: valor».");
      return null;
    }
    const key = entry[1];
    if (!(YOUTUBE_KEYS as readonly string[]).includes(key)) {
      collector.fail("YOUTUBE_INVALID", path,
        `La clave «${key}» no forma parte del bloque «youtube». Admitidas: ${YOUTUBE_KEYS.join(", ")}.`);
      return null;
    }
    if (values.has(key)) {
      collector.fail("YOUTUBE_INVALID", path, `La clave «${key}» está repetida en el bloque «youtube».`);
      return null;
    }
    values.set(key, entry[2].trim());
  }

  const id = values.get("id") ?? null;
  const title = values.get("title") ?? null;
  const description = values.get("description") ?? null;
  let valid = true;

  if (id === null || id.length === 0) {
    collector.fail("YOUTUBE_INVALID", path, "Falta la clave «id» del video.");
    valid = false;
  } else if (!YOUTUBE_ID_PATTERN.test(id)) {
    collector.fail("YOUTUBE_INVALID", path,
      "El identificador de YouTube debe tener 11 caracteres (letras, números, «-» o «_»), sin URL ni parámetros.");
    valid = false;
  }
  if (title === null || title.length < MIN_YOUTUBE_TITLE_LENGTH || title.length > MAX_TITLE_LENGTH) {
    collector.fail("YOUTUBE_INVALID", path,
      `El video necesita un «title» de ${MIN_YOUTUBE_TITLE_LENGTH} a ${MAX_TITLE_LENGTH} caracteres.`);
    valid = false;
  }
  if (description !== null && description.length > MAX_YOUTUBE_DESCRIPTION_LENGTH) {
    collector.fail("YOUTUBE_INVALID", path, `La descripción admite hasta ${MAX_YOUTUBE_DESCRIPTION_LENGTH} caracteres.`);
    valid = false;
  }
  if (!valid) return null;
  if (description === null) {
    collector.warn("VIDEO_WITHOUT_DESCRIPTION", path, "El video no tiene descripción: ayuda a saber por qué mirarlo.");
  }
  return { id: id as string, title: title as string, description, line };
}

/** Parser público del bloque declarativo `youtube`, reutilizable por el renderer. */
export function parseYoutubeBlock(
  content: string,
  path = "body",
): { ok: boolean; issues: MaterialIssue[]; block: ParsedYoutubeBlock | null } {
  const collector = createCollector();
  const block = parseYoutubeBlockInto(typeof content === "string" ? content : "", 0, collector);
  const issues = collector.issues.map((issue) => ({ ...issue, path }));
  return { ok: block !== null && !issues.some((issue) => issue.severity === "error"), issues, block };
}

// ---- Bloques declarativos: mermaid (validación estática) ---------------------
function mermaidKeywordOf(content: string): string {
  for (const raw of splitLines(content)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("%%")) continue;
    return line.split(/[\s{]+/)[0] ?? "";
  }
  return "";
}

function checkMermaidBlock(content: string, line: number, collector: Collector): boolean {
  const path = `body[${line}]`;
  const text = content.replace(/\s+$/, "");
  if (text.trim().length === 0) {
    collector.fail("MERMAID_INVALID", path, "El diagrama Mermaid está vacío.");
    return false;
  }
  const lines = splitLines(text);
  if (lines.length > MAX_MERMAID_LINES) {
    collector.fail("MERMAID_INVALID", path, `El diagrama supera ${MAX_MERMAID_LINES} líneas.`);
    return false;
  }
  if (new TextEncoder().encode(text).length > MAX_MERMAID_BYTES) {
    collector.fail("MERMAID_INVALID", path, `El diagrama supera ${Math.round(MAX_MERMAID_BYTES / 1024)} KiB.`);
    return false;
  }
  const keyword = mermaidKeywordOf(text);
  if (!(MERMAID_KEYWORDS as readonly string[]).includes(keyword)) {
    collector.fail("MERMAID_INVALID", path,
      `El diagrama debe comenzar con una palabra clave admitida: ${MERMAID_KEYWORDS.join(", ")}.`);
    return false;
  }
  return true;
}

type InlineScanResult = {
  images: MaterialImage[];
  links: MaterialLink[];
};

/** Analiza el contenido en línea de una línea del cuerpo (imágenes, enlaces, HTML). */
function scanInline(
  line: string,
  lineNo: number,
  info: MaterialPathInfo | null,
  assets: Map<string, number | null>,
  hasAssetIndex: boolean,
  collector: Collector,
): InlineScanResult {
  const images: MaterialImage[] = [];
  const links: MaterialLink[] = [];
  const path = `body[${lineNo}]`;
  // El código en línea se enmascara: `<div>` dentro de backticks es texto, no HTML.
  let prose = maskInlineCode(line);

  for (const match of prose.matchAll(new RegExp(AUTOLINK_PATTERN.source, "g"))) {
    const target = checkLinkTarget(match[1], lineNo, collector, path);
    if (target !== null) links.push({ href: target, line: lineNo });
  }
  prose = maskSpans(prose, AUTOLINK_PATTERN);

  for (const match of prose.matchAll(new RegExp(IMAGE_PATTERN.source, "g"))) {
    const alt = match[1];
    const src = match[2];
    const sourceOk = checkImageSource(src, info, assets, hasAssetIndex, lineNo, collector);
    const altOk = checkAlt(alt, lineNo, collector);
    if (sourceOk && altOk) images.push({ src, alt, line: lineNo });
  }
  prose = maskSpans(prose, IMAGE_SPAN_PATTERN);

  for (const match of prose.matchAll(new RegExp(LINK_PATTERN.source, "g"))) {
    const target = checkLinkTarget(match[2], lineNo, collector, path);
    if (target !== null) links.push({ href: target, line: lineNo });
  }
  // Se enmascara sólo el destino: el texto del enlace sigue siendo prosa analizable.
  prose = maskSpans(prose, LINK_TARGET_SPAN_PATTERN);

  if (HTML_COMMENT_PATTERN.test(prose)) {
    collector.fail("UNSAFE_CONTENT", path, "El material no admite comentarios HTML.");
  } else if (HTML_TAG_PATTERN.test(prose) || EVENT_ATTRIBUTE_PATTERN.test(prose)) {
    collector.fail("UNSAFE_CONTENT", path, "El material no admite HTML ni componentes: usá Markdown.");
  }
  if (DANGEROUS_SCHEME_PATTERN.test(prose)) {
    collector.fail("UNSAFE_LINK", path, "Se detectó un esquema peligroso (javascript, data, vbscript o file).");
  }
  if (MDX_EXPRESSION_PATTERN.test(prose)) {
    collector.fail("UNSAFE_CONTENT", path, "El material no admite import ni export: no es MDX.");
  }
  if (REFERENCE_DEFINITION_PATTERN.test(prose) || REFERENCE_LINK_PATTERN.test(prose)) {
    collector.fail("UNSUPPORTED_SYNTAX", path, "Los enlaces por referencia no están admitidos: usá enlaces en línea.");
  }
  return { images, links };
}

type BodyScan = {
  blocks: MaterialBlock[];
  headings: MaterialHeading[];
  images: MaterialImage[];
  links: MaterialLink[];
  videos: ParsedYoutubeBlock[];
  stats: MaterialStats;
  orphans: string[];
};

const countWords = (line: string) => line.split(/\s+/).filter((token) => token.length > 0).length;

/** Recorre el cuerpo y produce bloques, recursos, estadísticas y observaciones. */
function scanBody(
  lines: string[],
  info: MaterialPathInfo | null,
  assets: Map<string, number | null>,
  hasAssetIndex: boolean,
  collector: Collector,
): BodyScan {
  const blocks: MaterialBlock[] = [];
  const headings: MaterialHeading[] = [];
  const images: MaterialImage[] = [];
  const links: MaterialLink[] = [];
  const videos: ParsedYoutubeBlock[] = [];
  const anchors = new Set<string>();
  const stats: MaterialStats = {
    lines: lines.length, words: 0, headings: 0, paragraphs: 0, lists: 0, blockquotes: 0,
    tables: 0, codeBlocks: 0, images: 0, videos: 0, links: 0,
  };
  let previousHeadingLevel = 1;
  let index = 0;

  const absorb = (result: InlineScanResult) => {
    images.push(...result.images);
    links.push(...result.links);
  };

  while (index < lines.length) {
    const raw = lines[index];
    const lineNo = index + 1;
    if (raw.trim().length === 0) {
      index += 1;
      continue;
    }
    const path = `body[${lineNo}]`;

    const fence = FENCE_OPEN_PATTERN.exec(raw);
    if (fence !== null) {
      const marker = fence[1];
      const language = fence[2].toLowerCase();
      const contentLines: string[] = [];
      let closed = false;
      let cursor = index + 1;
      while (cursor < lines.length) {
        const closing = FENCE_CLOSE_PATTERN.exec(lines[cursor]);
        if (closing !== null && closing[1][0] === marker[0] && closing[1].length >= marker.length) {
          closed = true;
          break;
        }
        contentLines.push(lines[cursor]);
        cursor += 1;
      }
      const content = contentLines.join("\n");
      if (!closed) collector.fail("UNCLOSED_CODE_FENCE", path, "El bloque de código no tiene cierre.");
      if (language === "mermaid") {
        checkMermaidBlock(content, lineNo, collector);
      } else if (language === "youtube") {
        const video = parseYoutubeBlockInto(content, lineNo, collector);
        if (video !== null) videos.push({ ...video, line: lineNo });
      } else if (language.length === 0) {
        collector.fail("CODE_LANGUAGE_MISSING", path,
          `Cada bloque de código declara su lenguaje: ${CODE_LANGUAGES.join(", ")}.`);
      } else if (!(CODE_LANGUAGES as readonly string[]).includes(language)) {
        collector.fail("CODE_LANGUAGE_UNSUPPORTED", path,
          `Lenguajes admitidos: ${CODE_LANGUAGES.join(", ")} y los bloques declarativos ${DECLARATIVE_FENCE_LANGUAGES.join(", ")}.`);
      } else if (contentLines.length > MAX_CODE_BLOCK_LINES) {
        collector.warn("CODE_BLOCK_LONG", path, `El bloque de código tiene ${contentLines.length} líneas.`);
      }
      stats.codeBlocks += 1;
      blocks.push({
        kind: "code", line: lineNo, endLine: closed ? cursor + 1 : lines.length,
        level: null, language: language.length > 0 ? language : null, text: "",
      });
      index = closed ? cursor + 1 : lines.length;
      continue;
    }

    stats.words += countWords(raw);

    const heading = HEADING_PATTERN.exec(raw);
    if (heading !== null) {
      const level = heading[1].length;
      const text = heading[2].trim();
      if (level === 1) {
        collector.fail("MATERIAL_H1_FORBIDDEN", path, "El cuerpo no usa «#»: el título principal proviene del frontmatter.");
      }
      if (text.length === 0) {
        collector.warn("HEADING_EMPTY", path, "El encabezado no tiene texto.");
      } else {
        const anchor = anchorIdOf(text);
        if (anchors.has(anchor)) {
          collector.warn("DUPLICATE_HEADING", path, `Dos encabezados producen la misma ancla «${anchor}».`);
        }
        anchors.add(anchor);
        if (level > previousHeadingLevel + 1) {
          collector.warn("HEADING_SKIP", path, `Salto de nivel: de h${previousHeadingLevel} a h${level}.`);
        }
        previousHeadingLevel = level;
        headings.push({ level, text, anchor, line: lineNo });
        stats.headings += 1;
      }
      absorb(scanInline(raw, lineNo, info, assets, hasAssetIndex, collector));
      blocks.push({ kind: "heading", line: lineNo, endLine: lineNo, level, language: null, text: text.slice(0, 80) });
      index += 1;
      continue;
    }

    if (THEMATIC_BREAK_PATTERN.test(raw)) {
      blocks.push({ kind: "thematic-break", line: lineNo, endLine: lineNo, level: null, language: null, text: "" });
      index += 1;
      continue;
    }

    if (SETEXT_UNDERLINE_PATTERN.test(raw)) {
      collector.fail("UNSUPPORTED_SYNTAX", path, "Los encabezados con subrayado «===» no están admitidos: usá «##».");
      index += 1;
      continue;
    }

    if (TABLE_ROW_PATTERN.test(raw)) {
      const rows: string[] = [raw];
      let cursor = index + 1;
      while (cursor < lines.length && TABLE_ROW_PATTERN.test(lines[cursor])) {
        rows.push(lines[cursor]);
        stats.words += countWords(lines[cursor]);
        cursor += 1;
      }
      if (rows.length < 2 || !TABLE_DELIMITER_PATTERN.test(rows[1])) {
        collector.warn("TABLE_WITHOUT_HEADER", path, "La tabla no tiene fila separadora de encabezado («|---|---|»).");
      }
      rows.forEach((row, offset) => absorb(scanInline(row, lineNo + offset, info, assets, hasAssetIndex, collector)));
      stats.tables += 1;
      blocks.push({ kind: "table", line: lineNo, endLine: cursor, level: null, language: null, text: raw.trim().slice(0, 80) });
      index = cursor;
      continue;
    }

    if (BLOCKQUOTE_PATTERN.test(raw)) {
      absorb(scanInline(raw, lineNo, info, assets, hasAssetIndex, collector));
      let cursor = index + 1;
      while (cursor < lines.length && BLOCKQUOTE_PATTERN.test(lines[cursor])) {
        stats.words += countWords(lines[cursor]);
        absorb(scanInline(lines[cursor], cursor + 1, info, assets, hasAssetIndex, collector));
        cursor += 1;
      }
      stats.blockquotes += 1;
      blocks.push({ kind: "blockquote", line: lineNo, endLine: cursor, level: null, language: null, text: raw.trim().slice(0, 80) });
      index = cursor;
      continue;
    }

    if (LIST_ITEM_PATTERN.test(raw)) {
      absorb(scanInline(raw, lineNo, info, assets, hasAssetIndex, collector));
      let cursor = index + 1;
      while (cursor < lines.length) {
        const candidate = lines[cursor];
        const continuation = candidate.trim().length > 0 && /^ {1,}/.test(candidate) && !LIST_ITEM_PATTERN.test(candidate);
        if (!LIST_ITEM_PATTERN.test(candidate) && !continuation) break;
        stats.words += countWords(candidate);
        absorb(scanInline(candidate, cursor + 1, info, assets, hasAssetIndex, collector));
        cursor += 1;
      }
      stats.lists += 1;
      blocks.push({ kind: "list", line: lineNo, endLine: cursor, level: null, language: null, text: raw.trim().slice(0, 80) });
      index = cursor;
      continue;
    }

    const isBlockStart = (candidate: string) =>
      candidate.trim().length === 0 || FENCE_OPEN_PATTERN.test(candidate) || HEADING_PATTERN.test(candidate)
      || THEMATIC_BREAK_PATTERN.test(candidate) || SETEXT_UNDERLINE_PATTERN.test(candidate)
      || TABLE_ROW_PATTERN.test(candidate) || BLOCKQUOTE_PATTERN.test(candidate) || LIST_ITEM_PATTERN.test(candidate);

    absorb(scanInline(raw, lineNo, info, assets, hasAssetIndex, collector));
    let cursor = index + 1;
    while (cursor < lines.length && !isBlockStart(lines[cursor])) {
      stats.words += countWords(lines[cursor]);
      absorb(scanInline(lines[cursor], cursor + 1, info, assets, hasAssetIndex, collector));
      cursor += 1;
    }
    stats.paragraphs += 1;
    blocks.push({ kind: "paragraph", line: lineNo, endLine: cursor, level: null, language: null, text: raw.trim().slice(0, 80) });
    index = cursor;
  }

  stats.images = images.length;
  stats.videos = videos.length;
  stats.links = links.length;

  const firstMeaningful = blocks.find((block) => block.kind !== "thematic-break");
  if (firstMeaningful !== undefined && firstMeaningful.kind !== "paragraph") {
    collector.warn("MATERIAL_NO_INTRO", `body[${firstMeaningful.line}]`,
      "El material comienza sin un párrafo introductorio.");
  }
  if (stats.words > MAX_MATERIAL_WORDS || stats.lines > MAX_MATERIAL_LINES) {
    collector.warn("MATERIAL_TOO_LONG", "body",
      `El material reúne ${stats.words} palabras en ${stats.lines} líneas: conviene dividirlo en más de un material.`);
  }
  if (stats.images > MAX_IMAGES || stats.videos > MAX_VIDEOS) {
    collector.warn("MANY_RESOURCES", "body",
      `El material reúne ${stats.images} imágenes y ${stats.videos} videos: conviene revisar si aportan al recorrido.`);
  }

  const orphans: string[] = [];
  if (hasAssetIndex && info !== null) {
    const prefix = materialAssetPrefix(info);
    const referenced = new Set(images.map((image) => image.src));
    for (const assetPath of assetsUnderPrefix(assets, prefix)) {
      if (referenced.has(assetPath)) continue;
      orphans.push(assetPath);
      collector.warn("IMAGE_ORPHAN", `assets["${assetPath}"]`,
        "El archivo vive en la carpeta del material pero no se referencia desde el Markdown.");
    }
  }

  return { blocks, headings, images, links, videos, stats, orphans };
}

// ---- Cruce path ↔ frontmatter ------------------------------------------------
function validatePathContext(
  contentPath: string,
  header: MaterialHeader,
  collector: Collector,
): MaterialPathInfo | null {
  const info = parseContentPath(contentPath);
  if (info === null) {
    collector.fail("CONTENT_PATH_INVALID", "path",
      "Se esperaba una ruta con la forma «content/<asignatura>/<unidad>/<slug>.md».");
    return null;
  }
  if (info.unitCode !== header.unitCode) {
    collector.fail("UNIT_MISMATCH", "frontmatter.unitCode",
      `La carpeta declara «${info.unitCode}» y el frontmatter declara «${header.unitCode}».`);
  }
  if (info.slug !== header.slug) {
    collector.fail("SLUG_MISMATCH", "frontmatter.slug",
      `El archivo se llama «${info.slug}.md» y el frontmatter declara «${header.slug}».`);
  }
  return info;
}

// ---- Consistencia dentro de una unidad ---------------------------------------
export type MaterialUnitEntry = {
  slug: string;
  unitCode: string;
  unitTitle: string | null;
};

/**
 * `unitTitle` es opcional, pero si existe debe ser idéntico en todos los
 * materiales de la misma unidad. El cruce es puro: quien llama aporta la lista.
 */
export function checkUnitConsistency(entries: readonly MaterialUnitEntry[], scope = "unit"): MaterialIssue[] {
  const issues: MaterialIssue[] = [];
  const byUnit = new Map<string, { slug: string; unitTitle: string }>();
  for (const entry of entries) {
    if (typeof entry?.unitTitle !== "string" || entry.unitTitle.length === 0) continue;
    const current = byUnit.get(entry.unitCode);
    if (current === undefined) {
      byUnit.set(entry.unitCode, { slug: entry.slug, unitTitle: entry.unitTitle });
      continue;
    }
    if (current.unitTitle !== entry.unitTitle) {
      issues.push({
        severity: "error",
        code: "UNIT_TITLE_MISMATCH",
        path: `${scope}.${entry.unitCode}`,
        message: `«${current.slug}» usa el título de unidad «${current.unitTitle}» y «${entry.slug}» usa «${entry.unitTitle}».`,
      });
    }
  }
  return issues;
}

// ---- Entrada pública del módulo ----------------------------------------------
export function parseMaterialDocument(
  source: unknown,
  context: MaterialParseContext = {},
): MaterialParseResult {
  const collector = createCollector();
  const build = (parsed: ParsedMaterialDocument | null, kind: MaterialDocumentKind): MaterialParseResult => {
    const issues = collector.issues;
    const errors = issues.filter((issue) => issue.severity === "error");
    return {
      ok: parsed !== null && errors.length === 0,
      kind,
      issues,
      errors,
      warnings: issues.filter((issue) => issue.severity === "warning"),
      notes: issues.filter((issue) => issue.severity === "note"),
      parsed: errors.length > 0 ? null : parsed,
    };
  };

  if (typeof source !== "string") {
    collector.fail("MATERIAL_SCHEMA", "", "Se esperaba el texto del material.");
    return build(null, "unknown");
  }

  const text = stripBom(source);
  const kind = detectMaterialDocumentKind(text);

  if (typeof context.bytes === "number" && context.bytes > MAX_MATERIAL_BYTES) {
    collector.fail("MATERIAL_TOO_LARGE", "",
      `El archivo supera ${Math.round(MAX_MATERIAL_BYTES / 1024)} KiB: conviene dividirlo en varios materiales.`);
  }

  const lines = splitLines(text);
  const frontmatter = parseFrontmatter(lines, collector);
  const header = parseHeader(frontmatter.values, collector);
  if (header === null) return build(null, kind);

  const declaredContentPath = typeof context.contentPath === "string" && context.contentPath.length > 0
    ? context.contentPath
    : null;
  const info = declaredContentPath === null ? null : validatePathContext(declaredContentPath, header, collector);

  const hasAssetIndex = Array.isArray(context.assets);
  if (!hasAssetIndex) {
    collector.note("ASSETS_INDEX_UNAVAILABLE", "assets",
      "No se recibió un índice de assets: no se comprobó la existencia de las imágenes.");
  }
  const assets = buildAssetIndex(context.assets);
  const bodyLines = lines.slice(frontmatter.bodyStartLine);
  const scan = scanBody(bodyLines, info, assets, hasAssetIndex, collector);

  const parsed: ParsedMaterialDocument = {
    schemaVersion: header.schemaVersion,
    header,
    subjectCode: info === null ? null : info.subjectCode,
    contentPath: declaredContentPath,
    body: bodyLines.join("\n"),
    blocks: scan.blocks,
    headings: scan.headings,
    images: scan.images,
    links: scan.links,
    videos: scan.videos,
    stats: scan.stats,
    orphanImages: scan.orphans,
    hasAssetIndex,
  };
  return build(parsed, kind);
}
