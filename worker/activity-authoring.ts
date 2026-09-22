// Lenguaje de autoría de actividades (JSON canónico v1) para Profe Macón 2.0.
//
// Módulo PURO: no accede a D1, no usa `env`, no lee ni escribe archivos y no se
// importa desde `worker/index.ts`, por lo que no forma parte del bundle del
// Worker. Responsabilidades exclusivas:
//
//   1. validar y normalizar el documento canónico (estricto, sin claves extra);
//   2. traducir el `grading` canónico a la clave privada que exige el corrector;
//   3. materializar las filas de `actividades` y `preguntas_actividad`;
//   4. producir la proyección pública (sin grading) y verificarla;
//   5. auto-probar la corrección con el corrector real (`activity-grading.ts`).
//
// El JSON es un lenguaje de autoría: no es un reflejo del esquema SQL. Todo lo
// que no tenga destino real en D1 se rechaza o queda como metadata del pipeline.

import { gradeActivity, publicCorrectAnswerForReview, type ActivityQuestionForGrading } from "./activity-grading.ts";

export const AUTHORING_SCHEMA_VERSION = 1;
export const MAX_DOCUMENT_BYTES = 512 * 1024;

const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Las etiquetas son metadata del pipeline: se admite cualquier letra minúscula,
// incluidas las acentuadas, pero se conserva la convención sin espacios.
const TAG_PATTERN = /^[\p{Ll}\p{N}]+(?:-[\p{Ll}\p{N}]+)*$/u;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/;
const CODE_LANGUAGES = ["java", "javascript", "typescript", "sql", "bash", "json", "text"] as const;

export type AuthoringSeverity = "error" | "warning" | "note";

export type AuthoringIssue = {
  severity: AuthoringSeverity;
  code: string;
  path: string;
  message: string;
};

export type QuestionType = "radio" | "checkbox" | "text";
export type EditorialState = "borrador" | "activa" | "archivada";

export type MaterializedActivity = {
  slug: string;
  titulo: string;
  descripcion: string;
  tema: string;
  unidadCodigo: string;
  orden: number;
  estado: EditorialState;
  puntajeTotal: number;
  maximoIntentos: number;
  umbralAprobacion: number;
  umbralDestacado: number;
  mostrarRevision: number;
};

export type MaterializedQuestion = {
  numero: number;
  tipo: QuestionType;
  enunciado: string;
  instrucciones: string;
  opcionesJson: string;
  recursosJson: string;
  placeholder: string | null;
  puntaje: number;
  claveCorreccionJson: string;
  retroalimentacionCorrecta: string;
  retroalimentacionIncorrecta: string;
  explicacionRevisionFinal: string | null;
};

export type AuthoringMetadata = {
  tags: string[];
  createdBy: string;
  version: number;
  notes: string | null;
  generatedAt: string | null;
};

export type PublicActivityDocument = {
  schemaVersion: number;
  activity: {
    slug: string;
    title: string;
    description: string;
    topic: string;
    unitCode: string;
    order: number;
    edition: { subjectCode: string; year: number };
    maxAttempts: number;
    showReview: boolean;
    approvalThreshold: number;
    achievementThreshold: number;
    editorialState: "draft" | "active" | "archived";
  };
  questions: Array<Record<string, unknown>>;
  tags: string[];
  authoring: { createdBy: string; version: number; notes?: string; generatedAt?: string };
};

export type ParsedActivityDocument = {
  schemaVersion: number;
  edition: { subjectCode: string; year: number };
  activity: MaterializedActivity;
  questions: MaterializedQuestion[];
  metadata: AuthoringMetadata;
  publicDocument: PublicActivityDocument;
  totalPoints: number;
};

export type ParseResult = {
  ok: boolean;
  issues: AuthoringIssue[];
  errors: AuthoringIssue[];
  warnings: AuthoringIssue[];
  notes: AuthoringIssue[];
  parsed: ParsedActivityDocument | null;
};

// Claves que nunca pueden aparecer en un documento público o en la proyección.
export const PRIVATE_KEY_NAMES = [
  "grading",
  "mode",
  "correct",
  "accepted",
  "correctas",
  "aceptadas",
  "clave_correccion_json",
  "clave_correccion_snapshot_json",
  "claveCorreccionJson",
  "claveCorreccionSnapshotJson",
  "correctAnswer",
  "respuesta_correcta",
  "respuestaCorrecta",
] as const;

const EDITORIAL_STATE_TO_D1: Record<string, EditorialState> = {
  draft: "borrador",
  active: "activa",
  archived: "archivada",
};

const EDITORIAL_STATE_TO_PUBLIC: Record<EditorialState, "draft" | "active" | "archived"> = {
  borrador: "draft",
  activa: "active",
  archivada: "archived",
};

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Collector = {
  issues: AuthoringIssue[];
  fail(code: string, path: string, message: string): void;
  warn(code: string, path: string, message: string): void;
  note(code: string, path: string, message: string): void;
};

function createCollector(): Collector {
  const issues: AuthoringIssue[] = [];
  const add = (severity: AuthoringSeverity) => (code: string, path: string, message: string) => {
    issues.push({ severity, code, path, message });
  };
  return { issues, fail: add("error"), warn: add("warning"), note: add("note") };
}

function checkUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, collector: Collector) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      const childPath = path ? `${path}.${key}` : key;
      collector.fail("UNKNOWN_KEY", childPath, `La clave «${key}» no forma parte del contrato v1.`);
    }
  }
}

function readObject(value: unknown, path: string, collector: Collector): Record<string, unknown> | null {
  if (value === undefined) {
    collector.fail("MISSING_FIELD", path, "Falta un campo obligatorio.");
    return null;
  }
  if (!isPlainObject(value)) {
    collector.fail("INVALID_TYPE", path, "Se esperaba un objeto.");
    return null;
  }
  return value;
}

type StringOptions = { minLength: number; maxLength: number; pattern?: RegExp; patternMessage?: string; code?: string };

function readString(value: unknown, path: string, options: StringOptions, collector: Collector): string | null {
  if (value === undefined) {
    collector.fail("MISSING_FIELD", path, "Falta un campo obligatorio.");
    return null;
  }
  if (typeof value !== "string") {
    collector.fail(options.code ?? "INVALID_TYPE", path, "Se esperaba un texto.");
    return null;
  }
  if (value.length < options.minLength || value.length > options.maxLength) {
    collector.fail(options.code ?? "INVALID_LENGTH", path, `Debe tener entre ${options.minLength} y ${options.maxLength} caracteres.`);
    return null;
  }
  if (options.pattern && !options.pattern.test(value)) {
    collector.fail(options.code ?? "INVALID_FORMAT", path, options.patternMessage ?? "El formato no es válido.");
    return null;
  }
  return value;
}

function readOptionalString(value: unknown, path: string, options: StringOptions, collector: Collector): string | null {
  if (value === undefined || value === null) return null;
  return readString(value, path, options, collector);
}

type IntegerOptions = { min: number; max: number; code?: string };

function readInteger(value: unknown, path: string, options: IntegerOptions, collector: Collector): number | null {
  if (value === undefined) {
    collector.fail("MISSING_FIELD", path, "Falta un campo obligatorio.");
    return null;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    collector.fail(options.code ?? "INVALID_TYPE", path, "Se esperaba un número entero.");
    return null;
  }
  if (value < options.min || value > options.max) {
    collector.fail(options.code ?? "INVALID_RANGE", path, `Debe estar entre ${options.min} y ${options.max}.`);
    return null;
  }
  return value;
}

function readOptionalInteger(
  value: unknown,
  path: string,
  options: IntegerOptions,
  collector: Collector,
  fallback: number,
): number {
  if (value === undefined || value === null) return fallback;
  return readInteger(value, path, options, collector) ?? fallback;
}

function readOptionalBoolean(value: unknown, path: string, collector: Collector, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") {
    collector.fail("INVALID_TYPE", path, "Se esperaba verdadero o falso.");
    return fallback;
  }
  return value;
}

function isTrimmedUniqueNonEmpty(value: unknown, maxLength: number) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && value === value.trim();
}

type ParsedOption = { value: string; text: string };

type ParsedGrading =
  | { kind: "radio"; correct: string }
  | { kind: "checkbox"; correct: string[] }
  | { kind: "text"; accepted: string[] };

type ParsedQuestion = {
  numero: number;
  tipo: QuestionType;
  prompt: string;
  instructions: string;
  points: number;
  options: ParsedOption[];
  placeholder: string | null;
  grading: ParsedGrading;
  explanation: string | null;
  feedback: { correct: string; incorrect: string };
  resources: Array<Record<string, unknown>>;
};

type ParsedActivity = {
  slug: string;
  title: string;
  description: string;
  topic: string;
  unitCode: string;
  order: number;
  edition: { subjectCode: string; year: number };
  maxAttempts: number;
  showReview: boolean;
  approvalThreshold: number;
  achievementThreshold: number;
  estado: EditorialState;
};

const ACTIVITY_KEYS = [
  "slug", "title", "description", "topic", "unitCode", "order", "edition",
  "maxAttempts", "showReview", "approvalThreshold", "achievementThreshold", "editorialState",
] as const;

const QUESTION_KEYS = [
  "number", "type", "prompt", "instructions", "points", "options",
  "placeholder", "grading", "explanation", "feedback", "resources",
] as const;

function parseEdition(value: unknown, path: string, collector: Collector): { subjectCode: string; year: number } | null {
  const edition = readObject(value, path, collector);
  if (!edition) return null;
  checkUnknownKeys(edition, ["subjectCode", "year"], path, collector);
  const subjectCode = readString(edition.subjectCode, `${path}.subjectCode`, {
    minLength: 1, maxLength: 64, pattern: IDENTIFIER_PATTERN, patternMessage: "Usá minúsculas, números y guiones.",
  }, collector);
  const year = readInteger(edition.year, `${path}.year`, { min: 2020, max: 2100, code: "INVALID_YEAR" }, collector);
  if (!subjectCode || year === null) return null;
  return { subjectCode, year };
}

function parseActivity(value: unknown, collector: Collector): ParsedActivity | null {
  const activity = readObject(value, "activity", collector);
  if (!activity) return null;
  checkUnknownKeys(activity, ACTIVITY_KEYS, "activity", collector);

  const slug = readString(activity.slug, "activity.slug", {
    minLength: 3, maxLength: 80, pattern: IDENTIFIER_PATTERN, patternMessage: "Usá minúsculas, números y guiones.", code: "INVALID_SLUG",
  }, collector);
  const title = readString(activity.title, "activity.title", { minLength: 1, maxLength: 200 }, collector);
  const description = readOptionalString(activity.description, "activity.description", { minLength: 0, maxLength: 1000 }, collector) ?? "";
  const topicInput = readOptionalString(activity.topic, "activity.topic", { minLength: 1, maxLength: 200 }, collector);
  const unitCode = readString(activity.unitCode, "activity.unitCode", {
    minLength: 1, maxLength: 40, pattern: IDENTIFIER_PATTERN, patternMessage: "Usá minúsculas, números y guiones.", code: "INVALID_UNIT_CODE",
  }, collector);
  const order = readInteger(activity.order, "activity.order", { min: 1, max: 999, code: "INVALID_ORDER" }, collector);
  const edition = parseEdition(activity.edition, "activity.edition", collector);
  const maxAttempts = readOptionalInteger(activity.maxAttempts, "activity.maxAttempts", { min: 1, max: 10, code: "INVALID_MAX_ATTEMPTS" }, collector, 1);
  const showReview = readOptionalBoolean(activity.showReview, "activity.showReview", collector, true);
  const approvalThreshold = readOptionalInteger(activity.approvalThreshold, "activity.approvalThreshold", { min: 0, max: 100, code: "INVALID_THRESHOLDS" }, collector, 50);
  const achievementThreshold = readOptionalInteger(activity.achievementThreshold, "activity.achievementThreshold", { min: 0, max: 100, code: "INVALID_THRESHOLDS" }, collector, 76);

  let estado: EditorialState = "borrador";
  if (activity.editorialState !== undefined && activity.editorialState !== null) {
    if (typeof activity.editorialState !== "string" || !(activity.editorialState in EDITORIAL_STATE_TO_D1)) {
      collector.fail("INVALID_EDITORIAL_STATE", "activity.editorialState", "Valores admitidos: draft, active, archived.");
    } else {
      estado = EDITORIAL_STATE_TO_D1[activity.editorialState];
    }
  }

  if (approvalThreshold > achievementThreshold) {
    collector.fail("INVALID_THRESHOLDS", "activity.achievementThreshold", "El umbral de logro no puede ser menor que el de aprobación.");
  }
  if (maxAttempts > 5) {
    collector.warn("HIGH_MAX_ATTEMPTS", "activity.maxAttempts", "Más de 5 intentos es inusual.");
  }
  if (approvalThreshold === 0 || approvalThreshold === 100) {
    collector.warn("THRESHOLD_EDGE", "activity.approvalThreshold", "Un umbral de aprobación en 0 o 100 no discrimina.");
  } else if (achievementThreshold === approvalThreshold) {
    collector.warn("THRESHOLD_EDGE", "activity.achievementThreshold", "Con umbrales iguales nunca se alcanza «en proceso».");
  }

  if (!slug || !title || !unitCode || order === null || !edition) return null;
  return {
    slug, title, description, topic: topicInput ?? title, unitCode, order, edition,
    maxAttempts, showReview, approvalThreshold, achievementThreshold, estado,
  };
}

function parseOptions(value: unknown, required: boolean, numero: number, collector: Collector): ParsedOption[] {
  const path = `questions[${numero - 1}].options`;
  if (value === undefined || value === null) {
    if (required) collector.fail("OPTIONS_REQUIRED", path, `La pregunta ${numero} necesita opciones.`);
    return [];
  }
  if (!required) collector.fail("OPTIONS_NOT_ALLOWED", path, `La pregunta ${numero} es de texto y no admite opciones.`);
  if (!Array.isArray(value)) {
    collector.fail("INVALID_TYPE", path, "Se esperaba una lista de opciones.");
    return [];
  }
  if (value.length < 2) collector.fail("TOO_FEW_OPTIONS", path, `La pregunta ${numero} necesita al menos 2 opciones.`);
  if (value.length > 12) collector.fail("TOO_MANY_OPTIONS", path, `La pregunta ${numero} admite hasta 12 opciones.`);

  const parsed: ParsedOption[] = [];
  const seenValues = new Set<string>();
  const seenTexts = new Set<string>();
  value.forEach((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const item = readObject(entry, itemPath, collector);
    if (!item) return;
    checkUnknownKeys(item, ["value", "text"], itemPath, collector);
    const optionValue = readString(item.value, `${itemPath}.value`, { minLength: 1, maxLength: 64 }, collector);
    const text = readString(item.text, `${itemPath}.text`, { minLength: 1, maxLength: 300 }, collector);
    if (optionValue !== null) {
      if (optionValue !== optionValue.trim()) {
        collector.fail("INVALID_OPTION_VALUE", `${itemPath}.value`, "El valor no puede tener espacios al inicio ni al final.");
      }
      if (seenValues.has(optionValue)) collector.fail("DUPLICATE_OPTION_VALUE", `${itemPath}.value`, "El valor de opción está repetido.");
      seenValues.add(optionValue);
    }
    if (text !== null) {
      if (seenTexts.has(text)) collector.warn("DUPLICATE_OPTION_TEXT", `${itemPath}.text`, "Hay dos opciones con el mismo texto.");
      seenTexts.add(text);
      if (text.length > 200) collector.warn("LONG_OPTION_TEXT", `${itemPath}.text`, "El texto de opción es muy extenso.");
    }
    if (optionValue !== null && text !== null) parsed.push({ value: optionValue, text });
  });

  if (value.length === 2) collector.warn("CHOICE_FEW_OPTIONS", path, "Dos opciones discriminan poco.");
  if (value.length > 6) collector.warn("MANY_OPTIONS", path, "Más de 6 opciones dificultan la lectura.");
  return parsed;
}

function parseGrading(value: unknown, tipo: QuestionType, options: ParsedOption[], numero: number, collector: Collector): ParsedGrading | null {
  const path = `questions[${numero - 1}].grading`;
  if (value === undefined || value === null) {
    collector.fail("GRADING_REQUIRED", path, `La pregunta ${numero} necesita una clave de corrección.`);
    return null;
  }
  const grading = readObject(value, path, collector);
  if (!grading) return null;
  const values = options.map((option) => option.value);

  if (tipo === "radio" || tipo === "checkbox") {
    const expectedMode = tipo === "radio" ? "single" : "exact-selection";
    checkUnknownKeys(grading, ["mode", "correct"], path, collector);
    if (grading.mode !== expectedMode) {
      collector.fail("GRADING_MODE_MISMATCH", `${path}.mode`, `Para ${tipo} el modo debe ser «${expectedMode}».`);
      return null;
    }
    if (tipo === "radio") {
      if (!isTrimmedUniqueNonEmpty(grading.correct, 64) || !values.includes(grading.correct as string)) {
        collector.fail("RADIO_CORRECT_NOT_FOUND", `${path}.correct`, `La opción correcta de la pregunta ${numero} no existe entre sus opciones.`);
        return null;
      }
      return { kind: "radio", correct: grading.correct as string };
    }
    if (!Array.isArray(grading.correct)) {
      collector.fail("INVALID_TYPE", `${path}.correct`, "Se esperaba una lista de opciones correctas.");
      return null;
    }
    if (grading.correct.length === 0) {
      collector.fail("CHECKBOX_NO_CORRECT", `${path}.correct`, `La pregunta ${numero} no tiene ninguna opción correcta.`);
      return null;
    }
    const correct = grading.correct as unknown[];
    if (!correct.every((item) => isTrimmedUniqueNonEmpty(item, 64))) {
      collector.fail("CHECKBOX_CORRECT_INVALID", `${path}.correct`, "Cada opción correcta debe ser un texto no vacío y sin espacios exteriores.");
      return null;
    }
    if (new Set(correct as string[]).size !== correct.length) {
      collector.fail("CHECKBOX_DUPLICATE_CORRECT", `${path}.correct`, "Hay opciones correctas repetidas.");
      return null;
    }
    if ((correct as string[]).some((item) => !values.includes(item))) {
      collector.fail("CHECKBOX_CORRECT_NOT_FOUND", `${path}.correct`, `La pregunta ${numero} marca como correcta alguna opción que no existe.`);
      return null;
    }
    if (options.length > 0 && correct.length === options.length) {
      collector.warn("CHECKBOX_ALL_CORRECT", `${path}.correct`, "Todas las opciones son correctas: no discrimina.");
    }
    return { kind: "checkbox", correct: [...(correct as string[])].sort() };
  }

  checkUnknownKeys(grading, ["mode", "accepted", "trim", "caseSensitive"], path, collector);
  if (grading.mode !== "accepted-text") {
    collector.fail("GRADING_MODE_MISMATCH", `${path}.mode`, "Para text el modo debe ser «accepted-text».");
    return null;
  }
  if (grading.trim !== undefined && grading.trim !== true) {
    collector.fail("GRADING_FLAG_UNSUPPORTED", `${path}.trim`, "El corrector actual siempre recorta: sólo se admite true o la ausencia del campo.");
  }
  if (grading.caseSensitive !== undefined && grading.caseSensitive !== true) {
    collector.fail("GRADING_FLAG_UNSUPPORTED", `${path}.caseSensitive`, "El corrector actual distingue mayúsculas: sólo se admite true o la ausencia del campo.");
  }
  if (!Array.isArray(grading.accepted)) {
    collector.fail(grading.accepted === undefined ? "TEXT_NO_ACCEPTED" : "INVALID_TYPE", `${path}.accepted`, `La pregunta ${numero} necesita variantes aceptadas.`);
    return null;
  }
  const accepted = grading.accepted as unknown[];
  if (accepted.length === 0) {
    collector.fail("TEXT_NO_ACCEPTED", `${path}.accepted`, `La pregunta ${numero} no tiene variantes aceptadas.`);
    return null;
  }
  if (accepted.length > 20) {
    collector.fail("TEXT_ACCEPTED_TOO_MANY", `${path}.accepted`, "Se admiten hasta 20 variantes aceptadas.");
    return null;
  }
  if (!accepted.every((item) => isTrimmedUniqueNonEmpty(item, 200))) {
    collector.fail("TEXT_ACCEPTED_INVALID", `${path}.accepted`, "Cada variante debe ser un texto no vacío, sin espacios exteriores y de hasta 200 caracteres.");
    return null;
  }
  if (new Set(accepted as string[]).size !== accepted.length) {
    collector.fail("TEXT_DUPLICATE_ACCEPTED", `${path}.accepted`, "Hay variantes aceptadas repetidas.");
    return null;
  }
  if (accepted.length > 3) {
    collector.warn("TEXT_MANY_ACCEPTED", `${path}.accepted`, "La revisión final mostraría todas las variantes aceptadas.");
  }
  return { kind: "text", accepted: [...(accepted as string[])] };
}

function parseResources(value: unknown, numero: number, collector: Collector): Array<Record<string, unknown>> {
  const path = `questions[${numero - 1}].resources`;
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    collector.fail("RESOURCE_INVALID", path, "Se esperaba una lista de recursos.");
    return [];
  }
  if (value.length === 0) return [];
  if (value.length > 5) {
    collector.fail("RESOURCE_INVALID", path, `La pregunta ${numero} admite hasta 5 recursos.`);
  }
  const parsed: Array<Record<string, unknown>> = [];
  value.forEach((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const item = readObject(entry, itemPath, collector);
    if (!item) return;
    if (item.type === "image") {
      checkUnknownKeys(item, ["type", "src", "alt", "caption"], itemPath, collector);
      const src = readString(item.src, `${itemPath}.src`, { minLength: 1, maxLength: 300 }, collector);
      if (src !== null && (!src.startsWith("/") || src.startsWith("//") || src.includes(".."))) {
        collector.fail("RESOURCE_INVALID", `${itemPath}.src`, "La imagen debe usar una ruta interna del sitio que empiece con «/».");
      }
      const alt = readString(item.alt, `${itemPath}.alt`, { minLength: 1, maxLength: 300 }, collector);
      if (alt !== null && alt.length < 15) {
        collector.warn("IMAGE_ALT_WEAK", `${itemPath}.alt`, "El texto alternativo es demasiado breve para ser útil.");
      }
      const caption = readOptionalString(item.caption, `${itemPath}.caption`, { minLength: 1, maxLength: 300 }, collector);
      parsed.push({ type: "image", src, alt, ...(caption === null ? {} : { caption }) });
      return;
    }
    if (item.type === "code") {
      checkUnknownKeys(item, ["type", "language", "content", "title"], itemPath, collector);
      const language = readString(item.language, `${itemPath}.language`, { minLength: 1, maxLength: 30 }, collector);
      if (language !== null && !(CODE_LANGUAGES as readonly string[]).includes(language)) {
        collector.fail("RESOURCE_INVALID", `${itemPath}.language`, `Lenguajes admitidos: ${CODE_LANGUAGES.join(", ")}.`);
      }
      const content = readString(item.content, `${itemPath}.content`, { minLength: 1, maxLength: 5000 }, collector);
      const title = readOptionalString(item.title, `${itemPath}.title`, { minLength: 1, maxLength: 200 }, collector);
      parsed.push({ type: "code", language, content, ...(title === null ? {} : { title }) });
      return;
    }
    collector.fail("RESOURCE_INVALID", `${itemPath}.type`, "Tipos de recurso admitidos: image, code.");
  });
  return parsed;
}

function parseQuestion(entry: unknown, index: number, collector: Collector, seenNumbers: Set<number>): ParsedQuestion | null {
  const path = `questions[${index}]`;
  const question = readObject(entry, path, collector);
  if (!question) return null;
  checkUnknownKeys(question, QUESTION_KEYS, path, collector);

  const numero = readInteger(question.number, `${path}.number`, { min: 1, max: 999 }, collector);
  if (numero === null) return null;
  if (numero !== index + 1) {
    collector.fail("QUESTION_ORDER", `${path}.number`, `Se esperaba ${index + 1}: las preguntas se numeran 1..N sin huecos.`);
  }
  if (seenNumbers.has(numero)) {
    collector.fail("DUPLICATE_QUESTION_NUMBER", `${path}.number`, `El número ${numero} está repetido.`);
  }
  seenNumbers.add(numero);

  if (question.type !== "radio" && question.type !== "checkbox" && question.type !== "text") {
    collector.fail("UNSUPPORTED_TYPE", `${path}.type`, "Tipos admitidos en v1: radio, checkbox, text.");
    return null;
  }
  const tipo: QuestionType = question.type;

  const prompt = readString(question.prompt, `${path}.prompt`, { minLength: 1, maxLength: 1000 }, collector);
  if (prompt !== null && prompt.length > 600) {
    collector.warn("LONG_PROMPT", `${path}.prompt`, "El enunciado es muy extenso para una única pantalla.");
  }
  const instructions = readOptionalString(question.instructions, `${path}.instructions`, { minLength: 0, maxLength: 1000 }, collector) ?? "";
  const points = readInteger(question.points, `${path}.points`, { min: 1, max: 100, code: "INVALID_POINTS" }, collector);
  const options = parseOptions(question.options, tipo !== "text", numero, collector);

  let placeholder: string | null = null;
  if (tipo === "text") {
    placeholder = readOptionalString(question.placeholder, `${path}.placeholder`, { minLength: 1, maxLength: 200 }, collector);
  } else if (question.placeholder !== undefined && question.placeholder !== null) {
    collector.fail("PLACEHOLDER_NOT_ALLOWED", `${path}.placeholder`, `La pregunta ${numero} no es de texto y no admite marcador.`);
  }

  const grading = parseGrading(question.grading, tipo, options, numero, collector);
  const explanation = readOptionalString(question.explanation, `${path}.explanation`, { minLength: 1, maxLength: 2000 }, collector);
  if (question.explanation === undefined || question.explanation === null) {
    collector.warn("EXPLANATION_MISSING", `${path}.explanation`, `La pregunta ${numero} no tiene explicación de revisión final.`);
  }

  let feedback = { correct: "", incorrect: "" };
  if (question.feedback !== undefined && question.feedback !== null) {
    const raw = readObject(question.feedback, `${path}.feedback`, collector);
    if (raw) {
      checkUnknownKeys(raw, ["whenCorrect", "whenIncorrect"], `${path}.feedback`, collector);
      feedback = {
        correct: readOptionalString(raw.whenCorrect, `${path}.feedback.whenCorrect`, { minLength: 1, maxLength: 1000 }, collector) ?? "",
        incorrect: readOptionalString(raw.whenIncorrect, `${path}.feedback.whenIncorrect`, { minLength: 1, maxLength: 1000 }, collector) ?? "",
      };
    }
  }

  const resources = parseResources(question.resources, numero, collector);
  if (!prompt || points === null || !grading) return null;
  return { numero, tipo, prompt, instructions, points, options, placeholder, grading, explanation, feedback, resources };
}

// ---- Traducción a la clave privada real del corrector ------------------------
// El corrector exige { modo, correctas? , aceptadas? } con textos no vacíos y ya
// recortados. Nada de esto debe salir del módulo ni imprimirse nunca.
function privateGradingKey(question: ParsedQuestion): string {
  if (question.grading.kind === "radio") {
    return JSON.stringify({ modo: "opcion", correctas: [question.grading.correct] });
  }
  if (question.grading.kind === "checkbox") {
    return JSON.stringify({ modo: "seleccion-exacta", correctas: [...question.grading.correct] });
  }
  return JSON.stringify({ modo: "texto-exacto", aceptadas: [...question.grading.accepted] });
}

function selfCheckAnswer(question: ParsedQuestion): unknown {
  if (question.grading.kind === "radio") return question.grading.correct;
  if (question.grading.kind === "checkbox") return [...question.grading.correct];
  return question.grading.accepted[0];
}

function toMaterializedQuestion(question: ParsedQuestion): MaterializedQuestion {
  return {
    numero: question.numero,
    tipo: question.tipo,
    enunciado: question.prompt,
    instrucciones: question.instructions,
    opcionesJson: JSON.stringify(question.options.map((option) => ({ valor: option.value, texto: option.text }))),
    recursosJson: JSON.stringify(question.resources),
    placeholder: question.placeholder,
    puntaje: question.points,
    claveCorreccionJson: privateGradingKey(question),
    // El feedback se persiste, pero hoy NO participa de la corrección estudiantil:
    // `loadSnapshotForSubmit` fuerza el feedback vacío y `submit` guarda
    // `retroalimentacion = ''`. Sólo el modo prueba docente lo muestra.
    retroalimentacionCorrecta: question.feedback.correct,
    retroalimentacionIncorrecta: question.feedback.incorrect,
    explicacionRevisionFinal: question.explanation,
  };
}

export type GradingSelfCheckInput = {
  numero: number;
  tipo: QuestionType;
  puntaje: number;
  claveCorreccionJson: string;
  answer: unknown;
};

type GradingKeyRow = Pick<MaterializedQuestion, "numero" | "tipo" | "puntaje" | "claveCorreccionJson">;

function gradingQuestion(row: GradingKeyRow): ActivityQuestionForGrading {
  return {
    id: row.numero,
    numero: row.numero,
    tipo: row.tipo,
    puntaje: row.puntaje,
    claveCorreccionJson: row.claveCorreccionJson,
    retroalimentacionCorrecta: "",
    retroalimentacionIncorrecta: "",
  };
}

// Verifica claves ya persistidas con la misma función que autoriza la revisión.
export function validateStoredGradingKey(rows: GradingKeyRow[]): AuthoringIssue[] {
  const issues: AuthoringIssue[] = [];
  for (const row of rows) {
    try {
      publicCorrectAnswerForReview(gradingQuestion(row));
    } catch {
      issues.push({
        severity: "error",
        code: "GRADING_KEY_INVALID",
        path: `questions[${row.numero - 1}].grading`,
        message: `La pregunta ${row.numero} tiene una clave de corrección incompatible con su tipo.`,
      });
    }
  }
  return issues;
}

// Auto-prueba: la respuesta derivada del propio grading debe puntuar completo.
export function selfCheckGrading(inputs: GradingSelfCheckInput[]): AuthoringIssue[] {
  const issues = validateStoredGradingKey(inputs.map((input) => ({
    numero: input.numero,
    tipo: input.tipo,
    puntaje: input.puntaje,
    claveCorreccionJson: input.claveCorreccionJson,
  })));
  if (issues.length > 0) return issues;

  const questions = inputs.map((input) => gradingQuestion({
    numero: input.numero,
    tipo: input.tipo,
    puntaje: input.puntaje,
    claveCorreccionJson: input.claveCorreccionJson,
  }));
  const answers: Record<string, unknown> = {};
  for (const input of inputs) answers[String(input.numero)] = input.answer;

  try {
    const graded = gradeActivity(questions, answers);
    const pointsByNumber = new Map(inputs.map((input) => [input.numero, input.puntaje]));
    for (const answer of graded.gradedAnswers) {
      if (answer.puntajeObtenido !== pointsByNumber.get(answer.numeroPregunta)) {
        issues.push({
          severity: "error",
          code: "GRADING_SELF_CHECK_FAILED",
          path: `questions[${answer.numeroPregunta - 1}].grading`,
          message: `La pregunta ${answer.numeroPregunta} no se autocorrige con la respuesta declarada como correcta.`,
        });
      }
    }
  } catch {
    issues.push({
      severity: "error",
      code: "GRADING_SELF_CHECK_FAILED",
      path: "questions",
      message: "El corrector real rechazó la configuración de corrección del documento.",
    });
  }
  return issues;
}

// Auto-prueba sobre un documento ya materializado: reconstruye la respuesta
// correcta desde la clave privada almacenada y exige el puntaje completo.
// Se usa antes y después de escribir, sin exponer nunca la clave.
export function selfCheckWithGrader(parsed: ParsedActivityDocument): AuthoringIssue[] {
  const inputs: GradingSelfCheckInput[] = parsed.questions.map((question) => {
    let key: { correctas?: unknown; aceptadas?: unknown } = {};
    try {
      const candidate: unknown = JSON.parse(question.claveCorreccionJson);
      if (isPlainObject(candidate)) key = candidate;
    } catch {
      key = {};
    }
    const correctas = Array.isArray(key.correctas) ? key.correctas : [];
    const aceptadas = Array.isArray(key.aceptadas) ? key.aceptadas : [];
    const answer = question.tipo === "radio" ? correctas[0] ?? null : question.tipo === "checkbox" ? correctas : aceptadas[0] ?? null;
    return {
      numero: question.numero,
      tipo: question.tipo,
      puntaje: question.puntaje,
      claveCorreccionJson: question.claveCorreccionJson,
      answer,
    };
  });
  return selfCheckGrading(inputs);
}

// ---- Proyección pública y comparación canónica -------------------------------
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainObject(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) sorted[key] = stableValue(value[key]);
    return sorted;
  }
  return value;
}

export function canonicalJsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

export function assertPublicProjection(value: unknown): AuthoringIssue[] {
  const issues: AuthoringIssue[] = [];
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (!isPlainObject(node)) return;
    for (const [key, child] of Object.entries(node)) {
      const childPath = path ? `${path}.${key}` : key;
      if ((PRIVATE_KEY_NAMES as readonly string[]).includes(key)) {
        issues.push({
          severity: "error",
          code: "PRIVATE_KEY_IN_PUBLIC_DOCUMENT",
          path: childPath,
          message: `La clave «${key}» es material privado de corrección y no puede aparecer en un documento público.`,
        });
      }
      walk(child, childPath);
    }
  };
  walk(value, "");
  return issues;
}

function publicQuestionOf(question: ParsedQuestion): Record<string, unknown> {
  const publicQuestion: Record<string, unknown> = {
    number: question.numero,
    type: question.tipo,
    prompt: question.prompt,
    points: question.points,
  };
  if (question.instructions.length > 0) publicQuestion.instructions = question.instructions;
  if (question.options.length > 0) publicQuestion.options = question.options.map((option) => ({ value: option.value, text: option.text }));
  if (question.placeholder !== null) publicQuestion.placeholder = question.placeholder;
  if (question.explanation !== null) publicQuestion.explanation = question.explanation;
  if (question.feedback.correct.length > 0 || question.feedback.incorrect.length > 0) {
    publicQuestion.feedback = {
      ...(question.feedback.correct.length > 0 ? { whenCorrect: question.feedback.correct } : {}),
      ...(question.feedback.incorrect.length > 0 ? { whenIncorrect: question.feedback.incorrect } : {}),
    };
  }
  if (question.resources.length > 0) publicQuestion.resources = question.resources;
  return publicQuestion;
}

function buildPublicDocument(
  activity: ParsedActivity,
  questions: ParsedQuestion[],
  metadata: AuthoringMetadata,
): PublicActivityDocument {
  return {
    schemaVersion: AUTHORING_SCHEMA_VERSION,
    activity: {
      slug: activity.slug,
      title: activity.title,
      description: activity.description,
      topic: activity.topic,
      unitCode: activity.unitCode,
      order: activity.order,
      edition: { subjectCode: activity.edition.subjectCode, year: activity.edition.year },
      maxAttempts: activity.maxAttempts,
      showReview: activity.showReview,
      approvalThreshold: activity.approvalThreshold,
      achievementThreshold: activity.achievementThreshold,
      editorialState: EDITORIAL_STATE_TO_PUBLIC[activity.estado],
    },
    questions: questions.map(publicQuestionOf),
    tags: [...metadata.tags],
    authoring: {
      createdBy: metadata.createdBy,
      version: metadata.version,
      ...(metadata.notes === null ? {} : { notes: metadata.notes }),
      ...(metadata.generatedAt === null ? {} : { generatedAt: metadata.generatedAt }),
    },
  };
}

export function publicProjectionOf(parsed: ParsedActivityDocument): PublicActivityDocument {
  return parsed.publicDocument;
}

// ---- Entrada pública del módulo ----------------------------------------------
const ROOT_KEYS = ["schemaVersion", "activity", "questions", "tags", "authoring"] as const;

function parseTags(value: unknown, collector: Collector): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    collector.fail("INVALID_TYPE", "tags", "Se esperaba una lista de etiquetas.");
    return [];
  }
  if (value.length > 8) collector.fail("INVALID_TAGS", "tags", "Se admiten hasta 8 etiquetas.");
  const tags: string[] = [];
  value.forEach((tag, index) => {
    const parsed = readString(tag, `tags[${index}]`, {
      minLength: 1, maxLength: 32, pattern: TAG_PATTERN, patternMessage: "Usá minúsculas sin espacios (se admiten acentos), números y guiones.",
    }, collector);
    if (parsed !== null) tags.push(parsed);
  });
  return tags;
}

function parseAuthoring(value: unknown, collector: Collector): Omit<AuthoringMetadata, "tags"> | null {
  const authoring = readObject(value, "authoring", collector);
  if (!authoring) return null;
  checkUnknownKeys(authoring, ["createdBy", "version", "notes", "generatedAt"], "authoring", collector);
  const createdBy = readString(authoring.createdBy, "authoring.createdBy", { minLength: 1, maxLength: 80 }, collector);
  const version = readOptionalInteger(authoring.version, "authoring.version", { min: 1, max: 100000 }, collector, 1);
  const notes = readOptionalString(authoring.notes, "authoring.notes", { minLength: 1, maxLength: 500 }, collector);
  const generatedAt = readOptionalString(authoring.generatedAt, "authoring.generatedAt", {
    minLength: 1, maxLength: 40, pattern: ISO_UTC_PATTERN, patternMessage: "Usá una fecha ISO 8601 en UTC terminada en Z.",
  }, collector);
  if (!createdBy) return null;
  return { createdBy, version, notes, generatedAt };
}

function unbalancedPointsWarnings(questions: ParsedQuestion[], totalPoints: number, collector: Collector) {
  const points = questions.map((question) => question.points).sort((left, right) => left - right);
  const median = points[Math.floor(points.length / 2)];
  if (median > 0 && points[points.length - 1] > median * 3) {
    collector.warn("UNBALANCED_POINTS", "questions", "Hay preguntas con puntaje muy superior a la mediana.");
  }
  if (totalPoints > 100) {
    collector.warn("UNBALANCED_POINTS", "questions", "El puntaje total de la actividad supera 100.");
  }
}

export function parseActivityDocument(input: unknown): ParseResult {
  const collector = createCollector();
  const buildResult = (parsed: ParsedActivityDocument | null): ParseResult => {
    const issues = collector.issues;
    return {
      ok: parsed !== null && !issues.some((issue) => issue.severity === "error"),
      issues,
      errors: issues.filter((issue) => issue.severity === "error"),
      warnings: issues.filter((issue) => issue.severity === "warning"),
      notes: issues.filter((issue) => issue.severity === "note"),
      parsed,
    };
  };

  if (!isPlainObject(input)) {
    collector.fail("INVALID_JSON", "", "El documento debe ser un objeto JSON.");
    return buildResult(null);
  }
  checkUnknownKeys(input, ROOT_KEYS, "", collector);

  const schemaVersion = readInteger(input.schemaVersion, "schemaVersion", { min: 1, max: 9999 }, collector);
  if (schemaVersion !== null && schemaVersion !== AUTHORING_SCHEMA_VERSION) {
    collector.fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion", `Este pipeline sólo entiende schemaVersion ${AUTHORING_SCHEMA_VERSION}.`);
  }

  const activity = parseActivity(input.activity, collector);
  const authoring = parseAuthoring(input.authoring, collector);
  const tags = parseTags(input.tags, collector);
  collector.note("METADATA_ONLY_FIELDS", "tags", "tags y authoring son metadata del pipeline: no se persisten en D1 v1.");

  const rawQuestions = input.questions;
  const parsedQuestions: ParsedQuestion[] = [];
  if (rawQuestions === undefined) {
    collector.fail("MISSING_FIELD", "questions", "Falta la lista de preguntas.");
  } else if (!Array.isArray(rawQuestions)) {
    collector.fail("INVALID_TYPE", "questions", "Se esperaba una lista de preguntas.");
  } else if (rawQuestions.length === 0) {
    collector.fail("NO_QUESTIONS", "questions", "La actividad necesita al menos una pregunta.");
  } else {
    if (rawQuestions.length > 200) collector.fail("TOO_MANY_QUESTIONS", "questions", "Se admiten hasta 200 preguntas.");
    const seenNumbers = new Set<number>();
    rawQuestions.forEach((entry, index) => {
      const question = parseQuestion(entry, index, collector, seenNumbers);
      if (question) parsedQuestions.push(question);
    });
  }

  const expectedQuestions = Array.isArray(rawQuestions) ? rawQuestions.length : 0;
  if (collector.issues.some((issue) => issue.severity === "error") || !activity || !authoring || parsedQuestions.length !== expectedQuestions) {
    return buildResult(null);
  }

  const totalPoints = parsedQuestions.reduce((sum, question) => sum + question.points, 0);
  if (!Number.isSafeInteger(totalPoints) || totalPoints <= 0) {
    collector.fail("TOTAL_POINTS_INVALID", "questions", "El puntaje total no es un entero positivo válido.");
    return buildResult(null);
  }
  unbalancedPointsWarnings(parsedQuestions, totalPoints, collector);

  const metadata: AuthoringMetadata = { tags, ...authoring };
  const publicDocument = buildPublicDocument(activity, parsedQuestions, metadata);
  const parsed: ParsedActivityDocument = {
    schemaVersion: AUTHORING_SCHEMA_VERSION,
    edition: activity.edition,
    activity: {
      slug: activity.slug,
      titulo: activity.title,
      descripcion: activity.description,
      tema: activity.topic,
      unidadCodigo: activity.unitCode,
      orden: activity.order,
      estado: activity.estado,
      puntajeTotal: totalPoints,
      maximoIntentos: activity.maxAttempts,
      umbralAprobacion: activity.approvalThreshold,
      umbralDestacado: activity.achievementThreshold,
      mostrarRevision: activity.showReview ? 1 : 0,
    },
    questions: parsedQuestions.map(toMaterializedQuestion),
    metadata,
    publicDocument,
    totalPoints,
  };

  // Dos fronteras antes de permitir publicar: la proyección no puede contener
  // material privado y el corrector real debe dar por correcto lo declarado.
  collector.issues.push(...assertPublicProjection(parsed.publicDocument));
  collector.issues.push(...selfCheckWithGrader(parsed));
  if (collector.issues.some((issue) => issue.severity === "error")) return buildResult(null);
  return buildResult(parsed);
}