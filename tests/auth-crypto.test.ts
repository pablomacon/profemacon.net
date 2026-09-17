import assert from "node:assert/strict";
import test from "node:test";
import { createPasswordCredential, PASSWORD_ITERATIONS, randomToken, sha256Hex, verifyPassword } from "../worker/auth-crypto.ts";

test("crea y verifica una credencial PBKDF2 sin aceptar otra contraseña", async () => {
  const password = "Frase de prueba suficientemente larga";
  const credential = await createPasswordCredential(password);

  assert.equal(credential.iterations, PASSWORD_ITERATIONS);
  assert.equal(await verifyPassword(password, credential.saltBase64, credential.hashBase64, credential.iterations), true);
  assert.equal(await verifyPassword("Otra frase totalmente incorrecta", credential.saltBase64, credential.hashBase64, credential.iterations), false);
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
