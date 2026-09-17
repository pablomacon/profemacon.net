export const PASSWORD_ITERATIONS = 600_000;

const encoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function derivePasswordHash(password: string, salt: Uint8Array, iterations = PASSWORD_ITERATIONS) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, 256);
  return new Uint8Array(bits);
}

export async function createPasswordCredential(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePasswordHash(password, salt);
  return { iterations: PASSWORD_ITERATIONS, saltBase64: bytesToBase64(salt), hashBase64: bytesToBase64(hash) };
}

export async function verifyPassword(password: string, saltBase64: string, hashBase64: string, iterations: number) {
  const expected = base64ToBytes(hashBase64);
  const actual = await derivePasswordHash(password, base64ToBytes(saltBase64), iterations);
  if (expected.length !== actual.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ actual[index];
  return difference === 0;
}

export function randomToken(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

