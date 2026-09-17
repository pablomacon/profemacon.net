import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDocument, parsePortfolioFilename, splitStudentName, usernameBase } from "../scripts/student-portfolio.mjs";

test("extrae asignatura, grupo, año y fecha del nombre del portafolio", () => {
  assert.deepEqual(parsePortfolioFilename("Portafolio_PROGRAMACION_Grupo_1__MG_2025_2025-11-24.xlsx"), {
    filename: "Portafolio_PROGRAMACION_Grupo_1__MG_2025_2025-11-24.xlsx",
    subjectLabel: "PROGRAMACION",
    groupSourceLabel: "Grupo_1__MG",
    groupDisplayLabel: "Grupo 1 · MG",
    academicYear: 2025,
    exportDate: "2025-11-24",
  });
});

test("separa apellidos y nombres usando una única coma", () => {
  assert.deepEqual(splitStudentName("Pérez Gómez, Ana María"), {
    surnames: "Pérez Gómez",
    givenNames: "Ana María",
    displayName: "Ana María Pérez Gómez",
  });
  assert.throws(() => splitStudentName("Ana María Pérez Gómez"), /exactamente una coma/);
});

test("normaliza documentos sin convertirlos en números", () => {
  assert.equal(normalizeDocument("0.123.456-7"), "01234567");
  assert.equal(normalizeDocument(" ar 123-xy "), "AR123XY");
});

test("genera una base legible sin usar el documento", () => {
  assert.equal(usernameBase("Ana María", "de los Santos Pérez"), "ana.santos");
});

