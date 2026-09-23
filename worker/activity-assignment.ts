// Pipeline local de asignación y habilitación de actividades por grupos (Hito 6C).
//
// Módulo puro: sin D1, sin `env` y sin sistema de archivos. No lo importa
// `worker/index.ts` y no forma parte de ningún bundle. Sólo describe, valida y
// compara el estado deseado de `habilitaciones_actividad`; la escritura y su
// verificación viven en el CLI local `scripts/activity-assignment.mjs`.
//
// El documento declara ESTADO DESEADO, no un parche: las cuatro claves de cada
// asignación son obligatorias y `null` significa explícitamente «sin límite».

export const ASSIGNMENT_SCHEMA_VERSION = 1;
export const MAX_ASSIGNMENT_DOCUMENT_BYTES = 128 * 1024;
export const MAX_ASSIGNMENTS = 50;

const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GROUP_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// Se exige ISO 8601 con offset explícito: `Z` u `±HH:MM`. Una fecha sin offset
// es ambigua en la zona horaria de Uruguay y se rechaza.
const ISO_WITH_OFFSET_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;

export type AssignmentSeverity = "error" | "warning";

export type AssignmentIssue = {
  severity: AssignmentSeverity;
  code: string;
  path: string;
  message: string;
};

// Estado de una asignación tal como se persiste en `habilitaciones_actividad`.
export type AssignmentState = {
  enabled: boolean;
  opensAt: string | null;
  closesAt: string | null;
};

export type AssignmentField = "enabled" | "opensAt" | "closesAt";

export type ParsedAssignment = {
  groupCode: string;
  // Clave normalizada para comparar duplicados sin distinguir mayúsculas.
  groupKey: string;
  state: AssignmentState;
};

export type ParsedAssignmentDocument = {
  schemaVersion: number;
  slug: string;
  edition: { subjectCode: string; year: number };
  assignments: ParsedAssignment[];
  authoring: { createdBy: string; version: number; notes: string | null; generatedAt: string | null };
};

export type AssignmentParseResult = {
  ok: boolean;
  issues: AssignmentIssue[];
  errors: AssignmentIssue[];
  warnings: AssignmentIssue[];
  parsed: ParsedAssignmentDocument | null;
};

export type AssignmentHistory = { drafts: number; submitted: number; annulled: number };

export type AssignmentComparison = {
  action: "create" | "update" | "unchanged";
  changedFields: AssignmentField[];
  unchanged: boolean;
};

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Collector = {
  issues: AssignmentIssue[];
  fail(code: string, path: string, message: string): void;
  warn(code: string, path: string, message: string): void;
};

function createCollector(): Collector {
  const issues: AssignmentIssue[] = [];
  const add = (severity: AssignmentSeverity) => (code: string, path: string, message: string) => {
    issues.push({ severity, code, path, message });
  };
  return { issues, fail: add("error"), warn: add("warning") };
}

function checkUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, collector: Collector) {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;
    const childPath = path ? `${path}.${key}` : key;
    if (key === "maxAttempts" || key === "maximo_intentos") {
      collector.fail("UNKNOWN_KEY", childPath, "La cantidad de intentos pertenece al pipeline de autoría (Hito 6A): 6C no modifica maxAttempts.");
      continue;
    }
    if (path === "activity" && ["title", "questions", "puntaje_total", "id", "editorialState", "resources"].includes(key)) {
      collector.fail("UNKNOWN_KEY", childPath, `La clave «${key}» pertenece al contenido de la actividad: se publica con el pipeline de autoría (Hito 6A).`);
      continue;
    }
    collector.fail("UNKNOWN_KEY", childPath, `La clave «${key}» no forma parte del contrato v1 de asignación.`);
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

function readOptionalInteger(value: unknown, path: string, min: number, max: number, collector: Collector, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    collector.fail("INVALID_TYPE", path, "Se esperaba un número entero.");
    return fallback;
  }
  if (value < min || value > max) {
    collector.fail("INVALID_RANGE", path, `Debe estar entre ${min} y ${max}.`);
    return fallback;
  }
  return value;
}

// ---- Fechas -----------------------------------------------------------------
// Forma canónica de persistencia: `YYYY-MM-DDTHH:MM:SS.sssZ`, idéntica a la que
// escribe el endpoint docente y que D1 compara con `datetime()`.
export function normalizeIsoUtc(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = ISO_WITH_OFFSET_PATTERN.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, millisecondText, offsetText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText ?? "0");
  const millisecond = Number((millisecondText ?? "0").padEnd(3, "0"));
  if (year < 1000) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  let offsetMinutes = 0;
  if (offsetText !== "Z") {
    const offsetHour = Number(offsetText.slice(1, 3));
    const offsetMinute = Number(offsetText.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return null;
    offsetMinutes = (offsetText.startsWith("-") ? -1 : 1) * (offsetHour * 60 + offsetMinute);
  }
  const utc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - offsetMinutes * 60_000;
  if (!Number.isFinite(utc)) return null;
  // Verificación de ida y vuelta: rechaza fechas imposibles (por ejemplo
  // 2026-02-30) que el motor desplazaría silenciosamente.
  const back = new Date(utc + offsetMinutes * 60_000);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day
    || back.getUTCHours() !== hour || back.getUTCMinutes() !== minute || back.getUTCSeconds() !== second) return null;
  return new Date(utc).toISOString();
}

const dateSignature = (value: unknown) => (value === null ? "null" : String(normalizeIsoUtc(value) ?? value));

export const compareDates = (left: unknown, right: unknown) => dateSignature(left) === dateSignature(right);

function readNullableDate(item: Record<string, unknown>, key: "opensAt" | "closesAt", path: string, collector: Collector): string | null | undefined {
  if (!(key in item)) {
    collector.fail("MISSING_FIELD", `${path}.${key}`, `Falta «${key}»: usá null para indicar que no hay límite.`);
    return undefined;
  }
  const value = item[key];
  if (value === null) return null;
  const normalized = normalizeIsoUtc(value);
  if (!normalized) {
    collector.fail("INVALID_DATE", `${path}.${key}`, "Usá ISO 8601 con offset explícito (por ejemplo 2026-09-28T08:00:00-03:00) o null.");
    return undefined;
  }
  return normalized;
}

// ---- Asignaciones -----------------------------------------------------------
const ASSIGNMENT_KEYS = ["groupCode", "enabled", "opensAt", "closesAt"] as const;

function parseAssignmentEntry(entry: unknown, index: number, collector: Collector, seenGroups: Map<string, number>): ParsedAssignment | null {
  const path = `assignments[${index}]`;
  const item = readObject(entry, path, collector);
  if (!item) return null;
  checkUnknownKeys(item, ASSIGNMENT_KEYS, path, collector);

  const groupCode = readString(item.groupCode, `${path}.groupCode`, {
    minLength: 1, maxLength: 24, pattern: GROUP_CODE_PATTERN,
    patternMessage: "Usá letras, números, punto, guion o guion bajo, sin espacios exteriores.", code: "INVALID_GROUP_CODE",
  }, collector);

  let enabled = true;
  let enabledPresent = true;
  if (!("enabled" in item)) {
    collector.fail("MISSING_FIELD", `${path}.enabled`, "Falta «enabled»: escribí true o false explícitamente.");
    enabledPresent = false;
  } else if (typeof item.enabled !== "boolean") {
    collector.fail("INVALID_TYPE", `${path}.enabled`, "Se esperaba verdadero o falso.");
    enabledPresent = false;
  } else {
    enabled = item.enabled;
  }

  const opensAt = readNullableDate(item, "opensAt", path, collector);
  const closesAt = readNullableDate(item, "closesAt", path, collector);
  if (opensAt !== undefined && closesAt !== undefined && opensAt !== null && closesAt !== null && opensAt >= closesAt) {
    collector.fail("INVALID_WINDOW", path, "La apertura debe ser anterior al cierre.");
  }

  let groupKey: string | null = null;
  if (groupCode !== null) {
    if (groupCode !== groupCode.trim()) {
      collector.fail("INVALID_GROUP_CODE", `${path}.groupCode`, "El código de grupo no puede tener espacios al inicio ni al final.");
    }
    groupKey = groupCode.toLowerCase();
    const firstIndex = seenGroups.get(groupKey);
    if (firstIndex === undefined) seenGroups.set(groupKey, index);
    else collector.fail("GROUP_DUPLICATED", `${path}.groupCode`, `El grupo ya fue declarado en assignments[${firstIndex}].`);
  }

  if (!groupCode || groupKey === null || !enabledPresent || opensAt === undefined || closesAt === undefined) return null;
  return { groupCode, groupKey, state: { enabled, opensAt, closesAt } };
}

// ---- Actividad, edición y metadata ------------------------------------------
const ACTIVITY_KEYS = ["slug", "edition"] as const;
const EDITION_KEYS = ["subjectCode", "year"] as const;
const AUTHORING_KEYS = ["createdBy", "version", "notes", "generatedAt"] as const;
const ROOT_KEYS = ["schemaVersion", "activity", "assignments", "authoring"] as const;

function parseEdition(value: unknown, path: string, collector: Collector): { subjectCode: string; year: number } | null {
  const edition = readObject(value, path, collector);
  if (!edition) return null;
  checkUnknownKeys(edition, EDITION_KEYS, path, collector);
  const subjectCode = readString(edition.subjectCode, `${path}.subjectCode`, {
    minLength: 1, maxLength: 64, pattern: IDENTIFIER_PATTERN, patternMessage: "Usá minúsculas, números y guiones.", code: "INVALID_EDITION",
  }, collector);
  const year = typeof edition.year === "number" && Number.isSafeInteger(edition.year) && edition.year >= 2020 && edition.year <= 2100
    ? edition.year
    : null;
  if (year === null) collector.fail("INVALID_EDITION", `${path}.year`, "El año debe ser un entero entre 2020 y 2100.");
  if (!subjectCode || year === null) return null;
  return { subjectCode, year };
}

function parseActivity(value: unknown, collector: Collector): { slug: string; edition: { subjectCode: string; year: number } } | null {
  const activity = readObject(value, "activity", collector);
  if (!activity) return null;
  checkUnknownKeys(activity, ACTIVITY_KEYS, "activity", collector);
  const slug = readString(activity.slug, "activity.slug", {
    minLength: 3, maxLength: 80, pattern: IDENTIFIER_PATTERN, patternMessage: "Usá minúsculas, números y guiones.", code: "INVALID_SLUG",
  }, collector);
  const edition = parseEdition(activity.edition, "activity.edition", collector);
  if (!slug || !edition) return null;
  return { slug, edition };
}

function parseAuthoring(value: unknown, collector: Collector) {
  const authoring = readObject(value, "authoring", collector);
  if (!authoring) return null;
  checkUnknownKeys(authoring, AUTHORING_KEYS, "authoring", collector);
  const createdBy = readString(authoring.createdBy, "authoring.createdBy", { minLength: 1, maxLength: 80 }, collector);
  const version = readOptionalInteger(authoring.version, "authoring.version", 1, 100000, collector, 1);
  const notes = readOptionalString(authoring.notes, "authoring.notes", { minLength: 1, maxLength: 500 }, collector);
  let generatedAt: string | null = null;
  if (authoring.generatedAt !== undefined && authoring.generatedAt !== null) {
    const normalized = normalizeIsoUtc(authoring.generatedAt);
    if (normalized === null) collector.fail("INVALID_DATE", "authoring.generatedAt", "Usá una fecha ISO 8601 con offset explícito o null.");
    else generatedAt = normalized;
  }
  if (!createdBy) return null;
  return { createdBy, version, notes, generatedAt };
}


export function parseAssignmentDocument(input: unknown): AssignmentParseResult {
  const collector = createCollector();
  const buildResult = (parsed: ParsedAssignmentDocument | null): AssignmentParseResult => {
    const issues = collector.issues;
    return {
      ok: parsed !== null && !issues.some((issue) => issue.severity === "error"),
      issues,
      errors: issues.filter((issue) => issue.severity === "error"),
      warnings: issues.filter((issue) => issue.severity === "warning"),
      parsed,
    };
  };

  if (!isPlainObject(input)) {
    collector.fail("INVALID_DOCUMENT", "", "El documento debe ser un objeto JSON.");
    return buildResult(null);
  }
  checkUnknownKeys(input, ROOT_KEYS, "", collector);

  const schemaVersion = input.schemaVersion;
  if (schemaVersion === undefined) collector.fail("MISSING_FIELD", "schemaVersion", "Falta un campo obligatorio.");
  else if (typeof schemaVersion !== "number" || !Number.isSafeInteger(schemaVersion)) collector.fail("INVALID_TYPE", "schemaVersion", "Se esperaba un número entero.");
  else if (schemaVersion !== ASSIGNMENT_SCHEMA_VERSION) collector.fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion", `Este pipeline sólo entiende schemaVersion ${ASSIGNMENT_SCHEMA_VERSION}.`);

  const activity = parseActivity(input.activity, collector);

  const seenGroups = new Map<string, number>();
  const assignments: ParsedAssignment[] = [];
  if (input.assignments === undefined) {
    collector.fail("MISSING_FIELD", "assignments", "Falta la lista de asignaciones.");
  } else if (!Array.isArray(input.assignments)) {
    collector.fail("INVALID_TYPE", "assignments", "Se esperaba una lista de asignaciones.");
  } else {
    if (input.assignments.length < 1) collector.fail("EMPTY_ASSIGNMENTS", "assignments", "Declará al menos un grupo.");
    if (input.assignments.length > MAX_ASSIGNMENTS) collector.fail("TOO_MANY_ASSIGNMENTS", "assignments", `Se admiten hasta ${MAX_ASSIGNMENTS} grupos por archivo.`);
    input.assignments.forEach((entry, index) => {
      const parsed = parseAssignmentEntry(entry, index, collector, seenGroups);
      if (parsed) assignments.push(parsed);
    });
  }

  const authoring = parseAuthoring(input.authoring, collector);

  if (!activity || !authoring || collector.issues.some((issue) => issue.severity === "error")) return buildResult(null);
  return buildResult({
    schemaVersion: ASSIGNMENT_SCHEMA_VERSION,
    slug: activity.slug,
    edition: activity.edition,
    assignments,
    authoring,
  });
}

// ---- Comparación e idempotencia ---------------------------------------------
export function compareAssignmentState(current: AssignmentState | null, desired: AssignmentState): AssignmentComparison {
  if (!current) return { action: "create", changedFields: ["enabled", "opensAt", "closesAt"], unchanged: false };
  const changedFields: AssignmentField[] = [];
  if (current.enabled !== desired.enabled) changedFields.push("enabled");
  if (!compareDates(current.opensAt, desired.opensAt)) changedFields.push("opensAt");
  if (!compareDates(current.closesAt, desired.closesAt)) changedFields.push("closesAt");
  return { action: changedFields.length === 0 ? "unchanged" : "update", changedFields, unchanged: changedFields.length === 0 };
}

// Traducción a las columnas reales de `habilitaciones_actividad`.
export function toD1Assignment(state: AssignmentState) {
  return { habilitada: state.enabled ? 1 : 0, disponibleDesde: state.opensAt, disponibleHasta: state.closesAt };
}

// ---- Política con historia ---------------------------------------------------
// Puro y determinista: recibe el `now` explícito para que las pruebas controlen
// el tiempo. Los warnings nunca bloquean la aplicación.
export function historyWarnings(
  current: AssignmentState | null,
  desired: AssignmentState,
  history: AssignmentHistory,
  nowIso: string,
): AssignmentIssue[] {
  const warnings: AssignmentIssue[] = [];
  const now = normalizeIsoUtc(nowIso) ?? nowIso;
  const add = (code: string, message: string) => warnings.push({ severity: "warning", code, path: "assignments", message });
  const hadHistory = history.drafts + history.submitted + history.annulled > 0;
  const disabling = desired.enabled === false && current !== null && current.enabled;

  if (disabling && history.drafts > 0) {
    add("DISABLE_WITH_DRAFTS", `${history.drafts} borrador(es) existentes podrán seguir respondiéndose y entregándose.`);
  }
  if (disabling && history.submitted > 0) {
    add("DISABLE_WITH_SUBMITTED", `Se deshabilita con ${history.submitted} intento(s) enviado(s); los resultados se conservan y no se recalifican.`);
  }
  const openingMovesToFuture = desired.opensAt !== null && desired.opensAt > now
    && current !== null && (current.opensAt === null || current.opensAt <= now);
  if (openingMovesToFuture && history.drafts > 0) {
    add("OPENING_IN_FUTURE_WITH_DRAFTS", `La apertura pasa al futuro con ${history.drafts} borrador(es) abiertos.`);
  }
  const wasClosed = current !== null && current.closesAt !== null && current.closesAt < now;
  const isOpenNow = desired.enabled && (desired.closesAt === null || desired.closesAt > now);
  if (wasClosed && isOpenNow) {
    add("REOPENING_CLOSED_ASSIGNMENT", "Se reabre una asignación que estaba cerrada.");
  }
  const closesNowOrEarlier = desired.closesAt !== null && desired.closesAt <= now
    && (current === null || current.closesAt === null || current.closesAt > desired.closesAt);
  if (closesNowOrEarlier && history.drafts > 0) {
    add("CLOSING_EARLY_WITH_DRAFTS", `Se cierra de inmediato con ${history.drafts} borrador(es) abiertos.`);
  }
  const removesWindow = current !== null
    && ((current.opensAt !== null && desired.opensAt === null) || (current.closesAt !== null && desired.closesAt === null));
  if (removesWindow && hadHistory) {
    add("WINDOW_REMOVED_WITH_HISTORY", "Se elimina una ventana que existía y la asignación ya tiene historia.");
  }
  return warnings;
}
