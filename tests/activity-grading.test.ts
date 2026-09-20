import assert from "node:assert/strict";
import test from "node:test";
import { gradeActivity, publicCorrectAnswerForReview, type ActivityQuestionForGrading } from "../worker/activity-grading.ts";

const question = (
  overrides: Partial<ActivityQuestionForGrading> = {},
): ActivityQuestionForGrading => ({
  id: 1,
  numero: 1,
  tipo: "radio",
  puntaje: 1,
  claveCorreccionJson: JSON.stringify({ modo: "opcion", correctas: ["opcion-b"] }),
  retroalimentacionCorrecta: "Concepto comprendido.",
  retroalimentacionIncorrecta: "Revisá el concepto.",
  ...overrides,
});

test("corrige respuestas radio correctas e incorrectas", () => {
  const correct = gradeActivity([question()], { 1: "opcion-b" });
  const incorrect = gradeActivity([question()], { 1: "opcion-a" });

  assert.equal(correct.gradedAnswers[0].correcta, true);
  assert.equal(correct.gradedAnswers[0].puntajeObtenido, 1);
  assert.equal(incorrect.gradedAnswers[0].correcta, false);
  assert.equal(incorrect.gradedAnswers[0].puntajeObtenido, 0);
});

test("corrige texto exacto correcto e incorrecto", () => {
  const textQuestion = question({
    tipo: "text",
    claveCorreccionJson: JSON.stringify({ modo: "texto-exacto", aceptadas: ["valor ficticio", "alternativa ficticia"] }),
  });

  assert.equal(gradeActivity([textQuestion], { 1: " valor ficticio " }).gradedAnswers[0].correcta, true);
  assert.equal(gradeActivity([textQuestion], { 1: "otro valor" }).gradedAnswers[0].correcta, false);
});

test("checkbox exige una selección exacta y rechaza duplicados", () => {
  const checkboxQuestion = question({
    tipo: "checkbox",
    claveCorreccionJson: JSON.stringify({ modo: "seleccion-exacta", correctas: ["item-a", "item-c"] }),
  });

  assert.equal(gradeActivity([checkboxQuestion], { 1: ["item-c", "item-a"] }).gradedAnswers[0].correcta, true);
  assert.equal(gradeActivity([checkboxQuestion], { 1: ["item-a", "item-a", "item-c"] }).gradedAnswers[0].correcta, false);
});

test("checkbox no descarta valores inválidos hasta convertirlos en una respuesta correcta", () => {
  const checkboxQuestion = question({
    tipo: "checkbox",
    claveCorreccionJson: JSON.stringify({ modo: "seleccion-exacta", correctas: ["item-a"] }),
  });

  for (const malformed of [["item-a", ""], ["item-a", 7], "item-a", null]) {
    const result = gradeActivity([checkboxQuestion], { 1: malformed });
    assert.equal(result.gradedAnswers[0].correcta, false);
    assert.equal(result.gradedAnswers[0].respuestaNormalizada, null);
  }
});

test("una respuesta vacía se califica como incorrecta", () => {
  const result = gradeActivity([question()], {});
  assert.equal(result.gradedAnswers[0].respuestaDada, null);
  assert.equal(result.gradedAnswers[0].correcta, false);
});

test("rechaza una clave inexistente o malformada sin revelar su contenido", () => {
  assert.throws(() => gradeActivity([question({ claveCorreccionJson: null })], {}), /no tiene una clave privada/);
  assert.throws(() => gradeActivity([question({ claveCorreccionJson: "{dato ficticio" })], {}), /clave privada de corrección inválida/);
});

test("rechaza combinaciones incompatibles entre tipo y modo", () => {
  const incompatible = question({
    tipo: "radio",
    claveCorreccionJson: JSON.stringify({ modo: "texto-exacto", aceptadas: ["dato ficticio"] }),
  });
  assert.throws(() => gradeActivity([incompatible], {}), /tipo y una clave de corrección incompatibles/);
});

test("calcula puntaje total y porcentaje redondeado", () => {
  const questions = [
    question({ id: 1, numero: 1, puntaje: 2 }),
    question({ id: 2, numero: 2, puntaje: 1, claveCorreccionJson: JSON.stringify({ modo: "opcion", correctas: ["opcion-d"] }) }),
  ];
  const result = gradeActivity(questions, { 1: "opcion-b", 2: "opcion-a" });

  assert.equal(result.score, 2);
  assert.equal(result.total, 3);
  assert.equal(result.percentage, 67);
});

test("rechaza una actividad sin preguntas", () => {
  assert.throws(() => gradeActivity([], {}), /no contiene preguntas/);
});

test("rechaza puntajes no positivos, no finitos o fuera del rango seguro", () => {
  for (const invalidScore of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, 1.5]) {
    assert.throws(
      () => gradeActivity([question({ puntaje: invalidScore })], { 1: "opcion-b" }),
      /puntaje inválido/,
    );
  }
});

test("rechaza un total que deja de ser un entero seguro", () => {
  const large = Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1;
  assert.throws(
    () => gradeActivity([
      question({ id: 1, numero: 1, puntaje: large }),
      question({ id: 2, numero: 2, puntaje: large }),
    ], {}),
    /puntaje total inválido/,
  );
});

test("transforma la clave privada en una respuesta pedagógica sin exponer su modo", () => {
  assert.deepEqual(publicCorrectAnswerForReview(question()), { value: "opcion-b" });
  assert.deepEqual(publicCorrectAnswerForReview(question({
    tipo: "text",
    claveCorreccionJson: JSON.stringify({ modo: "texto-exacto", aceptadas: ["valor ficticio"] }),
  })), { values: ["valor ficticio"] });
  assert.deepEqual(publicCorrectAnswerForReview(question({
    tipo: "checkbox",
    claveCorreccionJson: JSON.stringify({ modo: "seleccion-exacta", correctas: ["item-c", "item-a"] }),
  })), { values: ["item-a", "item-c"] });
});
