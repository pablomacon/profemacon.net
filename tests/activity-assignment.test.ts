import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_ASSIGNMENTS,
  compareAssignmentState,
  historyWarnings,
  normalizeIsoUtc,
  parseAssignmentDocument,
  toD1Assignment,
  type AssignmentHistory,
  type AssignmentParseResult,
  type AssignmentState,
} from "../worker/activity-assignment.ts";

type Json = Record<string, unknown>;

const OPEN = "2026-09-28T08:00:00-03:00";
const CLOSE = "2026-10-02T23:59:00-03:00";
const OPEN_UTC = "2026-09-28T11:00:00.000Z";
const CLOSE_UTC = "2026-10-03T02:59:00.000Z";

const assignment = (overrides: Json = {}): Json => ({ groupCode: "1MF", enabled: true, opensAt: OPEN, closesAt: CLOSE, ...overrides });

function document(overrides: Json = {}): Json {
  const base: Json = {
    schemaVersion: 1,
    activity: { slug: "variables-java-01", edition: { subjectCode: "programacion-i", year: 2026 } },
    assignments: [assignment(), assignment({ groupCode: "1MG", opensAt: null, closesAt: null })],
    authoring: { createdBy: "prueba-automatica", version: 1 },
  };
  const merged: Json = { ...base, ...overrides };
  if (overrides.activity) merged.activity = { ...(base.activity as Json), ...(overrides.activity as Json) };
  if (overrides.authoring) merged.authoring = { ...(base.authoring as Json), ...(overrides.authoring as Json) };
  return merged;
}

function accepted(input: Json) {
  const result = parseAssignmentDocument(input);
  assert.equal(result.ok, true, `se esperaba un documento válido: ${JSON.stringify(result.errors)}`);
  assert.ok(result.parsed, "un documento válido debe producir el documento parseado");
  return result.parsed as NonNullable<typeof result.parsed>;
}

function expectIssue(result: AssignmentParseResult, code: string, severity: "error" | "warning" = "error") {
  assert.ok(
    result.issues.some((issue) => issue.code === code && issue.severity === severity),
    `se esperaba ${severity} ${code}; issues: ${JSON.stringify(result.issues.map((issue) => `${issue.severity}:${issue.code}`))}`,
  );
}

const rejected = (input: Json, code: string) => {
  const result = parseAssignmentDocument(input);
  assert.equal(result.ok, false, `se esperaba rechazo por ${code}`);
  expectIssue(result, code);
  assert.equal(result.parsed, null);
  return result;
};

test("acepta un documento válido y conserva el orden declarado", () => {
  const parsed = accepted(document());
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.slug, "variables-java-01");
  assert.deepEqual(parsed.edition, { subjectCode: "programacion-i", year: 2026 });
  assert.equal(parsed.assignments.length, 2);
  assert.deepEqual(parsed.assignments.map((entry) => entry.groupCode), ["1MF", "1MG"]);
  assert.deepEqual(parsed.assignments[0].state, { enabled: true, opensAt: OPEN_UTC, closesAt: CLOSE_UTC });
  assert.deepEqual(parsed.assignments[1].state, { enabled: true, opensAt: null, closesAt: null });
  assert.equal(parsed.assignments[0].groupKey, "1mf");
  assert.equal(parsed.authoring.createdBy, "prueba-automatica");
});

test("rechaza claves desconocidas en cualquier nivel", () => {
  rejected({ ...document(), extra: 1 }, "UNKNOWN_KEY");
  rejected(document({ activity: { slug: "variables-java-01", edition: { subjectCode: "programacion-i", year: 2026 }, topic: "x" } }), "UNKNOWN_KEY");
  rejected({ ...document(), assignments: [assignment({ notes: "x" })] }, "UNKNOWN_KEY");
  rejected({ ...document(), authoring: { createdBy: "prueba", extra: 1 } }, "UNKNOWN_KEY");
  rejected({ ...document(), activity: { slug: "variables-java-01", edition: { subjectCode: "programacion-i", year: 2026, month: 1 } } }, "UNKNOWN_KEY");
});

test("rechaza la cantidad de intentos y el contenido con un mensaje de frontera con 6A", () => {
  const result = rejected(document({ activity: { slug: "variables-java-01", edition: { subjectCode: "programacion-i", year: 2026 }, maxAttempts: 2 } }), "UNKNOWN_KEY");
  expectIssue(result, "UNKNOWN_KEY");
  assert.ok(result.issues.some((issue) => issue.code === "UNKNOWN_KEY" && issue.message.includes("6A")));
  const content = rejected(document({ activity: { slug: "variables-java-01", edition: { subjectCode: "programacion-i", year: 2026 }, title: "x" } }), "UNKNOWN_KEY");
  assert.ok(content.issues.some((issue) => issue.message.includes("autoría")));
});

test("valida schemaVersion", () => {
  const missing = parseAssignmentDocument({ activity: document().activity, assignments: document().assignments, authoring: document().authoring });
  expectIssue(missing, "MISSING_FIELD");
  rejected(document({ schemaVersion: "1" }), "INVALID_TYPE");
  rejected(document({ schemaVersion: 2 }), "UNSUPPORTED_SCHEMA_VERSION");
  rejected(document({ schemaVersion: 1.5 }), "INVALID_TYPE");
});

test("valida el slug de la actividad", () => {
  rejected(document({ activity: { slug: "Variables Java 01", edition: { subjectCode: "programacion-i", year: 2026 } } }), "INVALID_SLUG");
  rejected(document({ activity: { slug: "ab", edition: { subjectCode: "programacion-i", year: 2026 } } }), "INVALID_SLUG");
  rejected({ ...document(), activity: { edition: { subjectCode: "programacion-i", year: 2026 } } }, "MISSING_FIELD");
});

test("valida la edición declarada", () => {
  rejected(document({ activity: { slug: "variables-java-01", edition: { subjectCode: "Programacion I", year: 2026 } } }), "INVALID_EDITION");
  rejected(document({ activity: { slug: "variables-java-01", edition: { subjectCode: "programacion-i", year: 2019 } } }), "INVALID_EDITION");
  rejected(document({ activity: { slug: "variables-java-01", edition: { subjectCode: "programacion-i", year: "2026" } } }), "INVALID_EDITION");
  rejected({ ...document(), activity: { slug: "variables-java-01" } }, "MISSING_FIELD");
});


test("valida la lista de asignaciones", () => {
  rejected({ ...document(), assignments: [] }, "EMPTY_ASSIGNMENTS");
  rejected({ ...document(), assignments: "1MF" }, "INVALID_TYPE");
  const withoutAssignments = { schemaVersion: 1, activity: document().activity, authoring: document().authoring };
  expectIssue(parseAssignmentDocument(withoutAssignments), "MISSING_FIELD");
  const many = Array.from({ length: MAX_ASSIGNMENTS + 1 }, (_, index) => assignment({ groupCode: `G${index}` }));
  rejected({ ...document(), assignments: many }, "TOO_MANY_ASSIGNMENTS");
  const limit = Array.from({ length: MAX_ASSIGNMENTS }, (_, index) => assignment({ groupCode: `G${index}` }));
  assert.equal(accepted({ ...document(), assignments: limit }).assignments.length, MAX_ASSIGNMENTS);
});

test("rechaza grupos duplicados, incluso sin distinguir mayúsculas", () => {
  rejected({ ...document(), assignments: [assignment(), assignment()] }, "GROUP_DUPLICATED");
  rejected({ ...document(), assignments: [assignment({ groupCode: "1MF" }), assignment({ groupCode: "1mf" })] }, "GROUP_DUPLICATED");
});

test("valida el formato del código de grupo", () => {
  rejected({ ...document(), assignments: [assignment({ groupCode: " 1MF" })] }, "INVALID_GROUP_CODE");
  rejected({ ...document(), assignments: [assignment({ groupCode: "1 MF" })] }, "INVALID_GROUP_CODE");
  rejected({ ...document(), assignments: [assignment({ groupCode: "1MF/" })] }, "INVALID_GROUP_CODE");
  rejected({ ...document(), assignments: [assignment({ groupCode: "" })] }, "INVALID_GROUP_CODE");
  rejected({ ...document(), assignments: [assignment({ groupCode: "G".repeat(25) })] }, "INVALID_GROUP_CODE");
  rejected({ ...document(), assignments: [assignment({ groupCode: 7 })] }, "INVALID_GROUP_CODE");
  assert.equal(accepted({ ...document(), assignments: [assignment({ groupCode: "1MF_A.2" })] }).assignments[0].groupCode, "1MF_A.2");
});

test("exige enabled explícito y de tipo boolean", () => {
  const missing = parseAssignmentDocument({ ...document(), assignments: [{ groupCode: "1MF", opensAt: null, closesAt: null }] });
  expectIssue(missing, "MISSING_FIELD");
  assert.equal(missing.ok, false);
  rejected({ ...document(), assignments: [assignment({ enabled: "si" })] }, "INVALID_TYPE");
  assert.equal(accepted({ ...document(), assignments: [assignment({ enabled: false })] }).assignments[0].state.enabled, false);
});

test("exige opensAt y closesAt presentes y acepta null como sin límite", () => {
  const withoutOpens = parseAssignmentDocument({ ...document(), assignments: [{ groupCode: "1MF", enabled: true, closesAt: null }] });
  expectIssue(withoutOpens, "MISSING_FIELD");
  assert.equal(withoutOpens.ok, false);
  const withoutCloses = parseAssignmentDocument({ ...document(), assignments: [{ groupCode: "1MF", enabled: true, opensAt: null }] });
  expectIssue(withoutCloses, "MISSING_FIELD");
  assert.equal(withoutCloses.ok, false);
  assert.deepEqual(accepted({ ...document(), assignments: [assignment({ opensAt: null, closesAt: null })] }).assignments[0].state, { enabled: true, opensAt: null, closesAt: null });
  assert.deepEqual(accepted({ ...document(), assignments: [assignment({ closesAt: null })] }).assignments[0].state, { enabled: true, opensAt: OPEN_UTC, closesAt: null });
  assert.deepEqual(accepted({ ...document(), assignments: [assignment({ opensAt: null })] }).assignments[0].state, { enabled: true, opensAt: null, closesAt: CLOSE_UTC });
});

test("normaliza fechas con Z y con offset a la forma UTC canónica", () => {
  assert.equal(normalizeIsoUtc("2026-09-28T11:00:00Z"), OPEN_UTC);
  assert.equal(normalizeIsoUtc("2026-09-28T11:00Z"), OPEN_UTC);
  assert.equal(normalizeIsoUtc("2026-09-28T11:00:00.000Z"), OPEN_UTC);
  assert.equal(normalizeIsoUtc(OPEN), OPEN_UTC);
  assert.equal(normalizeIsoUtc("2026-09-28T08:00:00.500-03:00"), "2026-09-28T11:00:00.500Z");
  assert.equal(normalizeIsoUtc("2026-09-28T14:00:00+03:00"), OPEN_UTC);
  assert.equal(normalizeIsoUtc("2026-09-28T11:00:00+00:00"), OPEN_UTC);
  // El mismo instante escrito de tres formas distintas es idéntico tras normalizar.
  const variants = ["2026-09-28T11:00:00Z", "2026-09-28T08:00:00-03:00", "2026-09-28T14:00:00+03:00"].map((value) => normalizeIsoUtc(value));
  assert.equal(new Set(variants).size, 1);
});

test("rechaza fechas sin offset, texto libre, vacíos y fechas imposibles", () => {
  const invalid = ["2026-09-28T08:00:00", "2026-09-28 08:00:00", "ayer", "", "  ", "2026-02-30T00:00:00Z", "2026-13-01T00:00:00Z", "2026-09-28T24:00:00Z", "2026-09-28T08:00:00+25:00", "2026/09/28T08:00:00Z"];
  for (const value of invalid) {
    assert.equal(normalizeIsoUtc(value), null, `debería rechazar ${JSON.stringify(value)}`);
    expectIssue(parseAssignmentDocument({ ...document(), assignments: [assignment({ opensAt: value })] }), "INVALID_DATE");
  }
  expectIssue(parseAssignmentDocument({ ...document(), assignments: [assignment({ closesAt: 5 })] }), "INVALID_DATE");
});

test("exige apertura anterior al cierre", () => {
  rejected({ ...document(), assignments: [assignment({ opensAt: CLOSE, closesAt: CLOSE })] }, "INVALID_WINDOW");
  rejected({ ...document(), assignments: [assignment({ opensAt: CLOSE, closesAt: OPEN })] }, "INVALID_WINDOW");
  // Instantes equivalentes escritos con distinto offset también son igualdad.
  rejected({ ...document(), assignments: [assignment({ opensAt: "2026-09-28T14:00:00+03:00", closesAt: "2026-09-28T11:00:00Z" })] }, "INVALID_WINDOW");
  assert.ok(accepted({ ...document(), assignments: [assignment({ opensAt: OPEN, closesAt: "2026-09-28T11:00:01Z" })] }));
});


test("exige authoring.createdBy y admite las claves opcionales", () => {
  const missing = parseAssignmentDocument({ schemaVersion: 1, activity: document().activity, assignments: document().assignments, authoring: { version: 1 } });
  expectIssue(missing, "MISSING_FIELD");
  assert.equal(missing.ok, false);
  expectIssue(parseAssignmentDocument({ schemaVersion: 1, activity: document().activity, assignments: document().assignments, authoring: { createdBy: "" } }), "INVALID_LENGTH");
  const parsed = accepted({ ...document(), authoring: { createdBy: "profe-macon-ai-workflow", version: 3, notes: "Nota ficticia", generatedAt: "2026-09-22T00:00:00Z" } });
  assert.deepEqual(parsed.authoring, { createdBy: "profe-macon-ai-workflow", version: 3, notes: "Nota ficticia", generatedAt: "2026-09-22T00:00:00.000Z" });
  assert.equal(accepted(document()).authoring.version, 1);
});

test("compara estado actual contra deseado y detecta el estado sin cambios", () => {
  const desired: AssignmentState = { enabled: true, opensAt: OPEN_UTC, closesAt: CLOSE_UTC };
  const unchanged = compareAssignmentState({ enabled: true, opensAt: OPEN_UTC, closesAt: CLOSE_UTC }, desired);
  assert.equal(unchanged.action, "unchanged");
  assert.equal(unchanged.unchanged, true);
  assert.deepEqual(unchanged.changedFields, []);
  // La comparación es por instante, no por texto: otro offset no genera cambios.
  const equivalent = compareAssignmentState({ enabled: true, opensAt: OPEN, closesAt: CLOSE }, desired);
  assert.equal(equivalent.action, "unchanged");
});

test("detecta exactamente los campos cambiados y el alta", () => {
  const desired: AssignmentState = { enabled: true, opensAt: OPEN_UTC, closesAt: CLOSE_UTC };
  assert.deepEqual(compareAssignmentState({ enabled: false, opensAt: null, closesAt: null }, desired).changedFields, ["enabled", "opensAt", "closesAt"]);
  assert.deepEqual(compareAssignmentState({ enabled: false, opensAt: OPEN_UTC, closesAt: CLOSE_UTC }, desired).changedFields, ["enabled"]);
  assert.deepEqual(compareAssignmentState({ enabled: true, opensAt: null, closesAt: CLOSE_UTC }, desired).changedFields, ["opensAt"]);
  assert.deepEqual(compareAssignmentState({ enabled: true, opensAt: OPEN_UTC, closesAt: null }, desired).changedFields, ["closesAt"]);
  const create = compareAssignmentState(null, desired);
  assert.equal(create.action, "create");
  assert.equal(create.unchanged, false);
  assert.deepEqual(create.changedFields, ["enabled", "opensAt", "closesAt"]);
  const removing = compareAssignmentState({ enabled: true, opensAt: OPEN_UTC, closesAt: CLOSE_UTC }, { enabled: true, opensAt: null, closesAt: null });
  assert.equal(removing.action, "update");
  assert.deepEqual(removing.changedFields, ["opensAt", "closesAt"]);
});

test("traduce el estado a las columnas de habilitaciones_actividad", () => {
  assert.deepEqual(toD1Assignment({ enabled: true, opensAt: OPEN_UTC, closesAt: null }), { habilitada: 1, disponibleDesde: OPEN_UTC, disponibleHasta: null });
  assert.deepEqual(toD1Assignment({ enabled: false, opensAt: null, closesAt: null }), { habilitada: 0, disponibleDesde: null, disponibleHasta: null });
});

test("emite los warnings de política con historia sin bloquear", () => {
  const now = "2026-09-29T12:00:00.000Z";
  const history = (overrides: Partial<AssignmentHistory> = {}): AssignmentHistory => ({ drafts: 0, submitted: 0, annulled: 0, ...overrides });
  const codes = (issues: ReturnType<typeof historyWarnings>) => issues.map((issue) => issue.code);
  const none: AssignmentState = { enabled: true, opensAt: null, closesAt: null };
  const disabled: AssignmentState = { enabled: false, opensAt: null, closesAt: null };

  assert.deepEqual(codes(historyWarnings(none, none, history(), now)), []);

  const disableDrafts = historyWarnings(none, disabled, history({ drafts: 2 }), now);
  assert.deepEqual(codes(disableDrafts), ["DISABLE_WITH_DRAFTS"]);
  assert.ok(disableDrafts.every((issue) => issue.severity === "warning"));

  assert.deepEqual(codes(historyWarnings(none, disabled, history({ drafts: 1, submitted: 3 }), now)), ["DISABLE_WITH_DRAFTS", "DISABLE_WITH_SUBMITTED"]);
  assert.deepEqual(codes(historyWarnings(disabled, disabled, history({ submitted: 3 }), now)), [], "sin cambio de habilitación no corresponde el warning de deshabilitar");
  assert.deepEqual(
    codes(historyWarnings(none, { enabled: true, opensAt: "2026-10-01T11:00:00.000Z", closesAt: null }, history({ drafts: 1 }), now)),
    ["OPENING_IN_FUTURE_WITH_DRAFTS"],
  );
  assert.deepEqual(
    codes(historyWarnings({ enabled: true, opensAt: null, closesAt: "2026-09-20T00:00:00.000Z" }, none, history(), now)),
    ["REOPENING_CLOSED_ASSIGNMENT"],
  );
  assert.deepEqual(
    codes(historyWarnings({ enabled: true, opensAt: null, closesAt: "2026-10-10T00:00:00.000Z" }, { enabled: true, opensAt: null, closesAt: "2026-09-29T00:00:00.000Z" }, history({ drafts: 1 }), now)),
    ["CLOSING_EARLY_WITH_DRAFTS"],
  );
  assert.deepEqual(
    codes(historyWarnings({ enabled: true, opensAt: OPEN_UTC, closesAt: null }, none, history({ submitted: 1 }), now)),
    ["WINDOW_REMOVED_WITH_HISTORY"],
  );
  assert.deepEqual(codes(historyWarnings({ enabled: true, opensAt: OPEN_UTC, closesAt: null }, none, history(), now)), [], "sin historia no hay warning al quitar la ventana");
});
