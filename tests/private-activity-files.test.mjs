import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertPublicProjection } from "../worker/activity-authoring.ts";

const repositoryFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
).split("\0").filter(Boolean);

const privatePathPatterns = [
  /(^|\/)private\//i,
  /(^|\/)(claves?|answers?|respuestas?|solutions?|correction-keys?)[^/]*(\.[^/]+)?$/i,
  /\.private\.[^/]+$/i,
];

const privateStructurePatterns = [
  /respuesta correcta\s*:\s*(?:["'`]|[a-z0-9])/i,
  /\bconst\s+correct\s*=/i,
  /"modo"\s*:\s*"(?:opcion|seleccion-exacta|texto-exacto)"/i,
];

const containsPrivateStructure = (source) => {
  if (privateStructurePatterns.some((pattern) => pattern.test(source))) return true;
  const assignedValues = [
    ...source.matchAll(/clave_correccion_json\s*=\s*([^,;\r\n]+)/gi),
    ...source.matchAll(/claveCorreccionJson\s*:\s*([^,}\r\n]+)/g),
  ];
  return assignedValues.some((match) => match[1].trim().toLowerCase() !== "null");
};

// La proyección pública que produce el pipeline de autoría nunca debe contener
// material de corrección. Se revisan sus claves JSON y, además, su estructura.
const authoringCanonicalPatterns = [
  /"(?:grading|correct|accepted)"\s*:/i,
  /"(?:modo|correctas|aceptadas)"\s*:/i,
  /clave_correccion/i,
];

test("no hay archivos de claves privadas candidatos a incorporarse a Git", () => {
  const unsafe = repositoryFiles.filter((path) => privatePathPatterns.some((pattern) => pattern.test(path)));
  assert.deepEqual(unsafe, [], `Se detectaron rutas reservadas para material privado: ${unsafe.join(", ")}`);
});

test("los archivos públicos no contienen estructuras de corrección", () => {
  const publicSources = repositoryFiles.filter((path) => /^(src|content|public|seed)\//.test(path));
  const unsafe = publicSources.filter((path) => {
    const source = readFileSync(path, "utf8");
    return containsPrivateStructure(source);
  });

  assert.deepEqual(unsafe, [], `Se detectaron estructuras privadas en archivos públicos: ${unsafe.join(", ")}`);
});

test("permite referencias nulas y detecta asignaciones privadas sin imprimir su contenido", () => {
  assert.equal(containsPrivateStructure("clave_correccion_json = NULL"), false);
  assert.equal(containsPrivateStructure("claveCorreccionJson: null"), false);
  assert.equal(containsPrivateStructure("clave_correccion_json = '{dato-ficticio}'"), true);
  assert.equal(containsPrivateStructure("<strong>Respuesta correcta:</strong> {question.correctAnswer}"), false);
  assert.equal(containsPrivateStructure("Respuesta correcta: valor-privado"), true);
});

test("las proyecciones públicas de authoring no contienen material de corrección", () => {
  const authoringJson = repositoryFiles.filter((path) => /^authoring\/.*\.json$/.test(path));
  const unsafe = [];
  for (const path of authoringJson) {
    const source = readFileSync(path, "utf8");
    if (authoringCanonicalPatterns.some((pattern) => pattern.test(source))) {
      unsafe.push(`${path} (patrón de corrección)`);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(source);
    } catch {
      unsafe.push(`${path} (JSON inválido)`);
      continue;
    }
    if (assertPublicProjection(parsed).length > 0) unsafe.push(`${path} (estructura privada)`);
  }

  assert.deepEqual(unsafe, [], `Se detectó material privado en proyecciones públicas: ${unsafe.join(", ")}`);
});
