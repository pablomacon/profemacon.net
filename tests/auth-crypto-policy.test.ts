// Política versionada de contraseñas: guardas puras, sin D1 y sin criptografía.
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCredencialVerificable,
  assertIteracionesVerificables,
  createPasswordCredential,
  needsRehash,
  PASSWORD_POLICY,
  PasswordPolicyError,
  verifyPassword,
} from "../worker/auth-crypto.ts";

const PASSWORD = "Frase de prueba suficientemente larga";

function stored(overrides: Partial<{ algorithm: string; format: string; iterations: number }> = {}) {
  return {
    algorithm: PASSWORD_POLICY.algoritmo,
    format: PASSWORD_POLICY.formato,
    iterations: PASSWORD_POLICY.target,
    ...overrides,
  };
}

test("la política declara el rango, el objetivo y el rehash desactivado", () => {
  assert.equal(PASSWORD_POLICY.algoritmo, "pbkdf2-sha256");
  assert.equal(PASSWORD_POLICY.formato, "v1");
  assert.equal(PASSWORD_POLICY.minVerificable, 50_000);
  assert.equal(PASSWORD_POLICY.target, 100_000);
  assert.equal(PASSWORD_POLICY.maxSoportado, 100_000);
  assert.equal(PASSWORD_POLICY.rehashOnLogin, false);
  assert.ok(PASSWORD_POLICY.minVerificable <= PASSWORD_POLICY.target);
  assert.ok(PASSWORD_POLICY.target <= PASSWORD_POLICY.maxSoportado);
});

test("acepta sólo enteros dentro del rango verificable", () => {
  assert.doesNotThrow(() => assertIteracionesVerificables(50_000));
  assert.doesNotThrow(() => assertIteracionesVerificables(75_000));
  assert.doesNotThrow(() => assertIteracionesVerificables(100_000));
});

test("rechaza todo valor fuera del rango verificable", () => {
  for (const value of [49_999, 100_001, 600_000, 0, -1, 1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => assertIteracionesVerificables(value), PasswordPolicyError, `debía rechazar ${String(value)}`);
  }
  // Valores no numéricos: la guarda valida el tipo antes de comparar.
  for (const value of ["100000", null, undefined, {}, []]) {
    assert.throws(
      () => assertIteracionesVerificables(value as unknown as number),
      PasswordPolicyError,
      `debía rechazar ${JSON.stringify(value)}`,
    );
  }
});

test("la guarda completa rechaza algoritmo, formato y costo fuera de política", () => {
  assert.doesNotThrow(() => assertCredencialVerificable(stored()));
  assert.throws(() => assertCredencialVerificable(stored({ algorithm: "heredado-sha256" })), PasswordPolicyError);
  assert.throws(() => assertCredencialVerificable(stored({ format: "v0" })), PasswordPolicyError);
  assert.throws(() => assertCredencialVerificable(stored({ iterations: 49_999 })), PasswordPolicyError);
  assert.throws(() => assertCredencialVerificable(stored({ iterations: 100_001 })), PasswordPolicyError);
});

test("nunca deriva ni verifica con un valor sustituido", async () => {
  const credential = await createPasswordCredential(PASSWORD);

  // Una credencial por encima del techo no se verifica "como si" tuviera el objetivo.
  await assert.rejects(
    () => verifyPassword(PASSWORD, credential.saltBase64, credential.hashBase64, 600_000),
    PasswordPolicyError,
  );
  // Una credencial por debajo del piso tampoco: no hay clamp silencioso.
  await assert.rejects(
    () => verifyPassword(PASSWORD, credential.saltBase64, credential.hashBase64, 1_000),
    PasswordPolicyError,
  );
});

test("needsRehash sólo señala credenciales por debajo del objetivo", () => {
  assert.equal(needsRehash(stored()), false);
  assert.equal(needsRehash(stored({ iterations: PASSWORD_POLICY.target - 1 })), true);
  assert.equal(needsRehash(stored({ algorithm: "otro" })), true);
  assert.equal(needsRehash(stored({ format: "v0" })), true);
  // Un costo por encima del objetivo nunca sugiere reducir el costo.
  assert.equal(needsRehash(stored({ iterations: PASSWORD_POLICY.target + 50_000 })), false);
});
