// Contratos de la política de contraseñas sobre el código productivo.
//
// Se combinan dos tipos de verificación:
//   1. semántica (importando el módulo real) para todo lo que puede probarse
//      ejecutando código: rango, objetivo, rehash desactivado;
//   2. inspección de fuente acotada y documentada para lo que no es observable en
//      runtime: que no queden literales del costo anterior, que PBKDF2 tenga un
//      único punto de entrada y que el login no encadene una segunda derivación.
// No se inspeccionan textos largos ni formatos: sólo ubicaciones concretas.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PASSWORD_POLICY } from "../worker/auth-crypto.ts";

const projectRoot = process.cwd();
const workerDir = join(projectRoot, "worker");
const workerFiles = readdirSync(workerDir).filter((name) => name.endsWith(".ts"));
const localAuthSource = readFileSync(join(workerDir, "local-auth.ts"), "utf8");

function workerSource(file: string) {
  return readFileSync(join(workerDir, file), "utf8");
}

function functionBody(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `No se pudo delimitar ${start}`);
  return source.slice(startIndex, endIndex);
}

test("el código productivo no conserva el costo anterior ni literales sobre el techo", () => {
  for (const file of workerFiles) {
    const text = workerSource(file);
    assert.doesNotMatch(text, /600_?000/, `${file} conserva el costo de 600000`);
    // Los guiones bajos se retiran para que 100_001 y 1_000_000 no escapen al escaneo.
    const normalized = text.replace(/_/g, "");
    for (const match of normalized.matchAll(/(?<![\d.])(\d{6,})(?![\d.])/g)) {
      assert.ok(
        Number(match[1]) <= PASSWORD_POLICY.maxSoportado,
        `${file} contiene el literal ${match[1]}, por encima del techo ${PASSWORD_POLICY.maxSoportado}`,
      );
    }
  }
});

test("PBKDF2 tiene un único punto de entrada en el Worker", () => {
  const filesWithPbkdf2 = workerFiles.filter((file) => /PBKDF2/.test(workerSource(file)));
  assert.deepEqual(filesWithPbkdf2, ["auth-crypto.ts"]);
});

test("la activación crea la credencial con el objetivo y persiste algoritmo y formato", () => {
  const activation = functionBody(localAuthSource, "export async function activateLocalAccount", "export async function loginLocalAccount");
  assert.match(activation, /createPasswordCredential\(/);
  assert.match(activation, /INSERT INTO credenciales_locales \(usuario_id, algoritmo, formato, iteraciones, sal_base64, hash_base64\)/);
});

test("el login ejecuta una sola verificación y no encadena una segunda derivación", () => {
  const login = functionBody(localAuthSource, "export async function loginLocalAccount", "async function createLocalSession");
  assert.equal(login.match(/verifyPassword\(/g)?.length ?? 0, 1, "El login debe verificar una sola vez");
  assert.match(login, /assertCredencialVerificable\(row\)/, "El login debe validar la política antes de derivar");
  for (const forbidden of ["needsRehash(", "createPasswordCredential(", "derivePasswordHash(", "PASSWORD_POLICY.target"]) {
    assert.ok(!login.includes(forbidden), `El login no debe usar ${forbidden}`);
  }
  assert.equal(PASSWORD_POLICY.rehashOnLogin, false);
});

test("la migración 0011 declara el rango aprobado y 0004 permanece intacta", () => {
  const migration = readFileSync(join(projectRoot, "migrations", "0011_costo_password_compatible.sql"), "utf8");
  assert.match(migration, /CHECK \(iteraciones BETWEEN 50000 AND 100000\)/);
  assert.doesNotMatch(migration, /BETWEEN 1 AND/);
  assert.match(migration, /verificacion_costo_0011/);
  assert.match(migration, /INSERT INTO credenciales_locales_nueva/);

  const legacy = readFileSync(join(projectRoot, "migrations", "0004_autenticacion_local.sql"), "utf8");
  assert.match(legacy, /CHECK \(iteraciones >= 600000\)/, "0004 no debe modificarse: es una migración ya aplicada");
});
