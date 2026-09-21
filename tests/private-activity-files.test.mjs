import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

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
