// Barrera de privacidad y seguridad para materiales teóricos (Hito 6D-A).
//
// Unidad 0 y Unidad 1 son material legacy: esta barrera NO les exige el contrato
// v1. Sólo los archivos con `schemaVersion: 1` se validan por completo.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";
import {
  detectMaterialDocumentKind,
  isMaterialV1Document,
  parseMaterialDocument,
} from "../worker/material-authoring.ts";

const projectRoot = process.cwd();

const repositoryFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
).split("\0").filter(Boolean).map((path) => path.split("\\").join("/"));

// Rutas que jamás deben entrar al repositorio: fuentes privadas, borradores y
// copias accidentales de la carpeta de autoría.
const privatePathPatterns = [
  /(^|\/)fuentes\//i,
  /(^|\/)private\//i,
  /(^|\/)materials\//i,
  /profemacon-authoring-private\//i,
  /\.private\.[^/]+$/i,
];

const unsafePatterns = [
  { pattern: /<script/i, label: "<script" },
  { pattern: /<iframe/i, label: "<iframe" },
  { pattern: /javascript:/i, label: "javascript:" },
  { pattern: /vbscript:/i, label: "vbscript:" },
  { pattern: /data:[ \t]*text\/html/i, label: "data:text/html" },
];

function listAssetPaths(directory, base = directory) {
  const found = [];
  if (!existsSync(directory)) return found;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...listAssetPaths(path, base));
    else if (entry.isFile()) {
      found.push({ path: `/${relative(base, path).split(sep).join("/")}`, bytes: statSync(path).size });
    }
  }
  return found;
}

const contentFiles = repositoryFiles.filter((path) => /^content\/.*\.md$/.test(path));
const assetIndex = listAssetPaths(join(projectRoot, "assets"));

test("no hay rutas reservadas para material privado dentro del repositorio", () => {
  const unsafe = repositoryFiles.filter((path) => privatePathPatterns.some((pattern) => pattern.test(path)));
  assert.deepEqual(unsafe, [], `Se detectaron rutas de material privado: ${unsafe.join(", ")}`);
});

test("la carpeta privada de autoría vive fuera del repositorio", () => {
  const privateRoot = join(process.env.USERPROFILE ?? "", "profemacon-authoring-private");
  const insideRepository = relative(projectRoot, privateRoot);
  assert.ok(insideRepository.startsWith("..") || insideRepository.includes(":"),
    "Las fuentes privadas deben quedar fuera del repositorio y de OneDrive");
});

test("los materiales publicados no contienen HTML, script ni esquemas peligrosos", () => {
  const unsafe = [];
  for (const path of contentFiles) {
    const source = readFileSync(join(projectRoot, path), "utf8");
    for (const { pattern, label } of unsafePatterns) {
      if (pattern.test(source)) unsafe.push(`${path} (${label})`);
    }
  }
  assert.deepEqual(unsafe, [], `Se detectó contenido no permitido: ${unsafe.join(", ")}`);
});

test("los materiales v1 parsean con el contrato y sus imágenes existen", () => {
  const v1Files = contentFiles.filter((path) => isMaterialV1Document(readFileSync(join(projectRoot, path), "utf8")));
  const failures = [];
  for (const path of v1Files) {
    const source = readFileSync(join(projectRoot, path), "utf8");
    const result = parseMaterialDocument(source, { contentPath: path, assets: assetIndex });
    if (!result.ok || result.parsed === null) {
      failures.push(`${path}: ${result.errors.map((issue) => `${issue.code} ${issue.path}`).join(", ")}`);
      continue;
    }
    for (const image of result.parsed.images) {
      if (!existsSync(join(projectRoot, "assets", image.src.slice(1)))) {
        failures.push(`${path}: falta la imagen ${image.src}`);
      }
    }
  }
  assert.deepEqual(failures, [], `Materiales v1 inválidos: ${failures.join(" | ")}`);
});

test("el material legacy queda identificado y exento del contrato v1", () => {
  const legacyFiles = contentFiles.filter((path) => detectMaterialDocumentKind(readFileSync(join(projectRoot, path), "utf8")) === "legacy-material");
  assert.ok(legacyFiles.length > 0, "Se esperaba material legacy (Unidad 0 y Unidad 1) sin migrar");
  for (const path of legacyFiles) {
    const source = readFileSync(join(projectRoot, path), "utf8");
    assert.equal(isMaterialV1Document(source), false, `${path} no debe tratarse como material v1`);
  }
});
