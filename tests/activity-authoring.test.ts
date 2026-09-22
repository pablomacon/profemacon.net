import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPublicProjection,
  canonicalJsonEqual,
  parseActivityDocument,
  selfCheckGrading,
  selfCheckWithGrader,
  type ParseResult,
} from "../worker/activity-authoring.ts";

type Json = Record<string, unknown>;

const asParsed = (value: Json) => value as unknown as Parameters<typeof selfCheckWithGrader>[0];

function document(): Json {
  return {
    schemaVersion: 1,
    activity: {
      slug: "actividad-prueba-01",
      title: "Actividad de prueba",
      description: "Descripción de prueba",
      topic: "Tema de prueba",
      unitCode: "unidad-1",
      order: 1,
      edition: { subjectCode: "programacion-prueba", year: 2026 },
      maxAttempts: 2,
      showReview: true,
      approvalThreshold: 50,
      achievementThreshold: 76,
      editorialState: "draft",
    },
    questions: [
      {
        number: 1,
        type: "radio",
        prompt: "¿Qué opción es correcta?",
        instructions: "Elegí una.",
        points: 2,
        options: [
          { value: "a", text: "Opción A" },
          { value: "b", text: "Opción B" },
          { value: "c", text: "Opción C" },
        ],
        grading: { mode: "single", correct: "a" },
        explanation: "Explicación de prueba de la primera pregunta.",
      },
      {
        number: 2,
        type: "checkbox",
        prompt: "Seleccioná las correctas.",
        points: 3,
        options: [
          { value: "x", text: "Opción X" },
          { value: "y", text: "Opción Y" },
          { value: "z", text: "Opción Z" },
        ],
        grading: { mode: "exact-selection", correct: ["z", "x"] },
        explanation: "Explicación de prueba de la segunda pregunta.",
        feedback: { whenCorrect: "Muy bien.", whenIncorrect: "Repasá el tema." },
      },
      {
        number: 3,
        type: "text",
        prompt: "Escribí la respuesta.",
        points: 2,
        placeholder: "Escribí acá",
        grading: { mode: "accepted-text", accepted: ["valor-ficticio"], trim: true, caseSensitive: true },
        explanation: "Explicación de prueba de la tercera pregunta.",
        resources: [
          { type: "code", language: "java", content: "int x = 1;", title: "Ejemplo" },
          { type: "image", src: "/actividades/prueba/q3.webp", alt: "Imagen de prueba con texto alternativo suficiente" },
        ],
      },
    ],
    tags: ["prueba", "autoría"],
    authoring: { createdBy: "prueba-automatica", version: 2, notes: "Documento ficticio de prueba." },
  };
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function firstQuestion(doc: Json): Json {
  return (doc.questions as Json[])[0];
}

function expectIssue(doc: unknown, code: string, severity: "error" | "warning" = "error"): ParseResult {
  const result = parseActivityDocument(doc);
  const found = result.issues.filter((issue) => issue.code === code && issue.severity === severity);
  assert.ok(found.length > 0, `Se esperaba ${severity} ${code}; se obtuvo: ${result.issues.map((issue) => `${issue.severity}:${issue.code}`).join(", ") || "ninguno"}`);
  if (severity === "error") {
    assert.equal(result.ok, false, "El documento con errores no debe considerarse publicable");
    assert.equal(result.parsed, null);
  }
  return result;
}

test("acepta un documento válido y traduce el grading a la clave privada real", () => {
  const result = parseActivityDocument(document());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const parsed = result.parsed!;
  assert.equal(parsed.activity.slug, "actividad-prueba-01");
  assert.equal(parsed.activity.estado, "borrador");
  assert.equal(parsed.totalPoints, 7);
  assert.equal(parsed.questions.length, 3);

  assert.equal(parsed.questions[0].claveCorreccionJson, JSON.stringify({ modo: "opcion", correctas: ["a"] }));
  assert.equal(parsed.questions[1].claveCorreccionJson, JSON.stringify({ modo: "seleccion-exacta", correctas: ["x", "z"] }));
  assert.equal(parsed.questions[2].claveCorreccionJson, JSON.stringify({ modo: "texto-exacto", aceptadas: ["valor-ficticio"] }));

  assert.equal(parsed.questions[0].opcionesJson, JSON.stringify([
    { valor: "a", texto: "Opción A" }, { valor: "b", texto: "Opción B" }, { valor: "c", texto: "Opción C" },
  ]));
  assert.equal(parsed.questions[1].retroalimentacionCorrecta, "Muy bien.");
  assert.equal(parsed.questions[2].placeholder, "Escribí acá");
  assert.equal(parsed.questions[2].recursosJson, JSON.stringify([
    { type: "code", language: "java", content: "int x = 1;", title: "Ejemplo" },
    { type: "image", src: "/actividades/prueba/q3.webp", alt: "Imagen de prueba con texto alternativo suficiente" },
  ]));
  assert.equal(parsed.questions[2].explicacionRevisionFinal, "Explicación de prueba de la tercera pregunta.");
  assert.equal(parsed.activity.tema, "Tema de prueba");
});

test("la proyección pública no contiene material privado", () => {
  const projection = parseActivityDocument(document()).parsed!.publicDocument;
  assert.deepEqual(assertPublicProjection(projection), []);
  const serialized = JSON.stringify(projection);
  assert.equal(serialized.includes("grading"), false);
  assert.equal(serialized.includes("valor-ficticio"), false, "la proyección nunca debe exponer valores aceptados");
  assert.equal(serialized.includes("clave_correccion"), false);
  assert.deepEqual((projection.questions[1] as Json).feedback, { whenCorrect: "Muy bien.", whenIncorrect: "Repasá el tema." });
});

test("detecta claves privadas dentro de un documento público", () => {
  const projection = parseActivityDocument(document()).parsed!.publicDocument as unknown as Json;
  const tampered = clone(projection);
  (firstQuestion(tampered) as Json).grading = { mode: "single", correct: "a" };
  const issues = assertPublicProjection(tampered);
  assert.ok(issues.some((issue) => issue.code === "PRIVATE_KEY_IN_PUBLIC_DOCUMENT"));
  assert.ok(issues.every((issue) => issue.severity === "error"));
});

test("rechaza schemaVersion desconocida y claves fuera del contrato", () => {
  const badVersion = clone(document());
  badVersion.schemaVersion = 2;
  expectIssue(badVersion, "UNSUPPORTED_SCHEMA_VERSION");

  const withInstructions = clone(document());
  withInstructions.instructions = "Instrucciones generales que no se persisten";
  expectIssue(withInstructions, "UNKNOWN_KEY");

  const withActivityTotal = clone(document());
  (withActivityTotal.activity as Json).totalPoints = 7;
  expectIssue(withActivityTotal, "UNKNOWN_KEY");

  const withQuestionExtra = clone(document());
  (firstQuestion(withQuestionExtra) as Json).hint = "pista";
  expectIssue(withQuestionExtra, "UNKNOWN_KEY");

  const withGradingExtra = clone(document());
  ((firstQuestion(withGradingExtra) as Json).grading as Json).partial = true;
  expectIssue(withGradingExtra, "UNKNOWN_KEY");

  const withResourceLevelResources = clone(document());
  withResourceLevelResources.resources = [{ type: "image", src: "/x.webp", alt: "Texto alternativo suficiente" }];
  expectIssue(withResourceLevelResources, "UNKNOWN_KEY");
});

test("rechaza identificadores, edición y metadata inválidos", () => {
  const badSlug = clone(document());
  (badSlug.activity as Json).slug = "Actividad Prueba";
  expectIssue(badSlug, "INVALID_SLUG");

  const badUnit = clone(document());
  (badUnit.activity as Json).unitCode = "Unidad 1";
  expectIssue(badUnit, "INVALID_UNIT_CODE");

  const badYear = clone(document());
  ((badYear.activity as Json).edition as Json).year = 1999;
  expectIssue(badYear, "INVALID_YEAR");

  const badYearType = clone(document());
  ((badYearType.activity as Json).edition as Json).year = "2026";
  expectIssue(badYearType, "INVALID_YEAR");

  const badOrder = clone(document());
  (badOrder.activity as Json).order = 0;
  expectIssue(badOrder, "INVALID_ORDER");

  const missingAuthoring = clone(document());
  delete missingAuthoring.authoring;
  expectIssue(missingAuthoring, "MISSING_FIELD");

  const missingTitle = clone(document());
  delete (missingTitle.activity as Json).title;
  expectIssue(missingTitle, "MISSING_FIELD");

  const missingSchemaVersion = clone(document());
  delete missingSchemaVersion.schemaVersion;
  expectIssue(missingSchemaVersion, "MISSING_FIELD");

  const missingQuestions = clone(document());
  delete missingQuestions.questions;
  expectIssue(missingQuestions, "MISSING_FIELD");

  const emptyCreatedBy = clone(document());
  (emptyCreatedBy.authoring as Json).createdBy = "";
  expectIssue(emptyCreatedBy, "INVALID_LENGTH");

  const manyTags = clone(document());
  manyTags.tags = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
  expectIssue(manyTags, "INVALID_TAGS");

  const badTag = clone(document());
  badTag.tags = ["Etiqueta Inválida"];
  expectIssue(badTag, "INVALID_FORMAT");

  const badGeneratedAt = clone(document());
  (badGeneratedAt.authoring as Json).generatedAt = "22/09/2026";
  expectIssue(badGeneratedAt, "INVALID_FORMAT");
});

test("rechaza puntajes, umbrales y cantidad de intentos inválidos", () => {
  for (const points of [0, -1, 101]) {
    const doc = clone(document());
    (firstQuestion(doc) as Json).points = points;
    expectIssue(doc, "INVALID_POINTS");
  }
  const fractionalPoints = clone(document());
  (firstQuestion(fractionalPoints) as Json).points = 1.5;
  expectIssue(fractionalPoints, "INVALID_POINTS");

  const badThresholds = clone(document());
  (badThresholds.activity as Json).approvalThreshold = 90;
  (badThresholds.activity as Json).achievementThreshold = 80;
  expectIssue(badThresholds, "INVALID_THRESHOLDS");

  const badAttempts = clone(document());
  (badAttempts.activity as Json).maxAttempts = 0;
  expectIssue(badAttempts, "INVALID_MAX_ATTEMPTS");

  const badApprovalRange = clone(document());
  (badApprovalRange.activity as Json).approvalThreshold = 120;
  expectIssue(badApprovalRange, "INVALID_THRESHOLDS");

  const badState = clone(document());
  (badState.activity as Json).editorialState = "publicada";
  expectIssue(badState, "INVALID_EDITORIAL_STATE");

  const noQuestions = clone(document());
  noQuestions.questions = [];
  expectIssue(noQuestions, "NO_QUESTIONS");
});

const checkboxQuestion = (doc: Json): Json => (doc.questions as Json[])[1];
const textQuestion = (doc: Json): Json => (doc.questions as Json[])[2];
const resourceOf = (doc: Json, index: number): Json => ((textQuestion(doc).resources as Json[])[index]);

test("rechaza numeración, tipos y opciones inválidas", () => {
  const duplicated = clone(document());
  ((duplicated.questions as Json[])[1] as Json).number = 1;
  expectIssue(duplicated, "DUPLICATE_QUESTION_NUMBER");
  expectIssue(duplicated, "QUESTION_ORDER");

  const unsupported = clone(document());
  (firstQuestion(unsupported) as Json).type = "ordenar";
  expectIssue(unsupported, "UNSUPPORTED_TYPE");

  const missingOptions = clone(document());
  delete (firstQuestion(missingOptions) as Json).options;
  expectIssue(missingOptions, "OPTIONS_REQUIRED");

  const oneOption = clone(document());
  (firstQuestion(oneOption).options as Json[]).splice(1);
  expectIssue(oneOption, "TOO_FEW_OPTIONS");

  const duplicatedValues = clone(document());
  ((firstQuestion(duplicatedValues) as Json).options as Json[])[1].value = "a";
  expectIssue(duplicatedValues, "DUPLICATE_OPTION_VALUE");

  const untrimmedValue = clone(document());
  ((firstQuestion(untrimmedValue) as Json).options as Json[])[0].value = " a";
  expectIssue(untrimmedValue, "INVALID_OPTION_VALUE");

  const textWithOptions = clone(document());
  (textQuestion(textWithOptions) as Json).options = [{ value: "a", text: "Opción A" }];
  expectIssue(textWithOptions, "OPTIONS_NOT_ALLOWED");

  const radioWithPlaceholder = clone(document());
  (firstQuestion(radioWithPlaceholder) as Json).placeholder = "Escribí";
  expectIssue(radioWithPlaceholder, "PLACEHOLDER_NOT_ALLOWED");
});

test("rechaza combinaciones incompatibles entre tipo y grading", () => {
  const missingGrading = clone(document());
  delete (firstQuestion(missingGrading) as Json).grading;
  expectIssue(missingGrading, "GRADING_REQUIRED");

  const radioWithCheckboxMode = clone(document());
  (firstQuestion(radioWithCheckboxMode) as Json).grading = { mode: "exact-selection", correct: ["a"] };
  expectIssue(radioWithCheckboxMode, "GRADING_MODE_MISMATCH");

  const checkboxWithRadioMode = clone(document());
  (checkboxQuestion(checkboxWithRadioMode) as Json).grading = { mode: "single", correct: "x" };
  expectIssue(checkboxWithRadioMode, "GRADING_MODE_MISMATCH");

  const textWithRadioMode = clone(document());
  (textQuestion(textWithRadioMode) as Json).grading = { mode: "single", correct: "a" };
  expectIssue(textWithRadioMode, "GRADING_MODE_MISMATCH");

  const radioNotFound = clone(document());
  ((firstQuestion(radioNotFound) as Json).grading as Json).correct = "zzz";
  expectIssue(radioNotFound, "RADIO_CORRECT_NOT_FOUND");

  const checkboxNotFound = clone(document());
  ((checkboxQuestion(checkboxNotFound) as Json).grading as Json).correct = ["x", "no-existe"];
  expectIssue(checkboxNotFound, "CHECKBOX_CORRECT_NOT_FOUND");

  const checkboxEmpty = clone(document());
  ((checkboxQuestion(checkboxEmpty) as Json).grading as Json).correct = [];
  expectIssue(checkboxEmpty, "CHECKBOX_NO_CORRECT");

  const checkboxDuplicated = clone(document());
  ((checkboxQuestion(checkboxDuplicated) as Json).grading as Json).correct = ["x", "x"];
  expectIssue(checkboxDuplicated, "CHECKBOX_DUPLICATE_CORRECT");
});

test("rechaza gradings de texto incompatibles con el corrector actual", () => {
  const noAccepted = clone(document());
  delete ((textQuestion(noAccepted) as Json).grading as Json).accepted;
  expectIssue(noAccepted, "TEXT_NO_ACCEPTED");

  const emptyAccepted = clone(document());
  ((textQuestion(emptyAccepted) as Json).grading as Json).accepted = [];
  expectIssue(emptyAccepted, "TEXT_NO_ACCEPTED");

  const duplicatedAccepted = clone(document());
  ((textQuestion(duplicatedAccepted) as Json).grading as Json).accepted = ["int", "int"];
  expectIssue(duplicatedAccepted, "TEXT_DUPLICATE_ACCEPTED");

  const untrimmedAccepted = clone(document());
  ((textQuestion(untrimmedAccepted) as Json).grading as Json).accepted = [" int"];
  expectIssue(untrimmedAccepted, "TEXT_ACCEPTED_INVALID");

  const tooManyAccepted = clone(document());
  ((textQuestion(tooManyAccepted) as Json).grading as Json).accepted = Array.from({ length: 21 }, (_, index) => `variante-${index}`);
  expectIssue(tooManyAccepted, "TEXT_ACCEPTED_TOO_MANY");

  const trimFalse = clone(document());
  ((textQuestion(trimFalse) as Json).grading as Json).trim = false;
  expectIssue(trimFalse, "GRADING_FLAG_UNSUPPORTED");

  const caseInsensitive = clone(document());
  ((textQuestion(caseInsensitive) as Json).grading as Json).caseSensitive = false;
  expectIssue(caseInsensitive, "GRADING_FLAG_UNSUPPORTED");
});

test("rechaza recursos inválidos", () => {
  const unknownType = clone(document());
  resourceOf(unknownType, 0).type = "video";
  expectIssue(unknownType, "RESOURCE_INVALID");

  const remoteSource = clone(document());
  resourceOf(remoteSource, 1).src = "https://example.test/imagen.webp";
  expectIssue(remoteSource, "RESOURCE_INVALID");

  const traversingSource = clone(document());
  resourceOf(traversingSource, 1).src = "/actividades/../../secreto.webp";
  expectIssue(traversingSource, "RESOURCE_INVALID");

  const missingAlt = clone(document());
  delete resourceOf(missingAlt, 1).alt;
  expectIssue(missingAlt, "MISSING_FIELD");

  const badLanguage = clone(document());
  resourceOf(badLanguage, 0).language = "cobol";
  expectIssue(badLanguage, "RESOURCE_INVALID");

  const emptyContent = clone(document());
  resourceOf(emptyContent, 0).content = "";
  expectIssue(emptyContent, "INVALID_LENGTH");
});

test("emite las advertencias pedagógicas acordadas sin bloquear", () => {
  const twoOptions = clone(document());
  (firstQuestion(twoOptions).options as Json[]).splice(2);
  expectIssue(twoOptions, "CHOICE_FEW_OPTIONS", "warning");

  const allCorrect = clone(document());
  ((checkboxQuestion(allCorrect) as Json).grading as Json).correct = ["x", "y", "z"];
  expectIssue(allCorrect, "CHECKBOX_ALL_CORRECT", "warning");

  const repeatedText = clone(document());
  ((firstQuestion(repeatedText) as Json).options as Json[])[1].text = "Opción A";
  expectIssue(repeatedText, "DUPLICATE_OPTION_TEXT", "warning");

  const longPrompt = clone(document());
  (firstQuestion(longPrompt) as Json).prompt = "a".repeat(700);
  expectIssue(longPrompt, "LONG_PROMPT", "warning");

  const manyAccepted = clone(document());
  ((textQuestion(manyAccepted) as Json).grading as Json).accepted = ["uno", "dos", "tres", "cuatro"];
  expectIssue(manyAccepted, "TEXT_MANY_ACCEPTED", "warning");

  const unbalanced = clone(document());
  (checkboxQuestion(unbalanced) as Json).points = 40;
  expectIssue(unbalanced, "UNBALANCED_POINTS", "warning");

  const highAttempts = clone(document());
  (highAttempts.activity as Json).maxAttempts = 7;
  expectIssue(highAttempts, "HIGH_MAX_ATTEMPTS", "warning");

  const equalThresholds = clone(document());
  (equalThresholds.activity as Json).achievementThreshold = 50;
  expectIssue(equalThresholds, "THRESHOLD_EDGE", "warning");

  const noExplanation = clone(document());
  delete (firstQuestion(noExplanation) as Json).explanation;
  expectIssue(noExplanation, "EXPLANATION_MISSING", "warning");

  const valid = parseActivityDocument(document());
  assert.ok(valid.issues.some((issue) => issue.code === "RESOURCES_NOT_RENDERED" && issue.severity === "warning"));
  assert.ok(valid.issues.some((issue) => issue.code === "METADATA_ONLY_FIELDS" && issue.severity === "note"));
  assert.equal(valid.ok, true, "las advertencias no impiden publicar");
});

test("la auto-prueba con el corrector real detecta claves inválidas y respuestas desalineadas", () => {
  assert.equal(parseActivityDocument(document()).ok, true);

  const brokenKey = selfCheckGrading([{ numero: 1, tipo: "radio", puntaje: 2, claveCorreccionJson: JSON.stringify({ modo: "texto-exacto", aceptadas: ["x"] }), answer: "x" }]);
  assert.deepEqual(brokenKey.map((issue) => issue.code), ["GRADING_KEY_INVALID"]);

  const wrongAnswer = selfCheckGrading([{ numero: 1, tipo: "radio", puntaje: 2, claveCorreccionJson: JSON.stringify({ modo: "opcion", correctas: ["a"] }), answer: "b" }]);
  assert.deepEqual(wrongAnswer.map((issue) => issue.code), ["GRADING_SELF_CHECK_FAILED"]);

  const nullKey = selfCheckGrading([{ numero: 1, tipo: "checkbox", puntaje: 1, claveCorreccionJson: "no-json", answer: ["a"] }]);
  assert.deepEqual(nullKey.map((issue) => issue.code), ["GRADING_KEY_INVALID"]);

  const validKey = selfCheckGrading([{ numero: 1, tipo: "text", puntaje: 3, claveCorreccionJson: JSON.stringify({ modo: "texto-exacto", aceptadas: ["valor"] }), answer: "valor" }]);
  assert.deepEqual(validKey, []);
});

test("selfCheckWithGrader valida un documento ya materializado sin exponer la clave", () => {
  const parsed = parseActivityDocument(document()).parsed!;
  assert.deepEqual(selfCheckWithGrader(parsed), [], "un documento válido debe autocorregirse completo");

  const tampered = clone(parsed as unknown as Json);
  (tampered.questions as Json[])[0] = {
    ...(tampered.questions as Json[])[0],
    tipo: "radio",
    claveCorreccionJson: JSON.stringify({ modo: "texto-exacto", aceptadas: ["x"] }),
  };
  const issues = selfCheckWithGrader(asParsed(tampered));
  assert.deepEqual(issues.map((issue) => issue.code), ["GRADING_KEY_INVALID"]);
  assert.equal(JSON.stringify(issues).includes("texto-exacto"), false, "el informe nunca expone la clave");
});

test("la comparación canónica ignora el orden de las claves y detecta diferencias reales", () => {
  const parsed = parseActivityDocument(document()).parsed!;
  const reordered = JSON.parse(JSON.stringify({ authoring: parsed.publicDocument.authoring, ...parsed.publicDocument })) as Json;
  assert.equal(canonicalJsonEqual(parsed.publicDocument, reordered), true);

  const changed = clone(document());
  (firstQuestion(changed) as Json).points = 3;
  const other = parseActivityDocument(changed).parsed!;
  assert.equal(canonicalJsonEqual(parsed.questions, other.questions), false);

  const same = parseActivityDocument(document()).parsed!;
  assert.equal(canonicalJsonEqual(parsed.questions, same.questions), true);
});