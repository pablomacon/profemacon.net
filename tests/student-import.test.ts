import assert from "node:assert/strict";
import test from "node:test";
import { documentHmac, finalImportedUsername, importedUsernameBase, normalizeImportDocument, normalizeSourceLabel, readStudentImportBody, StudentImportError } from "../worker/student-import.ts";

const secret = "clave-ficticia-de-pruebas-con-mas-de-32-caracteres";

test("normaliza etiquetas, documentos y bases de usuario sin revelar el documento", () => {
  assert.equal(normalizeSourceLabel("  Programación   I "), "programacion i");
  assert.equal(normalizeImportDocument(" 1.234-567 8 "), "12345678");
  assert.equal(importedUsernameBase("Ana María", "de los Santos Pérez"), "ana.santos");
});

test("la huella documental es estable y el usuario usa solo un sufijo no reversible", async () => {
  const first = await documentHmac(secret, "cedula_uy", "UY", "12345678");
  const repeated = await documentHmac(secret, "cedula_uy", "UY", "12345678");
  const other = await documentHmac(secret, "cedula_uy", "UY", "87654321");

  assert.equal(first, repeated);
  assert.notEqual(first, other);
  assert.match(first, /^[a-f0-9]{64}$/);
  const username = finalImportedUsername("Ana María", "de los Santos Pérez", first);
  assert.match(username, /^ana\.santos\.[a-f0-9]{12}$/);
  assert.equal(username.includes("12345678"), false);
});

test("exige confirmar tipo y país del documento antes de previsualizar", async () => {
  const request = new Request("https://example.test/api/student-imports/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: {
        filename: "Portafolio_PROGRAMACION_DEMO_Grupo_DEMO__A_2026_2026-03-01.xlsx",
        subjectLabel: "PROGRAMACION DEMO",
        groupSourceLabel: "Grupo DEMO A",
        academicYear: 2026,
        fileSha256: "a".repeat(64),
      },
      students: [{ sourceRow: 2, givenNames: "Persona", surnames: "Ficticia", document: "12345678" }],
    }),
  });

  await assert.rejects(() => readStudentImportBody(request), (error: unknown) => {
    assert.ok(error instanceof StudentImportError);
    assert.match(error.message, /confirmarse el tipo/);
    return true;
  });
});

test("acepta un lote ficticio completo y conserva el documento solo en memoria", async () => {
  const request = new Request("https://example.test/api/student-imports/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: {
        filename: "Portafolio_PROGRAMACION_DEMO_Grupo_DEMO__A_2026_2026-03-01.xlsx",
        subjectLabel: "PROGRAMACION DEMO",
        groupSourceLabel: "Grupo DEMO A",
        academicYear: 2026,
        fileSha256: "b".repeat(64),
        rejectedRows: 0,
      },
      students: [{
        sourceRow: 2,
        givenNames: "Persona",
        surnames: "Ficticia",
        document: "AB-12345",
        documentType: "pasaporte",
        countryCode: "AR",
      }],
    }),
  });

  const payload = await readStudentImportBody(request);
  assert.equal(payload.students[0].document, "AB12345");
  assert.equal(payload.students[0].countryCode, "AR");
});
