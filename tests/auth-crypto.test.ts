import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import test from "node:test";
import {
  createPasswordCredential,
  derivePasswordHash,
  PASSWORD_ITERATIONS,
  PASSWORD_POLICY,
  PasswordPolicyError,
  randomToken,
  sha256Hex,
  verifyPassword,
} from "../worker/auth-crypto.ts";

const PASSWORD = "Frase de prueba suficientemente larga";
const OTHER_PASSWORD = "Otra frase totalmente incorrecta";

function base64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

/** Construye una credencial con un costo arbitrario, como las históricas. */
async function credentialAt(password: string, iterations: number) {
  const salt = new Uint8Array(16).fill(9);
  const hash = await derivePasswordHash(password, salt, iterations);
  return { saltBase64: base64(salt), hashBase64: base64(hash) };
}

test("crea una credencial con el costo objetivo de la política", async () => {
  const credential = await createPasswordCredential(PASSWORD);

  assert.equal(PASSWORD_POLICY.target, 100_000);
  assert.equal(PASSWORD_ITERATIONS, PASSWORD_POLICY.target);
  assert.equal(credential.algorithm, PASSWORD_POLICY.algoritmo);
  assert.equal(credential.format, PASSWORD_POLICY.formato);
  assert.equal(credential.iterations, PASSWORD_POLICY.target);
  assert.equal(Buffer.from(credential.saltBase64, "base64").length, 16);
  assert.equal(Buffer.from(credential.hashBase64, "base64").length, 32);
});

test("verifica la contraseña correcta y rechaza otra", async () => {
  const credential = await createPasswordCredential(PASSWORD);

  assert.equal(await verifyPassword(PASSWORD, credential.saltBase64, credential.hashBase64, credential.iterations), true);
  assert.equal(await verifyPassword(OTHER_PASSWORD, credential.saltBase64, credential.hashBase64, credential.iterations), false);
});

test("deriva PBKDF2-HMAC-SHA-256 con la longitud acordada", async () => {
  const salt = new Uint8Array(16).fill(7);
  const derived = await derivePasswordHash(PASSWORD, salt, 50_000);
  const expected = pbkdf2Sync(PASSWORD, salt, 50_000, 32, "sha256");

  assert.equal(derived.length, 32);
  assert.equal(Buffer.from(derived).toString("hex"), expected.toString("hex"));
});

test("verifica credenciales históricas dentro del rango soportado", async () => {
  const fifty = await credentialAt(PASSWORD, 50_000);
  const seventyFive = await credentialAt(PASSWORD, 75_000);

  assert.equal(await verifyPassword(PASSWORD, fifty.saltBase64, fifty.hashBase64, 50_000), true);
  assert.equal(await verifyPassword(PASSWORD, seventyFive.saltBase64, seventyFive.hashBase64, 75_000), true);
  assert.equal(await verifyPassword(OTHER_PASSWORD, seventyFive.saltBase64, seventyFive.hashBase64, 75_000), false);
});

test("no sustituye el costo almacenado por el objetivo vigente", async () => {
  const credential = await createPasswordCredential(PASSWORD);

  // Verificar con el costo equivocado no puede dar verdadero por conveniencia:
  // no hay clamp silencioso hacia el objetivo.
  assert.equal(await verifyPassword(PASSWORD, credential.saltBase64, credential.hashBase64, 50_000), false);
});

test("rechaza cualquier derivación fuera del rango soportado", async () => {
  const salt = new Uint8Array(16).fill(3);

  await assert.rejects(() => derivePasswordHash(PASSWORD, salt, 100_001), PasswordPolicyError);
  await assert.rejects(() => derivePasswordHash(PASSWORD, salt, 600_000), PasswordPolicyError);
  await assert.rejects(() => derivePasswordHash(PASSWORD, salt, 49_999), PasswordPolicyError);
});

test("genera tokens independientes con entropía suficiente", () => {
  const first = randomToken();
  const second = randomToken();

  assert.notEqual(first, second);
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.match(second, /^[A-Za-z0-9_-]{43}$/);
});

test("produce SHA-256 hexadecimal estable", async () => {
  assert.equal(await sha256Hex("profe-macon"), "ea3b07d7b18154ff238ef8c5e87f93505af349841adb7aec3d1f49700b51cdf7");
});
